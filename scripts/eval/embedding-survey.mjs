#!/usr/bin/env node
/**
 * Embedding Alignment Survey
 *
 * Properly designed experiment measuring OCR→Translation embedding distance
 * across languages and document types (manuscript vs print).
 *
 * Design:
 *   - 5 languages × 2 conditions (manuscript, print) = 10 cells
 *   - 20 pages per cell (sampled from different books)
 *   - Stratified by page position (avoid title pages, colophons)
 *   - Total: 200 pages, ~200 embedding API calls
 *
 * Independent variables:
 *   - Language (Latin, Hebrew, Arabic, Sanskrit, Greek)
 *   - Document type (manuscript vs print, proxied by provider)
 *
 * Dependent variable:
 *   - Cosine distance between OCR embedding and translation embedding
 *
 * Controls:
 *   - Same embedding model (gemini-embedding-2-preview, 768d)
 *   - Same text cleaning (strip XML + markdown)
 *   - Pages with ≥100 chars of both OCR and translation
 *   - Skip first 3 and last 2 pages (title/colophon bias)
 */

import { MongoClient } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { cleanText, cosineSimilarity, cosineDistance } from './lib/metrics.mjs';
import { embedTexts } from './lib/embedding-eval.mjs';

// ── Config ─────────────────────────────────────────────────────────

const PAGES_PER_CELL = 20;
const MIN_TEXT_LENGTH = 100;
const EMBEDDING_DELAY_MS = 300;

const MANUSCRIPT_PROVIDERS = ['bph', 'e-codices', 'chester_beatty', 'bdrc', 'bodleian'];
const PRINT_PROVIDERS = ['internet_archive', 'e-rara', 'google_books', 'gallica', 'bsb'];

const LANGUAGES = ['Latin', 'Hebrew', 'Arabic', 'Sanskrit', 'Greek'];

// ── Env ────────────────────────────────────────────────────────────

function loadEnv() {
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
        }
      }
      break;
    } catch { /* next */ }
  }
}

loadEnv();

// ── Sample pages ───────────────────────────────────────────────────

async function sampleCell(db, language, providers, n) {
  const books = await db.collection('books').find(
    {
      language,
      pages_translated: { $gte: 10 },
      'image_source.provider': { $in: providers },
    },
    { projection: { id: 1, title: 1, pages_count: 1, 'image_source.provider': 1 }, limit: 50 },
  ).toArray();

  if (books.length === 0) return [];

  // Sample pages across books (round-robin, skip first 3 and last 2)
  const sampled = [];
  let bookIdx = 0;

  while (sampled.length < n && bookIdx < books.length * 3) {
    const book = books[bookIdx % books.length];
    bookIdx++;

    const skip = Math.floor(Math.random() * Math.max(1, (book.pages_count || 20) - 5)) + 3;

    const page = await db.collection('pages').findOne(
      {
        book_id: book.id,
        page_number: { $gte: 3, $lte: (book.pages_count || 100) - 2 },
        'ocr.data': { $exists: true, $ne: '' },
        'translation.data': { $exists: true, $ne: '' },
      },
      {
        projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'translation.data': 1 },
        skip: skip % 10,
        maxTimeMS: 5000,
      },
    );

    if (!page) continue;

    const ocrClean = cleanText(page.ocr.data);
    const transClean = cleanText(page.translation.data);

    if (ocrClean.length < MIN_TEXT_LENGTH || transClean.length < MIN_TEXT_LENGTH) continue;

    // Avoid duplicates
    const key = `${page.book_id}-${page.page_number}`;
    if (sampled.some(s => `${s.bookId}-${s.pageNumber}` === key)) continue;

    sampled.push({
      bookId: book.id,
      bookTitle: book.title,
      pageNumber: page.page_number,
      provider: book.image_source?.provider,
      ocrText: ocrClean,
      translationText: transClean,
      ocrLength: ocrClean.length,
      translationLength: transClean.length,
    });
  }

  return sampled;
}

// ── Main ───────────────────────────────────────────────────────────

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

console.log('Embedding Alignment Survey');
console.log(`Design: ${LANGUAGES.length} languages × 2 conditions × ${PAGES_PER_CELL} pages = ${LANGUAGES.length * 2 * PAGES_PER_CELL} target pages\n`);

const results = {
  design: {
    languages: LANGUAGES,
    conditions: ['manuscript', 'print'],
    pagesPerCell: PAGES_PER_CELL,
    embeddingModel: 'gemini-embedding-2-preview',
    embeddingDims: 768,
    minTextLength: MIN_TEXT_LENGTH,
    date: new Date().toISOString().slice(0, 10),
  },
  cells: [],
  summary: {},
};

