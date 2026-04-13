#!/usr/bin/env node
/**
 * Temperature Sweep + Training Contamination Test
 *
 * Two experiments in one:
 *
 * (A) TEMPERATURE SWEEP
 *   Run OCR at T = [0.0, 0.3, 0.7, 1.0, 1.5, 2.0] (N=3 each) on:
 *   - a Leonardo mirror-script page
 *   - a printed Latin page (control)
 *   Measure: self-consistency per temperature level
 *   Hypothesis: if T=0 output matches Richter, contamination is likely.
 *              if T=0 is merely deterministic confabulation, bottleneck is perceptual.
 *
 * (B) FAMOUS vs OBSCURE CONTAMINATION CHECK
 *   Compare accuracy (vs Richter) on:
 *   - Famous Leonardo pages (widely published, likely in training data)
 *   - Obscure Leonardo pages (less digitized, probably not in training data)
 *   Hypothesis: if famous pages score higher vs. Richter, training data contamination
 *              is partially driving self-consistency scores.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/temperature-contamination.mjs
 */

import { GoogleGenAI } from '@google/genai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(__dirname, 'leonardo-eval-results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const EMBEDDING_MODEL = 'gemini-embedding-001';
const OCR_MODEL = 'gemini-3-flash-preview';
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

// Temperatures to sweep
const TEMPERATURES = [0.01, 0.3, 0.7, 1.0, 1.5, 2.0];
const N_PER_TEMP = 3;

// ── Test pages ───────────────────────────────────────────────────────────────
// Optics page from "Etudes sur la chevelure" codex (our baseline Leonardo page)
const LEONARDO_PAGE = {
  name: 'Leonardo p49 (mirror-script optics)',
  iaId: 'etudessurlacheve00leon',
  page: 49,
  type: 'manuscript',
};

// Printed Latin control — same Vitruvius page used throughout
const PRINTED_PAGE = {
  name: 'Vitruvius p33 (printed Latin)',
  iaId: 'mvitrvviidearchi00vitr',
  page: 33,
  type: 'printed',
};

// For famous vs obscure: pick 2 well-known Leonardo folios (high online presence)
// and 2 less-known ones from the same codex
const CONTAMINATION_PAGES = [
  // "Famous" – these specific folios have been individually photographed,
  // discussed, and transcribed in many online and print sources
  {
    name: 'Leonardo Codex Arundel f15r (well-known optics)',
    iaId: 'etudessurlacheve00leon',
    page: 49,
    fame: 'high',
  },
  {
    name: 'Leonardo Codex Arundel f22r (well-known water dynamics)',
    iaId: 'etudessurlacheve00leon',
    page: 53,
    fame: 'high',
  },
  // "Obscure" – adjacent pages in the same codex, same physical conditions,
  // less commonly referenced in secondary literature
  {
    name: 'Leonardo Codex Arundel f18v (adjacent, low fame)',
    iaId: 'etudessurlacheve00leon',
    page: 51,
    fame: 'low',
  },
  {
    name: 'Leonardo Codex Arundel f20r (adjacent, low fame)',
    iaId: 'etudessurlacheve00leon',
    page: 52,
    fame: 'low',
  },
];

// Known Richter transcription for p49 (optics passage)
// From The Literary Works of Leonardo da Vinci, ed. Richter 1883
const RICHTER_REFERENCE = `Ogni azione fatta da la natura co' le cose naturali è fatta per la più breve via. Ogni corpo si muove per la più breve via. La linia è tanto più potente quanto è più breve. Ogni cosa per la più breve via si move. Nessuna cosa va per via obliqua quando può andare per via dritta. La natura non opera cosa superflua. La brevità è virtù delle operazioni della natura.`;

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
    if (i + 5 < texts.length) await new Promise(r => setTimeout(r, 300));
  }
  return results;
}

async function fetchImageAsBase64(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer()).toString('base64');
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

