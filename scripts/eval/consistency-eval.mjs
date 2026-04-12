#!/usr/bin/env node
/**
 * OCR Consistency Evaluation with Embedding Similarity
 *
 * Upgrades from Jaccard word overlap to embedding-based similarity (BERTScore-style)
 * and adds per-sentence consistency scoring.
 *
 * Tests:
 *   --test self-consistency  — N=5 OCR runs per page, pairwise similarity
 *   --test sentence-level    — Per-sentence consistency breakdown
 *   --test corpus            — Run across expanded corpus (printed, MS, Leonardo, multi-language)
 *   --test contamination     — Famous vs obscure × printed vs manuscript (2×2)
 *
 * Metrics:
 *   - Jaccard word similarity (baseline)
 *   - Embedding cosine similarity (Gemini gemini-embedding-001)
 *   - CER (character error rate between pairs)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/eval/consistency-eval.mjs --test self-consistency
 */

import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

// ── Config ──────────────────────────────────────────────────────────────────

const EMBEDDING_MODEL = 'gemini-embedding-001';
const N_RUNS = 5;            // Number of independent OCR runs per page
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

// Models for OCR
const MODELS = {
  'gemini-flash': 'gemini-3-flash-preview',
  'gemini-lite': 'gemini-3.1-flash-lite-preview',
};
const DEFAULT_MODEL = 'gemini-flash';

// ── Corpus ──────────────────────────────────────────────────────────────────

const CORPUS = {
  // Printed Latin
  vitruvius: {
    label: 'Printed Latin (Vitruvius 1521)',
    type: 'printed',
    language: 'Latin',
    famous: true,
    iiif: (p) => {
      const id = 'mvitrvviidearchi00vitr';
      const pad = String(p).padStart(4, '0');
      return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
    },
    pages: [25, 33, 47],
    prompt: 'latin_printed',
  },
  drebbel: {
    label: 'Printed Latin (Drebbel, BPH)',
    type: 'printed',
    language: 'Latin',
    famous: false,
    r2: (p) => {
      const pad = String(p).padStart(4, '0');
      return `https://images.sourcelibrary.org/pages/6836f8ee811c8ab472a49e36/${pad}.jpg`;
    },
    pages: [5, 9, 13],
    prompt: 'latin_printed',
  },
  // Handwritten manuscript
  bodleian_timaeus: {
    label: 'Manuscript Latin (Bodleian Timaeus, 12th c.)',
    type: 'manuscript',
    language: 'Latin',
    famous: true,  // Plato's Timaeus — famous text in unfamiliar hand
    iiif: (p) => {
      // Bodleian MS. Digby 23
      const id = 'bdr:823456'; // placeholder — actual IIIF TBD
      return `https://iiif.bodleian.ox.ac.uk/iiif/image/${id}/full/max/0/default.jpg`;
    },
    pages: [25],
    prompt: 'latin_manuscript',
  },
  // Leonardo mirror-script
  leonardo_chevelure: {
    label: 'Leonardo mirror-script (Chevelure)',
    type: 'mirror-script',
    language: 'Italian',
    famous: true,
    iiif: (p) => {
      const id = 'etudessurlacheve00leon';
      const pad = String(p).padStart(4, '0');
      return `https://iiif.archive.org/image/iiif/3/${id}%2F${id}_jp2.zip%2F${id}_jp2%2F${id}_${pad}.jp2/full/max/0/default.jpg`;
    },
    pages: [49, 53, 17],
    prompt: 'leonardo',
  },
};

// ── Prompts ─────────────────────────────────────────────────────────────────

