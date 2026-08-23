/**
 * Embed one book's pages into Supabase `page_translations`.
 *
 * This is the pipeline-side writer. `scripts/workers/embed-gemini.mjs` remains
 * the bulk tool — it has streaming, sharding and freshness watermarks that a
 * single book does not need — but both compose their text and rows through
 * `page-embedding-text.mjs`, so they cannot drift.
 *
 * ## Why the pipeline needs its own writer
 *
 * Page embeddings used to be produced ONLY by that cron. On 2026-08-07 it was
 * found commented out behind a `#PAUSED-GEMINI` marker, its log empty and dated
 * June 9. Measured consequence: 2,462 live books with zero page vectors and
 * 4,420 more under 90%, so `search_concept` was blind on roughly 45% of the
 * corpus — silently, because an unembedded book and a book with no match return
 * the same empty list. A reader spent a working day concluding the corpus was
 * thin on passages it actually holds.
 *
 * A step that lives outside the pipeline can be switched off without anything
 * downstream noticing. Inside it, a book that finishes enrichment is searchable
 * by meaning, and the failure mode becomes "enrichment failed" — which is loud.
 */

import { MongoClient } from 'mongodb';
import {
  pageEmbeddingInput,
  buildPageEmbeddingRow,
  embedTexts,
  EMBED_MODEL,
} from './page-embedding-text.mjs';
import { newEmbedUsage, logEmbeddingUsage } from './embedding-usage.mjs';

const EMBED_BATCH_SIZE = 50;   // Gemini batchEmbedContents caps at 100; 50 is the worker's setting
const UPSERT_BATCH_SIZE = 10;  // HNSW index updates are expensive — keep writes small

const UPSERT_SQL = `
  INSERT INTO page_translations (page_id, book_id, page_number, translation, embedding, book_title, book_author, book_language, book_year, updated_at, embedding_model, mongo_updated_at)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  ON CONFLICT (page_id) DO UPDATE SET
    book_id = EXCLUDED.book_id,
    page_number = EXCLUDED.page_number,
    translation = EXCLUDED.translation,
    embedding = EXCLUDED.embedding,
    book_title = EXCLUDED.book_title,
    book_author = EXCLUDED.book_author,
    book_language = EXCLUDED.book_language,
    book_year = EXCLUDED.book_year,
    updated_at = EXCLUDED.updated_at,
    embedding_model = EXCLUDED.embedding_model,
    mongo_updated_at = EXCLUDED.mongo_updated_at`;

/**
 * @param {object} opts
 * @param {import('mongodb').Db} opts.db          open Mongo handle
 * @param {object} opts.pg                        node-postgres client for Supabase
 * @param {object} opts.book                      the books doc (id, title, author, language, year)
 * @param {string} opts.apiKey                    Gemini key — prefer paid Tier 3
 * @param {boolean} [opts.force]                  re-embed pages that already have a vector
 * @returns {Promise<{embedded:number, skipped:number, alreadyPresent:number}>}
 */
export async function embedBookPages({ db, pg, book, apiKey, force = false }) {
  if (!book?.id) throw new Error('embedBookPages: book.id is required');
  if (!apiKey) throw new Error('embedBookPages: apiKey is required');

  const pages = await db.collection('pages')
    .find({ book_id: book.id }, {
      projection: {
        id: 1, book_id: 1, page_number: 1, updated_at: 1,
        'ocr.data': 1, 'ocr.updated_at': 1,
        'translation.data': 1, 'translation.updated_at': 1,
      },
    })
    .sort({ page_number: 1 })
    .toArray();
  if (pages.length === 0) return { embedded: 0, skipped: 0, alreadyPresent: 0 };

  // Skip pages that already have a vector unless forced. Re-embedding is
  // wasteful rather than harmful, but this routine runs on every enrichment and
  // most enrichments re-touch a book that is already mostly embedded.
  let present = new Set();
  if (!force) {
    const { rows } = await pg.query(
      'SELECT page_id FROM page_translations WHERE book_id = $1',
      [book.id],
    );
    present = new Set(rows.map((r) => r.page_id));
  }

  const work = [];
  let skipped = 0;
  for (const page of pages) {
    if (present.has(page.id)) continue;
    const input = pageEmbeddingInput(page);
    if (!input) { skipped++; continue; }   // blank leaf, or nothing transcribed yet
    work.push({ page, ...input });
  }
  if (work.length === 0) {
    return { embedded: 0, skipped, alreadyPresent: present.size };
  }

  let embedded = 0;
  const usage = newEmbedUsage();  // one gemini_usage row per book (#4162)
  for (let i = 0; i < work.length; i += EMBED_BATCH_SIZE) {
    const batch = work.slice(i, i + EMBED_BATCH_SIZE);
    const vectors = await embedTexts(batch.map((w) => w.text), apiKey, { usage });
    const rows = batch.map((w, j) => buildPageEmbeddingRow({
      page: w.page, book, text: w.text, hasTranslation: w.hasTranslation, embedding: vectors[j],
    }));
    for (let k = 0; k < rows.length; k += UPSERT_BATCH_SIZE) {
      for (const row of rows.slice(k, k + UPSERT_BATCH_SIZE)) {
        await pg.query(UPSERT_SQL, [
          row.page_id, row.book_id, row.page_number,
          row.translation, row.embedding,
          row.book_title, row.book_author, row.book_language, row.book_year,
          row.updated_at, row.embedding_model, row.mongo_updated_at,
        ]);
      }
    }
    embedded += rows.length;
  }

  await logEmbeddingUsage(usage, { model: EMBED_MODEL, bookId: book.id, endpoint: 'enrich-worker/phase6-embed', db });

  return { embedded, skipped, alreadyPresent: present.size };
}

export { EMBED_MODEL };

/** Convenience for ad-hoc single-book runs outside the worker. */
export async function embedBookPagesStandalone(bookId, { mongoUri, pgClient, apiKey, force } = {}) {
  const mc = new MongoClient(mongoUri || process.env.MONGODB_URI);
  await mc.connect();
  try {
    const db = mc.db('bookstore');
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) throw new Error(`No such book: ${bookId}`);
    return await embedBookPages({
      db, pg: pgClient, book,
      apiKey: apiKey || process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY,
      force,
    });
  } finally {
    await mc.close();
  }
}
