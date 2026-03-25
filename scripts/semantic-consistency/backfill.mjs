#!/usr/bin/env node
/**
 * Backfill semantic alignment scores for all translated books.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/semantic-consistency/backfill.mjs
 *
 *   Options:
 *     --limit N       Max books to process (default: 50)
 *     --min-pages N   Skip books with fewer translated pages (default: 10)
 *     --force         Re-score books that already have alignment scores
 */

import { MongoClient } from 'mongodb';
import { GoogleGenerativeAI } from '@google/generative-ai';

const EMBEDDING_MODEL = 'gemini-embedding-001';
const BATCH_SIZE = 5;
const FLAG_THRESHOLD = 0.82;

// ── CLI args ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name) {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return args[idx + 1];
}
const hasFlag = (name) => args.includes(`--${name}`);

const LIMIT = parseInt(getArg('limit') || '50', 10);
const MIN_PAGES = parseInt(getArg('min-pages') || '10', 10);
const FORCE = hasFlag('force');

// ── Gemini setup ────────────────────────────────────────────────────────────
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
const genai = new GoogleGenerativeAI(apiKey);

// ── Math ────────────────────────────────────────────────────────────────────
function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ── Embedding ───────────────────────────────────────────────────────────────
async function embedTexts(texts) {
  const model = genai.getGenerativeModel({ model: EMBEDDING_MODEL });
  const results = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
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

    if (i + BATCH_SIZE < texts.length) await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db('bookstore');
  console.log('Connected to MongoDB');

  // Find books that need scoring
  const query = {
    pages_translated: { $gte: MIN_PAGES },
    ...(FORCE ? {} : { 'semantic_alignment': { $exists: false } }),
  };

  const books = await db.collection('books')
    .find(query)
    .project({ id: 1, title: 1, display_title: 1, pages_translated: 1, language: 1 })
    .sort({ pages_translated: -1 })
    .limit(LIMIT)
    .toArray();

  console.log(`Found ${books.length} books to score (limit: ${LIMIT}, min_pages: ${MIN_PAGES}, force: ${FORCE})\n`);

  let totalScored = 0;
  let totalFlagged = 0;

  for (let b = 0; b < books.length; b++) {
    const book = books[b];
    const title = (book.display_title || book.title || 'Unknown').slice(0, 50);
    process.stdout.write(`[${b + 1}/${books.length}] ${title}... `);

    // Fetch translated pages
    const pages = await db.collection('pages').find(
      { book_id: book.id, 'ocr.data': { $exists: true, $ne: '' }, 'translation.data': { $exists: true, $ne: '' } },
      { projection: { id: 1, 'ocr.data': 1, 'translation.data': 1 } }
    ).toArray();

    if (pages.length === 0) { console.log('no pages'); continue; }

    // Embed
    const ocrEmbeddings = await embedTexts(pages.map(p => p.ocr.data));
    const transEmbeddings = await embedTexts(pages.map(p => p.translation.data));

    // Score and write
    const scores = [];
    const bulkOps = [];
    let flagged = 0;

    for (let i = 0; i < pages.length; i++) {
      if (!ocrEmbeddings[i] || !transEmbeddings[i]) continue;
      const score = cosineSimilarity(ocrEmbeddings[i], transEmbeddings[i]);
      scores.push(score);
      if (score < FLAG_THRESHOLD) flagged++;

      bulkOps.push({
        updateOne: {
          filter: { id: pages[i].id },
          update: { $set: { semantic_alignment: { score, embedding_model: EMBEDDING_MODEL, scored_at: new Date() } } },
        },
      });
    }

    if (bulkOps.length > 0) await db.collection('pages').bulkWrite(bulkOps);

    // Book-level summary
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;

    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { semantic_alignment: {
        mean_alignment: mean,
        min_alignment: Math.min(...scores),
        max_alignment: Math.max(...scores),
        stddev: Math.sqrt(variance),
        pages_scored: scores.length,
        pages_flagged: flagged,
        scored_at: new Date(),
      } } }
    );

    totalScored += scores.length;
    totalFlagged += flagged;
    console.log(`${scores.length} pages, mean=${mean.toFixed(3)}, flagged=${flagged}`);

    // Small delay between books
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\nDone. ${totalScored} pages scored, ${totalFlagged} flagged across ${books.length} books.`);
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
