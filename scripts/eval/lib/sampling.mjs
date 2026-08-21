/**
 * QA-Eval Page Sampling
 *
 * Select representative pages from a corpus for evaluation.
 * Stratified by position (beginning/middle/end) to avoid bias.
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Env loading (from ft-eval.mjs pattern) ─────────────────────────

export function loadEnv() {
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
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
    } catch { /* try next */ }
  }
}

// ── DB connection ──────────────────────────────────────────────────

let cachedClient = null;

export async function connect() {
  if (cachedClient) return cachedClient;
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set. Run: set -a; source .env.production.local; set +a');
    process.exit(1);
  }
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = { client, db: client.db(process.env.MONGODB_DB || 'bookstore') };
  return cachedClient;
}

export async function disconnect() {
  if (cachedClient) {
    await cachedClient.client.close();
    cachedClient = null;
  }
}

// ── Corpus registry ────────────────────────────────────────────────

export function loadCorpusRegistry() {
  const registryPath = new URL('../corpus-registry.json', import.meta.url).pathname;
  try {
    return JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return {};
  }
}

export function getCorpus(name) {
  const registry = loadCorpusRegistry();
  const corpus = registry[name];
  if (!corpus) {
    const available = Object.keys(registry).join(', ');
    throw new Error(`Unknown corpus "${name}". Available: ${available}`);
  }
  return corpus;
}

// ── Sample pages ───────────────────────────────────────────────────

/**
 * Sample N pages from a corpus with stratified selection.
 * Returns pages with image URLs suitable for OCR evaluation.
 *
 * @param {string} corpusName - Key in corpus-registry.json
 * @param {number} n - Number of pages to sample
 * @param {object} opts - Options
 * @param {string} opts.bookId - Specific book ID (overrides corpus filter)
 * @returns {Array<{bookId, bookTitle, pageNumber, pagesTotal, imageUrl, ocrText, translationText, script, language}>}
 */
export async function samplePages(corpusName, n = 10, opts = {}) {
  const corpus = getCorpus(corpusName);
  const { db } = await connect();
  const books = db.collection('books');
  const pages = db.collection('pages');

  // Build book filter — require pages with OCR data, not necessarily 'live' status
  let bookFilter;
  if (opts.bookId) {
    bookFilter = { id: opts.bookId };
  } else {
    // By default require books that already have OCR (auditing existing output).
    // For model-selection BEFORE OCR exists, pass opts.requireOcr === false.
    bookFilter = { ...(opts.requireOcr === false ? {} : { pages_ocr: { $gte: 10 } }), ...corpus.filter };
  }

  // Get candidate books
  const candidateBooks = await books
    .find(bookFilter, {
      projection: { id: 1, title: 1, language: 1, pages_count: 1 },
      limit: 100,
      maxTimeMS: 10000,
    })
    .toArray();

  if (candidateBooks.length === 0) {
    throw new Error(`No books found for corpus "${corpusName}" with filter: ${JSON.stringify(bookFilter)}`);
  }

  // Distribute sample across books (round-robin)
  const perBook = Math.max(1, Math.ceil(n / candidateBooks.length));
  const sampled = [];

  for (const book of candidateBooks) {
    if (sampled.length >= n) break;

    const totalPages = book.pages_count || 10;
    const take = Math.min(perBook, n - sampled.length);

    // Stratified positions: beginning, middle, end
    const positions = [];
    if (take >= 3) {
      // Spread across book — skip first 2 pages (often title/blank)
      for (let i = 0; i < take; i++) {
        const pos = Math.floor(2 + (i / (take - 1)) * Math.max(0, totalPages - 4));
        positions.push(Math.min(pos, totalPages - 1));
      }
    } else {
      // Few pages — pick from middle
      const mid = Math.floor(totalPages / 2);
      for (let i = 0; i < take; i++) {
        positions.push(Math.min(mid + i, totalPages - 1));
      }
    }

    // Fetch those pages
    const bookPages = await pages
      .find(
        { book_id: book.id, page_number: { $in: positions } },
        {
          projection: {
            _id: 1, book_id: 1, page_number: 1,
            photo: 1, archived_photo: 1, compressed_photo: 1,
            'ocr.data': 1, 'ocr.language': 1,
            'translation.data': 1,
          },
          maxTimeMS: 10000,
        },
      )
      .toArray();

    for (const page of bookPages) {
      if (sampled.length >= n) break;
      const imageUrl = page.archived_photo || page.photo || page.compressed_photo;
      if (!imageUrl) continue;

      sampled.push({
        bookId: book.id,
        bookTitle: book.title,
        pageNumber: page.page_number,
        pagesTotal: totalPages,
        imageUrl,
        ocrText: page.ocr?.data || null,
        ocrLanguage: page.ocr?.language || null,
        translationText: page.translation?.data || null,
        script: corpus.script || 'default',
        language: book.language || corpus.script || 'unknown',
      });
    }
  }

  return sampled;
}

/**
 * Get a single page by book ID and page number.
 */
export async function getPage(bookId, pageNumber) {
  const { db } = await connect();
  return db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    {
      projection: {
        _id: 1, book_id: 1, page_number: 1,
        photo: 1, archived_photo: 1, compressed_photo: 1,
        cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1,
        'ocr.data': 1, 'ocr.language': 1,
        'translation.data': 1,
      },
      maxTimeMS: 10000,
    },
  );
}