const PROMPTS = {
  latin_printed: `Transcribe this historical printed page to plain text.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Do NOT add interpretive notes, translations, or scholarly commentary
4. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`,

  latin_manuscript: `Transcribe this historical manuscript page to plain text.

This is a medieval Latin manuscript. The script may include abbreviations and ligatures common in medieval scribal hands.

Rules:
1. Expand abbreviations where confident, mark uncertain expansions with <unclear>...</unclear>
2. Preserve original spelling, capitalization, punctuation
3. Describe diagrams briefly in [brackets]
4. Do NOT add interpretive notes, translations, or scholarly commentary
5. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`,

  leonardo: `Transcribe this historical manuscript page to plain text.

This is a page from a Leonardo da Vinci manuscript. The text may be written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. If the page is blank or has no text, say "BLANK PAGE" and describe any images present
5. Do NOT add interpretive notes, translations, or scholarly commentary
6. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`,
};

// ── Utilities ───────────────────────────────────────────────────────────────

function stripTags(text) {
  return text
    .replace(/<[^>]+>[^<]*<\/[^>]+>/g, '')
    .replace(/<[^>]+\/>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[.*?\]/g, '')  // strip diagram descriptions
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function jaccardSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = [...wordsA].filter(x => wordsB.has(x));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
}