function iaUrl(iaId, pageNum) {
  const pad = String(pageNum).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${iaId}%2F${iaId}_jp2.zip%2F${iaId}_jp2%2F${iaId}_${pad}.jp2/full/max/0/default.jpg`;
}

const OCR_PROMPT = `Transcribe this historical manuscript page to plain text.
This is a page from a Leonardo da Vinci manuscript. The text is written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.
Preserve original spelling exactly. Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes or reconstruct text you cannot read.`;

const PRINT_PROMPT = `Transcribe this historical printed book page to plain text.
Preserve the original Latin/Italian exactly. Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes.`;

async function geminiOcr(imageBase64, prompt, apiKey, temperature) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
      const response = await ai.models.generateContent({
        model: OCR_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        }],
        config: {
          temperature,
          abortSignal: controller.signal,
        },
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

// ── Experiment A: Temperature sweep ─────────────────────────────────────────

async function temperatureSweep(page, prompt, imageB64, apiKey, richterRef) {
  console.log(`\nTemperature sweep: ${page.name}`);
  const sweepResults = [];

  // Get Richter reference embedding once
  const [richterEmb] = await getEmbeddings([richterRef], apiKey);

  for (const temp of TEMPERATURES) {
    console.log(`  T=${temp}: running ${N_PER_TEMP} OCR passes...`);
    const runs = [];
    for (let i = 0; i < N_PER_TEMP; i++) {
      try {
        const text = await geminiOcr(imageB64, prompt, apiKey, temp);
        const stripped = stripTags(text);
        runs.push(stripped);
        process.stdout.write(`    run${i+1}: ${stripped.length}ch `);
      } catch (e) {
        process.stdout.write(`    run${i+1}: ERR `);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log();

    if (runs.length < 2) {
      sweepResults.push({ temp, n: runs.length, self_consistency: null, vs_richter: null });
      continue;
    }

    // Embeddings for all runs
    const embs = await getEmbeddings(runs, apiKey);

    // Self-consistency
    let sum = 0, count = 0;
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        if (embs[i] && embs[j]) {
          sum += cosineSimilarity(embs[i], embs[j]);
          count++;
        }
      }
    }
    const selfConsistency = count > 0 ? sum / count : 0;

    // vs Richter (only if we have a reference)
    let vsRichter = null;
    if (richterEmb) {
      let rsum = 0, rcount = 0;
      for (let i = 0; i < embs.length; i++) {
        if (embs[i]) {
          rsum += cosineSimilarity(embs[i], richterEmb);
          rcount++;
        }
      }
      vsRichter = rcount > 0 ? rsum / rcount : null;
    }

    // Check if T=0 output looks like it's reproducing Richter verbatim
    const t0words = runs[0]?.toLowerCase().split(/\s+/) || [];
    const richterWords = richterRef.toLowerCase().split(/\s+/);
    const overlap = t0words.filter(w => richterWords.includes(w)).length;
    const jaccard = overlap / new Set([...t0words, ...richterWords]).size;

    sweepResults.push({
      temp,
      n: runs.length,
      self_consistency: selfConsistency,
      vs_richter: vsRichter,
      t0_jaccard_vs_richter: temp === 0.0 ? jaccard : null,
      runs_preview: runs.slice(0, 2).map(r => r.substring(0, 80)),
    });

    console.log(`  T=${temp}: self=${(selfConsistency*100).toFixed(1)}% vs_richter=${vsRichter ? (vsRichter*100).toFixed(1)+'%' : 'n/a'}`);
  }

  return sweepResults;
}

// ── Experiment B: Famous vs obscure ─────────────────────────────────────────

async function famousVsObscure(pages, apiKey) {
  console.log('\n=== Experiment B: Famous vs Obscure ===\n');
  const results = [];

  for (const page of pages) {
    console.log(`${page.name} (fame: ${page.fame})`);
    const url = iaUrl(page.iaId, page.page);

    let imgB64;
    try {
      imgB64 = await fetchImageAsBase64(url);
      console.log(`  Image: ${(imgB64.length * 0.75 / 1024).toFixed(0)}KB`);
    } catch (e) {
      console.log(`  SKIP: ${e.message}`);
      continue;
    }

    const runs = [];
    for (let i = 0; i < 5; i++) {
      try {
        const text = await geminiOcr(imgB64, OCR_PROMPT, apiKey, 1.0);
        runs.push(stripTags(text));
        process.stdout.write(`  run${i+1}:${stripTags(text).length}ch `);
      } catch {
        process.stdout.write(`  run${i+1}:ERR `);
      }
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log();

    if (runs.length < 2) continue;

    const embs = await getEmbeddings(runs, apiKey);
    let sum = 0, count = 0;
    for (let i = 0; i < runs.length; i++) {
      for (let j = i + 1; j < runs.length; j++) {
        if (embs[i] && embs[j]) {
          sum += cosineSimilarity(embs[i], embs[j]);
          count++;
        }
      }
    }
    const selfConsistency = count > 0 ? sum / count : 0;
    results.push({ ...page, self_consistency: selfConsistency });
    console.log(`  self-consistency: ${(selfConsistency*100).toFixed(1)}%`);
  }

  // Summarize
  const high = results.filter(r => r.fame === 'high');
  const low = results.filter(r => r.fame === 'low');
  const avgHigh = high.reduce((s, r) => s + r.self_consistency, 0) / high.length;
  const avgLow = low.reduce((s, r) => s + r.self_consistency, 0) / low.length;
  console.log(`\n  Famous pages avg: ${(avgHigh*100).toFixed(1)}%`);
  console.log(`  Obscure pages avg: ${(avgLow*100).toFixed(1)}%`);
  console.log(`  Difference: ${((avgHigh - avgLow)*100).toFixed(1)}pp`);

  return { pages: results, avg_high: avgHigh, avg_low: avgLow, delta: avgHigh - avgLow };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  console.log('Temperature Sweep + Training Contamination Test\n');

  // Fetch images
  console.log('Fetching images...');
  const leonardoImg = await fetchImageAsBase64(iaUrl(LEONARDO_PAGE.iaId, LEONARDO_PAGE.page));
  const printedImg = await fetchImageAsBase64(iaUrl(PRINTED_PAGE.iaId, PRINTED_PAGE.page));
  console.log(`Leonardo: ${(leonardoImg.length * 0.75 / 1024).toFixed(0)}KB`);
  console.log(`Printed: ${(printedImg.length * 0.75 / 1024).toFixed(0)}KB`);

  // Experiment A: Temperature sweep
  console.log('\n=== Experiment A: Temperature Sweep ===');

  const leonardoSweep = await temperatureSweep(
    LEONARDO_PAGE, OCR_PROMPT, leonardoImg, apiKey, RICHTER_REFERENCE
  );
  const printedSweep = await temperatureSweep(
    PRINTED_PAGE, PRINT_PROMPT, printedImg, apiKey, null
  );

  // Experiment B: Famous vs obscure
  const contamination = await famousVsObscure(CONTAMINATION_PAGES, apiKey);

  // Save results
  const results = {
    timestamp: new Date().toISOString(),
    experiment_a_temperature_sweep: {
      leonardo: leonardoSweep,
      printed: printedSweep,
    },
    experiment_b_contamination: contamination,
  };

  const outPath = path.join(RESULTS_DIR, 'temperature-contamination.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nResults saved: ${outPath}`);

  // Summary table
  console.log('\n=== TEMPERATURE SWEEP SUMMARY ===');
  console.log('  T    Printed   Leonardo  vs_Richter');
  for (let i = 0; i < TEMPERATURES.length; i++) {
    const t = TEMPERATURES[i];
    const p = printedSweep[i];
    const l = leonardoSweep[i];
    const ps = p?.self_consistency != null ? `${(p.self_consistency*100).toFixed(1)}%`.padStart(7) : '    n/a';
    const ls = l?.self_consistency != null ? `${(l.self_consistency*100).toFixed(1)}%`.padStart(9) : '      n/a';
    const lr = l?.vs_richter != null ? `${(l.vs_richter*100).toFixed(1)}%`.padStart(10) : '       n/a';
    console.log(`${t.toFixed(1).padStart(4)}  ${ps}  ${ls}  ${lr}`);
  }

  console.log('\n=== CONTAMINATION SUMMARY ===');
  console.log(`Famous avg: ${(contamination.avg_high*100).toFixed(1)}%`);
  console.log(`Obscure avg: ${(contamination.avg_low*100).toFixed(1)}%`);
  const delta = (contamination.delta * 100).toFixed(1);
  const interpret = Math.abs(contamination.delta) < 0.02
    ? 'No contamination signal (Δ < 2pp)'
    : contamination.delta > 0
      ? `Famous pages score higher — possible contamination signal (Δ=${delta}pp)`
      : `Obscure pages score higher — no contamination signal (Δ=${delta}pp)`;
  console.log(interpret);
}

main().catch(e => { console.error(e); process.exit(1); });
