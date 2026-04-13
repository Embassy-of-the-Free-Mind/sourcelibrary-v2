#!/usr/bin/env node
/**
 * Expanded Corpus OCR Consistency Evaluation
 *
 * Tests self-consistency across multiple Leonardo codices (different topics)
 * plus printed and manuscript controls.
 *
 * Uses embedding similarity (gemini-embedding-001) as primary metric.
 * Applies best preprocessing: flip + contrast for mirror-script pages.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/eval/expanded-corpus-eval.mjs
 *   node scripts/eval/expanded-corpus-eval.mjs --skip-controls   # Leonardo only
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
const N_RUNS = 3;
const RETRY_MAX = 3;
const RETRY_DELAY = 5000;

// ── Leonardo Codices by Topic ───────────────────────────────────────────────

function iaIiif(iaId, pageNum) {
  const pad = String(pageNum).padStart(4, '0');
  return `https://iiif.archive.org/image/iiif/3/${iaId}%2F${iaId}_jp2.zip%2F${iaId}_jp2%2F${iaId}_${pad}.jp2/full/max/0/default.jpg`;
}

const CORPUS = [
  // Leonardo codices — different topics, all mirror-script
  {
    key: 'leonardo_optics',
    label: 'Leonardo: Optics/Hair studies',
    topic: 'optics',
    type: 'mirror-script',
    ia_id: 'etudessurlacheve00leon',
    pages: [17, 25, 49, 53],  // known content pages
  },
  {
    key: 'leonardo_anatomy',
    label: 'Leonardo: Anatomy (Windsor)',
    topic: 'anatomy',
    type: 'mirror-script',
    ia_id: 'fragmentsetudesa00leon',
    pages: [15, 25, 35, 45],  // sample content pages
  },
  {
    key: 'leonardo_water',
    label: 'Leonardo: Water/Hydraulics',
    topic: 'water',
    type: 'mirror-script',
    ia_id: 'delmotoemisurad00leongoog',
    pages: [20, 40, 60, 80],
  },
  {
    key: 'leonardo_flight',
    label: 'Leonardo: Flight of Birds',
    topic: 'flight',
    type: 'mirror-script',
    ia_id: 'IManoscrittiDiLeonardoDaVinci',
    pages: [15, 25, 35, 45],
  },
  {
    key: 'leonardo_geometry',
    label: 'Leonardo: Geometry',
    topic: 'geometry',
    type: 'mirror-script',
    ia_id: 'notesetcroquisde00leon',
    pages: [10, 20, 30, 40],
  },
  {
    key: 'leonardo_botany',
    label: 'Leonardo: Botany',
    topic: 'botany',
    type: 'mirror-script',
    ia_id: 'gri_33125017543253',
    pages: [10, 20, 30, 40],
  },
  {
    key: 'leonardo_physiognomy',
    label: 'Leonardo: Physiognomy',
    topic: 'physiognomy',
    type: 'mirror-script',
    ia_id: 'gri_33125017557550',
    pages: [10, 20, 30, 40],
  },
  {
    key: 'leonardo_architecture',
    label: 'Leonardo: Architecture/Fortifications',
    topic: 'architecture',
    type: 'mirror-script',
    ia_id: 'notesetcroquis00leon',  // if this doesn't work, try notesetcroquisar00leon
    pages: [10, 20, 30, 40],
  },

  // Controls
  {
    key: 'printed_vitruvius',
    label: 'Printed: Vitruvius (1521)',
    topic: 'architecture',
    type: 'printed',
    ia_id: 'mvitrvviidearchi00vitr',
    pages: [25, 33, 47],
  },
  {
    key: 'printed_drebbel',
    label: 'Printed: Drebbel Tractatus',
    topic: 'alchemy',
    type: 'printed',
    r2: (p) => {
      const pad = String(p).padStart(4, '0');
      return `https://images.sourcelibrary.org/pages/6836f8ee811c8ab472a49e36/${pad}.jpg`;
    },
    pages: [5, 9, 13],
  },
  {
    key: 'trattato_printed',
    label: 'Trattato della pittura (printed, 1651)',
    topic: 'painting',
    type: 'printed',
    ia_id: 'gri_33125008484301',
    pages: [20, 40, 60],
  },
];

// ── Prompts ─────────────────────────────────────────────────────────────────

const PROMPT_LEONARDO = `Transcribe this historical manuscript page to plain text.

This is a page from a Leonardo da Vinci manuscript. The text may be written in mirror-script (right to left). Transcribe it as normal left-to-right Italian.

Rules:
1. Preserve original spelling, capitalization, punctuation
2. Mark illegible text with <unclear>...</unclear>
3. Describe diagrams briefly in [brackets]
4. If the page is blank or has no text, say "BLANK PAGE"
5. Do NOT add interpretive notes, translations, or scholarly commentary
6. Do NOT reconstruct text you cannot actually read — only transcribe what is visible`;

const PROMPT_PRINTED = `Transcribe this historical printed page to plain text.
Preserve original spelling, capitalization, punctuation.
Mark illegible text with <unclear>...</unclear>.
Do NOT add interpretive notes or commentary.`;

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

function jaccardSimilarity(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const intersection = [...wordsA].filter(x => wordsB.has(x));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size === 0 ? 0 : intersection.length / union.size;
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

async function pairwiseSimilarity(texts, apiKey) {
  const stripped = texts.map(t => stripTags(t));
  const embeddings = await getEmbeddings(stripped, apiKey);
  const pairs = [];
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const cosine = (embeddings[i] && embeddings[j])
        ? cosineSimilarity(embeddings[i], embeddings[j]) : null;
      const jaccard = jaccardSimilarity(stripped[i], stripped[j]);
      pairs.push({ i, j, cosine, jaccard });
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
      mean: jaccards.length ? jaccards.reduce((a, b) => a + b, 0) / jaccards.length : 0,
      min: jaccards.length ? Math.min(...jaccards) : 0,
      max: jaccards.length ? Math.max(...jaccards) : 0,
    },
    pairs,
  };
}

async function fetchImageBuffer(url) {
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      return Buffer.from(await resp.arrayBuffer());
    } catch (e) {
      if (attempt < RETRY_MAX - 1) {
        console.log(`      Retry ${attempt + 1}: ${e.message}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1)));
      } else throw e;
    }
  }
}

async function flipAndContrast(buffer) {
  return sharp(buffer)
    .flop()
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1.5 })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function geminiOcr(imageBase64, model, prompt, apiKey) {
  const ai = new GoogleGenAI({ apiKey });
  for (let attempt = 0; attempt < RETRY_MAX; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 90000);
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
        console.log(`      OCR retry ${attempt + 1}: ${e.message}`);
        await new Promise(r => setTimeout(r, RETRY_DELAY * (attempt + 1) * 2));
      } else throw e;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('Missing GEMINI_API_KEY'); process.exit(1); }

  const skipControls = process.argv.includes('--skip-controls');
  const sources = skipControls
    ? CORPUS.filter(c => c.type === 'mirror-script')
    : CORPUS;

  console.log(`Expanded Corpus OCR Evaluation`);
  console.log(`Sources: ${sources.length}, N=${N_RUNS} runs per page`);
  console.log(`Leonardo pages get flip+contrast preprocessing\n`);

  const results = [];

  for (const source of sources) {
    console.log(`\n=== ${source.label} (${source.topic}) ===`);
    const prompt = source.type === 'mirror-script' ? PROMPT_LEONARDO : PROMPT_PRINTED;
    const pageResults = [];

    for (const pageNum of source.pages.slice(0, 2)) {  // 2 pages per source
      const url = source.r2
        ? source.r2(pageNum)
        : iaIiif(source.ia_id, pageNum);

      console.log(`  Page ${pageNum}:`);

      let imgBuf;
      try {
        imgBuf = await fetchImageBuffer(url);
        console.log(`    Image: ${(imgBuf.length / 1024).toFixed(0)}KB`);
      } catch (e) {
        console.log(`    SKIP — fetch failed: ${e.message}`);
        continue;
      }

      // For mirror-script: test both original and flip+contrast
      const conditions = source.type === 'mirror-script'
        ? ['original', 'flip_contrast']
        : ['original'];

      for (const condition of conditions) {
        let processedB64;
        if (condition === 'flip_contrast') {
          const processed = await flipAndContrast(imgBuf);
          processedB64 = processed.toString('base64');
          console.log(`    [${condition}]`);
        } else {
          processedB64 = imgBuf.toString('base64');
          console.log(`    [original]`);
        }

        const transcriptions = [];
        for (let run = 0; run < N_RUNS; run++) {
          try {
            const text = await geminiOcr(processedB64, GEMINI_FLASH, prompt, apiKey);
            transcriptions.push(text);
            const stripped = stripTags(text);
            console.log(`      Run ${run + 1}: ${stripped.length} chars, ${stripped.split(/\s+/).length} words`);
          } catch (e) {
            console.log(`      Run ${run + 1}: ERROR — ${e.message}`);
          }
          await new Promise(r => setTimeout(r, 2000));
        }

        if (transcriptions.length < 2) {
          console.log(`      Not enough runs`);
          continue;
        }

        const similarity = await pairwiseSimilarity(transcriptions, apiKey);
        const result = {
          source: source.key,
          label: source.label,
          topic: source.topic,
          type: source.type,
          page: pageNum,
          condition,
          n_runs: transcriptions.length,
          similarity,
          run_lengths: transcriptions.map(t => stripTags(t).length),
        };

        pageResults.push(result);
        results.push(result);

        const jac = (similarity.jaccard.mean * 100).toFixed(1);
        const emb = similarity.embedding.mean
          ? (similarity.embedding.mean * 100).toFixed(1) : 'N/A';
        console.log(`      Jaccard: ${jac}%  Embedding: ${emb}%`);
      }
    }
  }

  // Save all results
  const outPath = path.join(RESULTS_DIR, 'expanded-corpus.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nSaved: ${outPath}`);

  // Summary table
  console.log('\n=== Summary ===\n');
  console.log('┌──────────────────────────────────────────┬────────────┬──────────┬──────────┐');
  console.log('│ Source                                   │ Condition  │ Jaccard  │ Embedding│');
  console.log('├──────────────────────────────────────────┼────────────┼──────────┼──────────┤');

  for (const r of results) {
    const label = `${r.label} p${r.page}`.substring(0, 40).padEnd(40);
    const cond = r.condition.padEnd(10);
    const jac = (r.similarity.jaccard.mean * 100).toFixed(1).padStart(6) + '%';
    const emb = r.similarity.embedding.mean
      ? (r.similarity.embedding.mean * 100).toFixed(1).padStart(6) + '%'
      : '   N/A ';
    console.log(`│ ${label} │ ${cond} │ ${jac} │ ${emb} │`);
  }

  console.log('└──────────────────────────────────────────┴────────────┴──────────┴──────────┘');

  // Aggregate by type
  console.log('\n=== Aggregate by Type ===\n');
  const byType = {};
  for (const r of results) {
    const key = `${r.type}|${r.condition}`;
    if (!byType[key]) byType[key] = { embeddings: [], jaccards: [], label: `${r.type} (${r.condition})` };
    if (r.similarity.embedding.mean) byType[key].embeddings.push(r.similarity.embedding.mean);
    byType[key].jaccards.push(r.similarity.jaccard.mean);
  }

  for (const [, data] of Object.entries(byType)) {
    const meanEmb = data.embeddings.length
      ? (data.embeddings.reduce((a, b) => a + b, 0) / data.embeddings.length * 100).toFixed(1)
      : 'N/A';
    const meanJac = (data.jaccards.reduce((a, b) => a + b, 0) / data.jaccards.length * 100).toFixed(1);
    console.log(`  ${data.label.padEnd(35)} Embedding: ${meanEmb}%  Jaccard: ${meanJac}%`);
  }
}

main();
