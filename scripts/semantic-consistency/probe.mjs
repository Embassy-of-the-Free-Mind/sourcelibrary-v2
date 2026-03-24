#!/usr/bin/env node
/**
 * Semantic Consistency Probe
 *
 * Measures OCR and translation quality using Gemini embeddings:
 * 1. Cross-lingual alignment: cosine(source_embed, translation_embed)
 *    → catches garbled OCR, dropped content, severe mistranslation
 * 2. Multi-temperature OCR consistency (SEU approach):
 *    → run OCR at temps 0, 0.3, 0.6 → embed → measure cluster tightness
 *    → catches ambiguous/damaged passages the model is uncertain about
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/semantic-consistency/probe.mjs
 *
 *   Options:
 *     --sample N        Number of pages to sample (default: 100)
 *     --book BOOK_ID    Restrict to a specific book
 *     --skip-ocr-temps  Skip multi-temperature OCR (faster, alignment only)
 *     --language LANG   Filter by OCR language (e.g., 'la', 'de', 'ar')
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── Config ──────────────────────────────────────────────────────────────────
const EMBEDDING_MODEL = 'gemini-embedding-001';
const OCR_MODEL = 'gemini-2.5-flash-preview-05-20';
const TEMPERATURES = [0, 0.3, 0.6];
const BATCH_SIZE = 5; // embedding requests per batch (small to avoid timeouts)
const OCR_CONCURRENCY = 3;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const SAMPLE_SIZE = parseInt(getArg('sample') || '100', 10);
const BOOK_ID = getArg('book');
const SKIP_OCR_TEMPS = hasFlag('skip-ocr-temps');
const LANGUAGE_FILTER = getArg('language');

// ── Gemini setup ────────────────────────────────────────────────────────────
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('GEMINI_API_KEY not set');
  process.exit(1);
}
const genai = new GoogleGenerativeAI(apiKey);

// ── Math helpers ────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function meanPairwiseCosine(vectors) {
  if (vectors.length < 2) return 1.0;
  let sum = 0, count = 0;
  for (let i = 0; i < vectors.length; i++) {
    for (let j = i + 1; j < vectors.length; j++) {
      sum += cosineSimilarity(vectors[i], vectors[j]);
      count++;
    }
  }
  return sum / count;
}

function mean(arr) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function stddev(arr) {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length);
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor(p / 100 * (sorted.length - 1));
  return sorted[idx];
}

// ── Gemini embedding ────────────────────────────────────────────────────────
async function embedTexts(texts) {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });

  // Batch embed — Gemini supports batchEmbedContents
  const results = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const requests = batch.map(text => ({
      content: { parts: [{ text: text.slice(0, 8000) }] }, // truncate long pages
    }));

    try {
      const response = await model.batchEmbedContents({ requests });
      for (const emb of response.embeddings) {
        results.push(emb.values);
      }
      process.stdout.write(`  ${results.length}/${texts.length}\r`);
    } catch (err) {
      console.error(`\n  Embedding batch error at ${i}: ${err.message}`);
      // Fall back to one-at-a-time for this batch
      for (const req of requests) {
        try {
          const single = await model.embedContent(req.content);
          results.push(single.embedding.values);
        } catch (e2) {
          console.error(`  Single embed failed: ${e2.message}`);
          results.push(null); // placeholder
        }
      }
    }

    // Delay between batches
    if (i + BATCH_SIZE < texts.length) {
      await new Promise(r => setTimeout(r, 300));
    }
  }
  return results;
}

async function embedSingle(text) {
  const [result] = await embedTexts([text]);
  return result;
}

// ── Multi-temperature OCR ───────────────────────────────────────────────────
async function ocrAtTemperature(imageUrl, temperature) {
  const model = genai.getGenerativeModel({
    model: OCR_MODEL,
    generationConfig: { temperature },
  });

  // Fetch the image
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const buffer = await response.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = response.headers.get('content-type') || 'image/jpeg';

  const result = await model.generateContent([
    { inlineData: { data: base64, mimeType } },
    { text: 'Transcribe all text on this page exactly as written. Preserve original spelling, punctuation, and line breaks. Do not translate or modernize.' },
  ]);

  return result.response.text();
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Semantic Consistency Probe');
  console.log('─'.repeat(50));
  console.log(`Sample size: ${SAMPLE_SIZE}`);
  console.log(`Book filter: ${BOOK_ID || 'none'}`);
  console.log(`Language filter: ${LANGUAGE_FILTER || 'none'}`);
  console.log(`OCR temperature sampling: ${SKIP_OCR_TEMPS ? 'skipped' : 'enabled'}`);
  console.log();

  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  // Sample pages — oversample then filter client-side (avoids slow $match on unindexed fields)
  const oversample = SAMPLE_SIZE * 3;
  let pages;

  if (BOOK_ID) {
    // For single book, just get all pages directly
    pages = await db.collection('pages')
      .find({ book_id: BOOK_ID, 'ocr.data': { $exists: true, $ne: '' }, 'translation.data': { $exists: true, $ne: '' } })
      .limit(SAMPLE_SIZE)
      .toArray();
  } else {
    // Random sample — $sample first (fast random scan), then filter
    console.log('Sampling pages...');
    const raw = await db.collection('pages').aggregate([
      { $sample: { size: oversample } },
      { $project: { id: 1, book_id: 1, page_number: 1, photo: 1, 'ocr.data': 1, 'ocr.language': 1, 'translation.data': 1 } },
    ]).toArray();

    pages = raw.filter(p =>
      p.ocr?.data && p.translation?.data &&
      (!LANGUAGE_FILTER || p.ocr?.language === LANGUAGE_FILTER)
    ).slice(0, SAMPLE_SIZE);
  }

  // Look up book info for the sampled pages
  const bookIds = [...new Set(pages.map(p => p.book_id))];
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } }, { projection: { id: 1, title: 1, display_title: 1, language: 1, year: 1 } })
    .toArray();
  const bookMap = Object.fromEntries(books.map(b => [b.id, b]));
  for (const p of pages) p.book = bookMap[p.book_id] || null;

  console.log(`Sampled ${pages.length} pages with OCR + translation\n`);

  if (pages.length === 0) {
    console.log('No pages matched. Check filters.');
    await client.close();
    return;
  }

  // ── Phase 1: Cross-lingual alignment ──────────────────────────────────
  console.log('Phase 1: Cross-lingual alignment (source ↔ translation)');
  console.log('Embedding OCR texts...');
  const ocrTexts = pages.map(p => p.ocr.data);
  const ocrEmbeddings = await embedTexts(ocrTexts);

  console.log('Embedding translations...');
  const translationTexts = pages.map(p => p.translation.data);
  const translationEmbeddings = await embedTexts(translationTexts);

  // Compute per-page alignment scores
  const results = pages.map((page, i) => {
    const ocrEmb = ocrEmbeddings[i];
    const transEmb = translationEmbeddings[i];
    return {
      pageId: page.id,
      bookId: page.book_id,
      bookTitle: (page.book?.display_title || page.book?.title || 'Unknown').slice(0, 60),
      pageNumber: page.page_number,
      language: page.ocr?.language || 'unknown',
      ocrLength: page.ocr.data.length,
      translationLength: page.translation.data.length,
      alignment: (ocrEmb && transEmb) ? cosineSimilarity(ocrEmb, transEmb) : null,
      photo: page.photo,
      ocrConsistency: null, // filled in phase 2
    };
  }).filter(r => r.alignment !== null);

  // ── Phase 1 results ───────────────────────────────────────────────────
  const alignments = results.map(r => r.alignment);
  console.log('\n── Cross-lingual Alignment ──');
  console.log(`  Mean:   ${mean(alignments).toFixed(4)}`);
  console.log(`  StdDev: ${stddev(alignments).toFixed(4)}`);
  console.log(`  Min:    ${Math.min(...alignments).toFixed(4)}`);
  console.log(`  Max:    ${Math.max(...alignments).toFixed(4)}`);
  console.log(`  P5:     ${percentile(alignments, 5).toFixed(4)}`);
  console.log(`  P25:    ${percentile(alignments, 25).toFixed(4)}`);
  console.log(`  Median: ${percentile(alignments, 50).toFixed(4)}`);

  // Breakdown by language
  const byLang = {};
  for (const r of results) {
    if (!byLang[r.language]) byLang[r.language] = [];
    byLang[r.language].push(r.alignment);
  }
  console.log('\n  By language:');
  for (const [lang, scores] of Object.entries(byLang).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`    ${lang.padEnd(8)} n=${String(scores.length).padStart(4)}  mean=${mean(scores).toFixed(4)}  std=${stddev(scores).toFixed(4)}`);
  }

  // ── Phase 2: Multi-temperature OCR consistency (optional) ─────────────
  if (!SKIP_OCR_TEMPS) {
    // Pick the 20 lowest-alignment pages for deeper analysis
    const candidates = [...results]
      .sort((a, b) => a.alignment - b.alignment)
      .slice(0, 20)
      .filter(r => {
        const page = pages.find(p => p.id === r.pageId);
        return page?.photo; // need image URL
      });

    if (candidates.length > 0) {
      console.log(`\nPhase 2: Multi-temperature OCR on ${candidates.length} lowest-alignment pages`);
      console.log(`Running OCR at temperatures ${TEMPERATURES.join(', ')}...`);

      for (const candidate of candidates) {
        const page = pages.find(p => p.id === candidate.pageId);
        if (!page?.photo) continue;

        try {
          // Run OCR at each temperature
          const ocrOutputs = [];
          for (const temp of TEMPERATURES) {
            const text = await ocrAtTemperature(page.photo, temp);
            ocrOutputs.push(text);
            process.stdout.write('.');
          }

          // Embed all OCR outputs
          const embeddings = await embedTexts(ocrOutputs);
          candidate.ocrConsistency = meanPairwiseCosine(embeddings);

          // Small delay between pages
          await new Promise(r => setTimeout(r, 500));
        } catch (err) {
          console.error(`\n  Error on page ${candidate.pageId}: ${err.message}`);
          candidate.ocrConsistency = null;
        }
      }

      console.log('\n\n── OCR Temperature Consistency (lowest-alignment pages) ──');
      const withConsistency = candidates.filter(c => c.ocrConsistency !== null);
      if (withConsistency.length > 0) {
        const consistencies = withConsistency.map(c => c.ocrConsistency);
        console.log(`  Mean consistency: ${mean(consistencies).toFixed(4)}`);
        console.log(`  Min consistency:  ${Math.min(...consistencies).toFixed(4)}`);
      }
    }
  }

  // ── Final report: worst pages ─────────────────────────────────────────
  console.log('\n── 20 Lowest Alignment Pages (potential problems) ──');
  console.log('  Score  | Consist | Lang   | Pg# | Book');
  console.log('  ' + '─'.repeat(70));

  const worst = [...results].sort((a, b) => a.alignment - b.alignment).slice(0, 20);
  for (const r of worst) {
    const consist = r.ocrConsistency !== null ? r.ocrConsistency.toFixed(3) : '  -  ';
    console.log(
      `  ${r.alignment.toFixed(3)}  | ${consist}   | ${r.language.padEnd(6)} | ${String(r.pageNumber).padStart(3)} | ${r.bookTitle}`
    );
  }

  // ── 10 Highest alignment (sanity check) ───────────────────────────────
  console.log('\n── 10 Highest Alignment Pages (sanity check) ──');
  const best = [...results].sort((a, b) => b.alignment - a.alignment).slice(0, 10);
  for (const r of best) {
    console.log(
      `  ${r.alignment.toFixed(3)}  | ${r.language.padEnd(6)} | ${String(r.pageNumber).padStart(3)} | ${r.bookTitle}`
    );
  }

  // ── Save full results to JSON ─────────────────────────────────────────
  const outputPath = new URL('./probe-results.json', import.meta.url).pathname;
  const output = {
    timestamp: new Date().toISOString(),
    config: { sampleSize: SAMPLE_SIZE, bookId: BOOK_ID, language: LANGUAGE_FILTER, skipOcrTemps: SKIP_OCR_TEMPS },
    summary: {
      n: results.length,
      alignment: { mean: mean(alignments), stddev: stddev(alignments), min: Math.min(...alignments), max: Math.max(...alignments), p5: percentile(alignments, 5), p25: percentile(alignments, 25), median: percentile(alignments, 50) },
      byLanguage: Object.fromEntries(
        Object.entries(byLang).map(([lang, scores]) => [lang, { n: scores.length, mean: mean(scores), stddev: stddev(scores) }])
      ),
    },
    pages: results.sort((a, b) => a.alignment - b.alignment),
  };

  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\nFull results saved to ${outputPath}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
