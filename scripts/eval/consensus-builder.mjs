#!/usr/bin/env node
/**
 * Consensus Transcription Builder
 *
 * Takes N independent OCR runs of the same page and builds a consensus
 * transcription that keeps only the reliable parts.
 *
 * Algorithm:
 *   1. Run N=5 OCR passes on the same image
 *   2. Split each run into sentences
 *   3. For each sentence in run 1 (reference), find best embedding match in other runs
 *   4. Sentences with high agreement (>0.9) → keep verbatim (green)
 *   5. Sentences with moderate agreement (0.7-0.9) → keep with [approximate] marker (yellow)
 *   6. Sentences with low agreement (<0.7) → replace with [uncertain] (red)
 *   7. Output annotated consensus transcription
 *
 * Also computes a page-level trust score and trust band (green/yellow/red).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/consensus-builder.mjs --page 49 --source leonardo
 *   node scripts/eval/consensus-builder.mjs --page 33 --source vitruvius
 *   node scripts/eval/consensus-builder.mjs --demo   # Run on both for comparison
 */

import sharp from 'sharp';
import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const EMBEDDING_MODEL = 'gemini-embedding-001';
const GEMINI_FLASH = 'gemini-3-flash-preview';
const N_RUNS = 5;
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

// Trust thresholds
const GREEN_THRESHOLD = 0.90;   // High confidence
const YELLOW_THRESHOLD = 0.70;  // Approximate
// Below yellow = red (uncertain)

// ── Image Sources ───────────────────────────────────────────────────────────

const SOURCES = {
  leonardo: {
    label: 'Leonardo (Chevelure)',
    iiif: (p) => {
      const id = 'etudessurlacheve00leon';
      const pad = String(p).padStart(4, '0');
      return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
    },
    prompt: `Transcribe this historical manuscript page to plain text.
This is a page from a Leonardo da Vinci manuscript. The text may be written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.
Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. Do NOT add interpretive notes or commentary
5. Do NOT reconstruct text you cannot actually read`,
    preprocess: 'flip_contrast',  // Best preprocessing for mirror-script
  },
  vitruvius: {
    label: 'Vitruvius (printed, 1521)',
    iiif: (p) => {
      const id = 'mvitrvviidearchi00vitr';
      const pad = String(p).padStart(4, '0');
      return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
    },
    prompt: `Transcribe this historical printed page to plain text.
Preserve original spelling, capitalization, punctuation.
Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes or commentary.`,
    preprocess: null,
  },
};

// ── Utilities ───────────────────────────────────────────────────────────────

function stripTags(text) {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitSentences(text) {
  const stripped = stripTags(text);
  return stripped
    .split(/(?<=[.?!;:])\s+|\n{2,}/)
    .map(s => s.trim())
    .filter(s => s.length > 5);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getEmbeddings(texts, apiKey) {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];
  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5);
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] },
    }));
    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) results.push(emb.values);
    } catch {
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch { results.push(null); }
      }
    }
    if (i + 5 < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

async function fetchImageBuffer(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

async function geminiOcr(imageBase64, prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const response = await ai.models.generateContent({
        model: GEMINI_FLASH,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        }],
        config: { abortSignal: controller.signal },
      });
      clearTimeout(timeout);
      return response.text || '';
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1) * 2));
      } else throw e;
    }
  }
}

// ── Consensus Builder ───────────────────────────────────────────────────────