function editDistance(a, b, maxLen = 5000) {
  a = a.substring(0, maxLen);
  b = b.substring(0, maxLen);
  const m = a.length, n = b.length;
  const dp = Array(n + 1).fill(0).map((_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

function cer(a, b) {
  const dist = editDistance(a, b);
  return Math.max(a.length, b.length) === 0 ? 0 : dist / Math.max(a.length, b.length);
}

async function fetchImageAsBase64(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      return Buffer.from(buf).toString('base64');
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        console.log(`    Retry ${attempt + 1}/${RETRY_MAX}: ${e.message}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else {
        throw e;
      }
    }
  }
}

function saveResult(name, data) {
  const file = path.join(RESULTS_DIR, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`Saved: ${file}`);
}

// ── OCR Functions ───────────────────────────────────────────────────────────

async function geminiOcr(imageBase64, model, prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const response = await ai.models.generateContent({
        model,
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
        console.log(`    OCR retry ${attempt + 1}: ${e.message}`);
        // Longer backoff for large images — socket exhaustion
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1) * 2));
      } else {
        throw e;
      }
    }
  }
}

// ── Embedding Similarity ────────────────────────────────────────────────────

async function getEmbeddings(texts, apiKey) {
  const genai = new GoogleGenerativeAI(apiKey);
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];

  // Batch in groups of 5
  for (let i = 0; i < texts.length; i += 5) {
    const batch = texts.slice(i, i + 5);
    const requests = batch.map(text => ({
      content: { role: 'user', parts: [{ text: text.slice(0, 8000) }] },
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) {
        results.push(emb.values);
      }
    } catch (e) {
      // Fallback to individual
      for (const req of requests) {
        try {
          const single = await model.embedContent(req);
          results.push(single.embedding.values);
        } catch {
          results.push(null);
        }
      }
    }

    if (i + 5 < texts.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  return results;
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

/**
 * Compute pairwise similarity matrix for N texts using embeddings.
 * Returns { mean, min, max, pairs: [{i, j, cosine, jaccard, cer}] }
 */
async function pairwiseSimilarity(texts, apiKey) {
  const stripped = texts.map(t => stripTags(t));
  const embeddings = await getEmbeddings(stripped, apiKey);

  const pairs = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const cosine = (embeddings[i] && embeddings[j])
        ? cosineSimilarity(embeddings[i], embeddings[j])
        : null;
      const jaccard = jaccardSimilarity(stripped[i], stripped[j]);
      const charErr = cer(stripped[i], stripped[j]);
      pairs.push({ i, j, cosine, jaccard, cer: charErr });
    }
  }

  const cosines = pairs.map(p => p.cosine).filter(c => c !== null);
  const jaccards = pairs.map(p => p.jaccard);

  return {
    embedding: {
      mean: cosines.length ? cosines.reduce((a, b) => a + b, 0) / cosines.length : null,
      min: cosines.length ? Math.min(...cosines) : null,
      max: cosines.length ? Math.max(...cosines) : null,
    },
    jaccard: {
      mean: jaccards.reduce((a, b) => a + b, 0) / jaccards.length,
      min: Math.min(...jaccards),
      max: Math.max(...jaccards),
    },
    pairs,
  };
}

// ── Sentence-Level Consistency ──────────────────────────────────────────────

/**
 * Split text into sentences, embed each, find matching sentences across runs.
 * Returns per-sentence consistency scores.
 */
async function sentenceLevelConsistency(texts, apiKey) {
  // Split each run into sentences
  const sentencesByRun = texts.map(t => {
    const stripped = stripTags(t);
    // Split on periods, question marks, newlines — but keep reasonable chunks
    return stripped
      .split(/(?<=[.?!])\s+|\n{2,}/)
      .map(s => s.trim())
      .filter(s => s.length > 10);  // skip very short fragments
  });

  // Use the first run as reference, check how many sentences appear in other runs
  const reference = sentencesByRun[0];
  if (reference.length === 0) return { sentences: [], meanConsistency: 0 };

  // Get embeddings for all sentences from all runs
  const allSentences = sentencesByRun.flat();
  const allEmbeddings = await getEmbeddings(allSentences, apiKey);

  // Build index: which embedding belongs to which run/sentence
  let offset = 0;
  const embeddingsByRun = sentencesByRun.map(sentences => {
    const embs = allEmbeddings.slice(offset, offset + sentences.length);
    offset += sentences.length;
    return embs;
  });

  // For each reference sentence, find best match in each other run
  const sentenceResults = [];
  for (let si = 0; si < reference.length; si++) {
    const refEmb = embeddingsByRun[0][si];
    if (!refEmb) continue;

    const matchScores = [];
    for (let run = 1; run < sentencesByRun.length; run++) {
      let bestScore = 0;
      let bestIdx = -1;
      for (let sj = 0; sj < sentencesByRun[run].length; sj++) {
        const candEmb = embeddingsByRun[run][sj];
        if (!candEmb) continue;
        const sim = cosineSimilarity(refEmb, candEmb);
        if (sim > bestScore) {
          bestScore = sim;
          bestIdx = sj;
        }
      }
      matchScores.push({
        run,
        bestScore,
        bestMatch: bestIdx >= 0 ? sentencesByRun[run][bestIdx] : null,
      });
    }

    const meanScore = matchScores.reduce((a, b) => a + b.bestScore, 0) / matchScores.length;

    sentenceResults.push({
      sentence: reference[si].substring(0, 100),
      meanConsistency: meanScore,
      scores: matchScores.map(m => m.bestScore),
      consistent: meanScore > 0.9,
    });
  }

  const overallMean = sentenceResults.length
    ? sentenceResults.reduce((a, b) => a + b.meanConsistency, 0) / sentenceResults.length
    : 0;

  return {
    sentences: sentenceResults,
    meanConsistency: overallMean,
    totalSentences: reference.length,
    consistentCount: sentenceResults.filter(s => s.consistent).length,
  };
}

// ── Test: Self-Consistency ──────────────────────────────────────────────────

async function testSelfConsistency() {
  console.log(`\n=== Self-Consistency Test (N=${N_RUNS}) ===\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  const model = MODELS[DEFAULT_MODEL];
  const results = [];

  // Test each corpus entry
  const entries = process.argv.includes('--source')
    ? [process.argv[process.argv.indexOf('--source') + 1]]
    : ['vitruvius', 'leonardo_chevelure'];

  for (const sourceKey of entries) {
    const source = CORPUS[sourceKey];
    if (!source) {
      console.log(`Unknown source: ${sourceKey}`);
      continue;
    }

    console.log(`\n--- ${source.label} ---`);
    const prompt = PROMPTS[source.prompt];

    for (const pageNum of source.pages.slice(0, 2)) {  // 2 pages per source
      const url = source.iiif ? source.iiif(pageNum) : source.r2(pageNum);
      console.log(`  Page ${pageNum}: fetching image...`);

      let imgB64;
      try {
        imgB64 = await fetchImageAsBase64(url);
        console.log(`    Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log(`    SKIP — fetch failed: ${e.message}`);
        continue;
      }

      // Run N independent OCR passes
      console.log(`    Running ${N_RUNS} OCR passes...`);
      const transcriptions = [];
      for (let run = 0; run < N_RUNS; run++) {
        try {
          const text = await geminiOcr(imgB64, model, prompt, apiKey);
          transcriptions.push(text);
          const stripped = stripTags(text);
          console.log(`      Run ${run + 1}: ${stripped.length} chars, ${stripped.split(/\s+/).length} words`);
        } catch (e) {
          console.log(`      Run ${run + 1}: ERROR — ${e.message}`);
        }
        // Rate limit
        await new Promise(r => setTimeout(r, 2000));
      }

      if (transcriptions.length < 2) {
        console.log(`    Not enough runs succeeded (${transcriptions.length})`);
        continue;
      }

      // Compute pairwise similarity
      console.log(`    Computing similarity (${transcriptions.length} runs)...`);
      const similarity = await pairwiseSimilarity(transcriptions, apiKey);

      const pageResult = {
        source: sourceKey,
        label: source.label,
        type: source.type,
        language: source.language,
        page: pageNum,
        n_runs: transcriptions.length,
        similarity,
        run_lengths: transcriptions.map(t => stripTags(t).length),
      };

      results.push(pageResult);

      console.log(`    Jaccard:   mean=${(similarity.jaccard.mean * 100).toFixed(1)}% [${(similarity.jaccard.min * 100).toFixed(1)}–${(similarity.jaccard.max * 100).toFixed(1)}%]`);
      console.log(`    Embedding: mean=${similarity.embedding.mean ? (similarity.embedding.mean * 100).toFixed(1) + '%' : 'N/A'} [${similarity.embedding.min ? (similarity.embedding.min * 100).toFixed(1) : 'N/A'}–${similarity.embedding.max ? (similarity.embedding.max * 100).toFixed(1) : 'N/A'}%]`);
    }
  }

  saveResult('self-consistency', results);
  printConsistencyTable(results);
  return results;
}

// ── Test: Sentence-Level ────────────────────────────────────────────────────

async function testSentenceLevel() {
  console.log(`\n=== Sentence-Level Consistency (N=${N_RUNS}) ===\n`);

  const apiKey = process.env.GEMINI_API_KEY;
  const model = MODELS[DEFAULT_MODEL];
  const results = [];

  const entries = process.argv.includes('--source')
    ? [process.argv[process.argv.indexOf('--source') + 1]]
    : ['vitruvius', 'leonardo_chevelure'];

  for (const sourceKey of entries) {
    const source = CORPUS[sourceKey];
    if (!source) continue;

    console.log(`\n--- ${source.label} ---`);
    const prompt = PROMPTS[source.prompt];
    const pageNum = source.pages[0];  // Just first page for detailed analysis

    const url = source.iiif ? source.iiif(pageNum) : source.r2(pageNum);
    console.log(`  Page ${pageNum}: fetching image...`);

    let imgB64;
    try {
      imgB64 = await fetchImageAsBase64(url);
    } catch (e) {
      console.log(`    SKIP: ${e.message}`);
      continue;
    }

    // Run N OCR passes
    console.log(`    Running ${N_RUNS} OCR passes...`);
    const transcriptions = [];
    for (let run = 0; run < N_RUNS; run++) {
      try {
        const text = await geminiOcr(imgB64, model, prompt, apiKey);
        transcriptions.push(text);
        console.log(`      Run ${run + 1}: ${stripTags(text).split(/\s+/).length} words`);
      } catch (e) {
        console.log(`      Run ${run + 1}: ERROR`);
      }
      await new Promise(r => setTimeout(r, 2000));
    }

    if (transcriptions.length < 2) continue;

    // Per-sentence analysis
    console.log(`    Analyzing sentences...`);
    const sentenceAnalysis = await sentenceLevelConsistency(transcriptions, apiKey);

    const result = {
      source: sourceKey,
      label: source.label,
      type: source.type,
      page: pageNum,
      n_runs: transcriptions.length,
      ...sentenceAnalysis,
    };

    results.push(result);

    // Print sentence-level breakdown
    console.log(`\n    Sentence consistency for ${source.label} p${pageNum}:`);
    console.log(`    Total sentences: ${sentenceAnalysis.totalSentences}`);
    console.log(`    Consistent (>0.9): ${sentenceAnalysis.consistentCount} (${(sentenceAnalysis.consistentCount / sentenceAnalysis.totalSentences * 100).toFixed(0)}%)`);
    console.log(`    Mean consistency: ${(sentenceAnalysis.meanConsistency * 100).toFixed(1)}%`);

    if (sentenceAnalysis.sentences.length > 0) {
      console.log(`\n    Top 5 most consistent sentences:`);
      const sorted = [...sentenceAnalysis.sentences].sort((a, b) => b.meanConsistency - a.meanConsistency);
      for (const s of sorted.slice(0, 5)) {
        console.log(`      ${(s.meanConsistency * 100).toFixed(0)}% — "${s.sentence}"`);
      }
      console.log(`\n    Bottom 5 (least consistent):`);
      for (const s of sorted.slice(-5)) {
        console.log(`      ${(s.meanConsistency * 100).toFixed(0)}% — "${s.sentence}"`);
      }
    }
  }

  saveResult('sentence-level', results);
  return results;
}

// ── Output ──────────────────────────────────────────────────────────────────

function printConsistencyTable(results) {
  console.log('\n┌─────────────────────────────────────┬──────────┬──────────┬──────────┐');
  console.log('│ Source                              │ Jaccard  │ Embedding│ CER      │');
  console.log('├─────────────────────────────────────┼──────────┼──────────┼──────────┤');

  for (const r of results) {
    const label = `${r.label} p${r.page}`.substring(0, 37).padEnd(37);
    const jac = (r.similarity.jaccard.mean * 100).toFixed(1).padStart(6) + '%';
    const emb = r.similarity.embedding.mean
      ? (r.similarity.embedding.mean * 100).toFixed(1).padStart(6) + '%'
      : '   N/A ';
    const cerMean = r.similarity.pairs.length
      ? (r.similarity.pairs.reduce((a, p) => a + p.cer, 0) / r.similarity.pairs.length * 100).toFixed(1).padStart(6) + '%'
      : '   N/A ';
    console.log(`│ ${label} │ ${jac} │ ${emb} │ ${cerMean} │`);
  }

  console.log('└─────────────────────────────────────┴──────────┴──────────┴──────────┘');
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const testArg = args.find(a => a.startsWith('--test='))?.split('=')[1]
    || args[args.indexOf('--test') + 1]
    || 'self-consistency';

  if (!process.env.GEMINI_API_KEY) {
    console.error('Missing GEMINI_API_KEY');
    process.exit(1);
  }

  console.log(`OCR Consistency Evaluation`);
  console.log(`Test: ${testArg}, N=${N_RUNS} runs per page`);

  switch (testArg) {
    case 'self-consistency':
      await testSelfConsistency();
      break;
    case 'sentence-level':
      await testSentenceLevel();
      break;
    case 'corpus':
      // Run self-consistency across all corpus entries
      process.argv.push('--source', 'vitruvius');
      await testSelfConsistency();
      // Reset and run others
      break;
    default:
      console.error(`Unknown test: ${testArg}`);
      console.error('Available: self-consistency, sentence-level, corpus, contamination');
      process.exit(1);
  }
}

main();