for (const language of LANGUAGES) {
  for (const [condition, providers] of [['manuscript', MANUSCRIPT_PROVIDERS], ['print', PRINT_PROVIDERS]]) {
    const cellName = `${language}-${condition}`;
    console.log(`\n── ${cellName} ──`);

    // Sample pages
    const pages = await sampleCell(db, language, providers, PAGES_PER_CELL);
    console.log(`  Sampled ${pages.length} pages from ${new Set(pages.map(p => p.bookId)).size} books`);

    if (pages.length === 0) {
      console.log(`  SKIPPED (no data)`);
      results.cells.push({ cell: cellName, language, condition, n: 0, skipped: true });
      continue;
    }

    // Compute embeddings in batches of 5 (10 texts per batch: 5 OCR + 5 trans)
    const distances = [];
    const BATCH = 5;

    for (let i = 0; i < pages.length; i += BATCH) {
      const batch = pages.slice(i, i + BATCH);
      const texts = [];
      for (const p of batch) {
        texts.push(p.ocrText.slice(0, 8000));
        texts.push(p.translationText.slice(0, 8000));
      }

      try {
        const embeddings = await embedTexts(texts);
        for (let j = 0; j < batch.length; j++) {
          const ocrEmb = embeddings[j * 2];
          const transEmb = embeddings[j * 2 + 1];
          const dist = cosineDistance(ocrEmb, transEmb);
          distances.push({
            bookTitle: batch[j].bookTitle,
            pageNumber: batch[j].pageNumber,
            provider: batch[j].provider,
            distance: dist,
            ocrLength: batch[j].ocrLength,
            translationLength: batch[j].translationLength,
          });
        }
        process.stdout.write(`  Embedded ${Math.min(i + BATCH, pages.length)}/${pages.length}\r`);
      } catch (err) {
        console.error(`  Batch error: ${err.message.slice(0, 100)}`);
      }

      if (i + BATCH < pages.length) await new Promise(r => setTimeout(r, EMBEDDING_DELAY_MS));
    }
    console.log(`  Embedded ${distances.length}/${pages.length}`);

    // Stats
    const dists = distances.map(d => d.distance);
    const mean = dists.reduce((s, d) => s + d, 0) / (dists.length || 1);
    const variance = dists.reduce((s, d) => s + (d - mean) ** 2, 0) / (dists.length || 1);
    const stddev = Math.sqrt(variance);
    const median = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)] || 0;
    const min = Math.min(...dists);
    const max = Math.max(...dists);

    // Flag outliers (>2σ)
    const outliers = distances.filter(d => (d.distance - mean) / stddev > 2);

    const cell = {
      cell: cellName,
      language,
      condition,
      n: distances.length,
      mean,
      median,
      stddev,
      min,
      max,
      outliers: outliers.map(o => ({ book: o.bookTitle?.slice(0, 40), page: o.pageNumber, distance: o.distance })),
      pages: distances,
    };

    results.cells.push(cell);
    results.summary[cellName] = { n: cell.n, mean, median, stddev, min, max, outlierCount: outliers.length };

    console.log(`  Mean: ${mean.toFixed(4)}  Median: ${median.toFixed(4)}  SD: ${stddev.toFixed(4)}  Range: [${min.toFixed(3)}, ${max.toFixed(3)}]  Outliers: ${outliers.length}`);
  }
}

await client.close();

// Save results
mkdirSync('scripts/eval/results', { recursive: true });
const filepath = `scripts/eval/results/embedding-survey-${results.design.date}.json`;
writeFileSync(filepath, JSON.stringify(results, null, 2) + '\n');
console.log(`\nResults saved: ${filepath}`);

// Print summary table
console.log('\n' + '='.repeat(90));
console.log('EMBEDDING ALIGNMENT SURVEY — SUMMARY');
console.log('='.repeat(90));
console.log(`${'Language'.padEnd(12)} ${'Condition'.padEnd(12)} ${'N'.padStart(4)} ${'Mean'.padStart(8)} ${'Median'.padStart(8)} ${'SD'.padStart(8)} ${'Min'.padStart(8)} ${'Max'.padStart(8)} ${'Out'.padStart(4)}`);
console.log('-'.repeat(90));
for (const cell of results.cells) {
  if (cell.skipped) {
    console.log(`${cell.language.padEnd(12)} ${cell.condition.padEnd(12)} ${'0'.padStart(4)}    — (no data)`);
  } else {
    const s = results.summary[cell.cell];
    console.log(`${cell.language.padEnd(12)} ${cell.condition.padEnd(12)} ${String(s.n).padStart(4)} ${s.mean.toFixed(4).padStart(8)} ${s.median.toFixed(4).padStart(8)} ${s.stddev.toFixed(4).padStart(8)} ${s.min.toFixed(3).padStart(8)} ${s.max.toFixed(3).padStart(8)} ${String(s.outlierCount).padStart(4)}`);
  }
}
console.log('='.repeat(90));