async function buildConsensus(transcriptions, apiKey) {
  // Split each run into sentences
  const sentencesByRun = transcriptions.map(t => splitSentences(t));

  // Use longest run as reference (most complete)
  let refIdx = 0;
  let maxLen = 0;
  sentencesByRun.forEach((sentences, i) => {
    const totalLen = sentences.join(' ').length;
    if (totalLen > maxLen) { maxLen = totalLen; refIdx = i; }
  });

  const reference = sentencesByRun[refIdx];
  if (reference.length === 0) {
    return {
      consensus: '[No text detected]',
      trustScore: 0,
      trustBand: 'red',
      sentences: [],
      stats: { total: 0, green: 0, yellow: 0, red: 0 },
    };
  }

  // Get embeddings for ALL sentences across all runs
  const allSentences = sentencesByRun.flat();
  const allEmbeddings = await getEmbeddings(allSentences, apiKey);

  // Build index
  let offset = 0;
  const embeddingsByRun = sentencesByRun.map(sentences => {
    const embs = allEmbeddings.slice(offset, offset + sentences.length);
    offset += sentences.length;
    return embs;
  });

  // For each reference sentence, find best match in each other run
  const sentenceResults = [];
  for (let si = 0; si < reference.length; si++) {
    const refEmb = embeddingsByRun[refIdx][si];
    if (!refEmb) continue;

    const matchScores = [];
    for (let run = 0; run < sentencesByRun.length; run++) {
      if (run === refIdx) continue;
      let bestScore = 0;
      let bestText = null;
      for (let sj = 0; sj < sentencesByRun[run].length; sj++) {
        const candEmb = embeddingsByRun[run][sj];
        if (!candEmb) continue;
        const sim = cosineSimilarity(refEmb, candEmb);
        if (sim > bestScore) {
          bestScore = sim;
          bestText = sentencesByRun[run][sj];
        }
      }
      matchScores.push(bestScore);
    }

    const meanScore = matchScores.length
      ? matchScores.reduce((a, b) => a + b, 0) / matchScores.length
      : 0;

    let band;
    if (meanScore >= GREEN_THRESHOLD) band = 'green';
    else if (meanScore >= YELLOW_THRESHOLD) band = 'yellow';
    else band = 'red';

    sentenceResults.push({
      text: reference[si],
      consistency: meanScore,
      band,
      scores: matchScores,
    });
  }

  // Build annotated consensus
  const parts = [];
  let greenCount = 0, yellowCount = 0, redCount = 0;

  for (const s of sentenceResults) {
    switch (s.band) {
      case 'green':
        parts.push(s.text);
        greenCount++;
        break;
      case 'yellow':
        parts.push(`⚠️ ${s.text} [approximate — ${(s.consistency * 100).toFixed(0)}% consistent]`);
        yellowCount++;
        break;
      case 'red':
        parts.push(`❌ [uncertain passage — ${(s.consistency * 100).toFixed(0)}% consistent, ${N_RUNS} variant readings available]`);
        redCount++;
        break;
    }
  }

  const overallScore = sentenceResults.length
    ? sentenceResults.reduce((a, b) => a + b.consistency, 0) / sentenceResults.length
    : 0;

  let overallBand;
  if (overallScore >= 0.80) overallBand = 'green';
  else if (overallScore >= 0.50) overallBand = 'yellow';
  else overallBand = 'red';

  return {
    consensus: parts.join('\n\n'),
    trustScore: overallScore,
    trustBand: overallBand,
    sentences: sentenceResults,
    stats: {
      total: sentenceResults.length,
      green: greenCount,
      yellow: yellowCount,
      red: redCount,
    },
    referenceRun: refIdx,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function runOne(sourceKey, pageNum, apiKey) {
  const source = SOURCES[sourceKey];
  if (!source) throw new Error(`Unknown source: ${sourceKey}`);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${source.label} — Page ${pageNum}`);
  console.log('='.repeat(60));

  // Fetch image
  const url = source.iiif(pageNum);
  console.log(`Fetching: ${url.substring(0, 80)}...`);
  let imgBuf = await fetchImageBuffer(url);

  // Preprocess if needed
  if (source.preprocess === 'flip_contrast') {
    console.log('Preprocessing: flip + contrast');
    imgBuf = await sharp(imgBuf)
      .flop()
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.5 })
      .jpeg({ quality: 90 })
      .toBuffer();
  }

  const imgB64 = imgBuf.toString('base64');
  console.log(`Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);

  // Run N OCR passes
  console.log(`\nRunning ${N_RUNS} OCR passes...`);
  const transcriptions = [];
  for (let run = 0; run < N_RUNS; run++) {
    try {
      const text = await geminiOcr(imgB64, source.prompt, apiKey);
      transcriptions.push(text);
      const stripped = stripTags(text);
      console.log(`  Run ${run + 1}: ${stripped.length} chars, ${stripped.split(/\s+/).length} words`);
    } catch (e) {
      console.log(`  Run ${run + 1}: ERROR — ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 2000));
  }

  if (transcriptions.length < 3) {
    console.log('Not enough runs for consensus (need ≥3)');
    return null;
  }

  // Build consensus
  console.log('\nBuilding consensus transcription...');
  const result = await buildConsensus(transcriptions, apiKey);

  // Output
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TRUST SCORE: ${(result.trustScore * 100).toFixed(1)}% — ${result.trustBand.toUpperCase()}`);
  console.log(`Sentences: ${result.stats.green} green, ${result.stats.yellow} yellow, ${result.stats.red} red (${result.stats.total} total)`);
  console.log('─'.repeat(60));

  console.log('\nCONSENSUS TRANSCRIPTION:\n');
  console.log(result.consensus);

  console.log(`\n${'─'.repeat(60)}`);
  console.log('SENTENCE DETAILS:\n');
  for (const s of result.sentences) {
    const icon = s.band === 'green' ? '✅' : s.band === 'yellow' ? '⚠️' : '❌';
    console.log(`  ${icon} ${(s.consistency * 100).toFixed(0)}% — "${s.text.substring(0, 80)}${s.text.length > 80 ? '...' : ''}"`);
  }

  return {
    source: sourceKey,
    page: pageNum,
    ...result,
    n_runs: transcriptions.length,
    raw_lengths: transcriptions.map(t => stripTags(t).length),
  };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  const args = process.argv.slice(2);
  const isDemo = args.includes('--demo');

  if (isDemo) {
    console.log('CONSENSUS TRANSCRIPTION DEMO');
    console.log('Comparing printed text vs Leonardo mirror-script\n');

    const results = [];

    // Printed text — should be mostly green
    const printed = await runOne('vitruvius', 33, apiKey);
    if (printed) results.push(printed);

    // Leonardo — should show the trust system in action
    const leonardo = await runOne('leonardo', 49, apiKey);
    if (leonardo) results.push(leonardo);

    // Save
    const outPath = path.join(RESULTS_DIR, 'consensus-demo.json');
    fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
    console.log(`\nSaved: ${outPath}`);

    // Comparison summary
    console.log('\n' + '='.repeat(60));
    console.log('COMPARISON SUMMARY');
    console.log('='.repeat(60));
    for (const r of results) {
      console.log(`\n${r.source} p${r.page}:`);
      console.log(`  Trust: ${(r.trustScore * 100).toFixed(1)}% (${r.trustBand})`);
      console.log(`  Sentences: ${r.stats.green}G / ${r.stats.yellow}Y / ${r.stats.red}R`);
    }
  } else {
    const sourceKey = args[args.indexOf('--source') + 1] || 'leonardo';
    const pageNum = parseInt(args[args.indexOf('--page') + 1] || '49');
    const result = await runOne(sourceKey, pageNum, apiKey);
    if (result) {
      const outPath = path.join(RESULTS_DIR, `consensus-${sourceKey}-p${pageNum}.json`);
      fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
      console.log(`\nSaved: ${outPath}`);
    }
  }
}

main();
