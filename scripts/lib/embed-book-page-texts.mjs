/**
 * Embed one book's pages in ONE language into Supabase `page_texts` (#4095).
 *
 * The language-keyed twin of `embed-book-pages.mjs`. Both compose their text
 * and their row through `page-embedding-text.mjs`, which is the whole point:
 * the English store has two writers (the enrich-worker inline and the bulk
 * cron) and this store has two as well (the bulk `embed-page-texts.mjs` worker
 * and, inline, `es-translate-worker.mjs`). Four writers, one composer.
 *
 * ## Staleness is checked by default, not on a flag
 *
 * Spanish pages are not written once. `scripts/audit/es-edition-quality.mjs`
 * flags bad pages and the worker rewrites them in `--strict --pages=@report`
 * mode, so a page's text can change after it was embedded. A vector left
 * pointing at the pre-repair text does not merely rank badly — the row also
 * carries the SNIPPET that gets shown and quoted, so a stale row serves text
 * that is no longer in the book. Every run therefore compares the Mongo
 * translation's `updated_at` against the stored `mongo_updated_at` watermark
 * and re-embeds what drifted. `force` re-embeds everything regardless.
 */

import { MongoClient } from 'mongodb';
import {
  pageTextForLang,
  buildPageTextRow,
  pageTextUpsertValues,
  PAGE_TEXT_UPSERT_SQL,
  embedTexts,
  EMBED_MODEL,
} from './page-embedding-text.mjs';
import { isNativeEditionLanguage } from './native-edition-language.mjs';
import { newEmbedUsage, logEmbeddingUsage } from './embedding-usage.mjs';

const EMBED_BATCH_SIZE = 50;   // Gemini batchEmbedContents caps at 100; 50 matches the English worker
const UPSERT_BATCH_SIZE = 10;  // HNSW index updates are expensive — keep writes small

/** Mongo projection for one language, plus the legacy `translation_es` field. */
export function pageProjectionForLang(lang) {
  return {
    id: 1, book_id: 1, page_number: 1, updated_at: 1,
    [`translations.${lang}.data`]: 1,
    [`translations.${lang}.updated_at`]: 1,
    // A native edition's text IS the OCR (#4146) — projected always, because the
    // watermark in buildPageTextRow reads ocr.updated_at for those rows.
    'ocr.data': 1, 'ocr.updated_at': 1,
    ...(lang === 'es' ? { 'translation_es.data': 1, 'translation_es.updated_at': 1 } : {}),
  };
}

/**
 * Mongo filter selecting pages that HAVE text in `lang`.
 *
 * `nativeEdition` widens it to OCR — for a book WRITTEN in the language there is
 * no translation to select on, so the counter-shaped filter matched nothing and
 * the book was skipped entirely (#4146).
 */
export function pageFilterForLang(lang, { nativeEdition = false } = {}) {
  const has = (p) => ({ [`${p}.data`]: { $type: 'string', $ne: '' } });
  const clauses = lang === 'es'
    ? [has('translations.es'), has('translation_es')]
    : [has(`translations.${lang}`)];
  if (nativeEdition) clauses.push(has('ocr'));
  return clauses.length === 1 ? clauses[0] : { $or: clauses };
}

/**
 * @param {object} opts
 * @param {import('mongodb').Db} opts.db     open Mongo handle
 * @param {object} opts.pg                   node-postgres client for Supabase
 * @param {object} opts.book                 books doc (id, title, author, language, year)
 * @param {string} opts.lang                 ISO code, e.g. 'es'
 * @param {string} opts.apiKey               Gemini key — prefer paid Tier 3
 * @param {boolean} [opts.force]             re-embed rows that already exist and are fresh
 * @param {string[]} [opts.pageIds]          restrict to these page ids (repair mode)
 * @returns {Promise<{embedded:number, restaled:number, missing:number, alreadyPresent:number}>}
 */
export async function embedBookPageTexts({ db, pg, book, lang, apiKey, force = false, pageIds }) {
  if (!book?.id) throw new Error('embedBookPageTexts: book.id is required');
  if (!lang) throw new Error('embedBookPageTexts: lang is required');
  if (!apiKey) throw new Error('embedBookPageTexts: apiKey is required');

  // Was this book WRITTEN in `lang`? Then its OCR is already that language and
  // is the only text it will ever have in it (#4146). Derived from the BOOK, once
  // — never guessed per page, and deliberately false for bilingual editions,
  // where only part of the page is the language.
  const nativeEdition = isNativeEditionLanguage(book.language, lang);

  const filter = { book_id: book.id, ...pageFilterForLang(lang, { nativeEdition }) };
  if (pageIds?.length) filter.id = { $in: pageIds };

  const pages = await db.collection('pages')
    .find(filter, { projection: pageProjectionForLang(lang) })
    .sort({ page_number: 1 })
    .toArray();
  if (pages.length === 0) return { embedded: 0, restaled: 0, missing: 0, alreadyPresent: 0 };

  const present = new Map();
  if (!force) {
    const { rows } = await pg.query(
      'SELECT page_id, mongo_updated_at FROM page_texts WHERE book_id = $1 AND lang = $2',
      [book.id, lang],
    );
    for (const r of rows) present.set(r.page_id, r.mongo_updated_at);
  }

  const work = [];
  let missing = 0, alreadyPresent = 0, restaled = 0;
  for (const page of pages) {
    const input = pageTextForLang(page, lang, { nativeEdition });
    if (!input) { missing++; continue; }
    if (present.has(page.id)) {
      const stored = present.get(page.id);
      const source = page.translations?.[lang]?.updated_at
        ?? (lang === 'es' ? page.translation_es?.updated_at : null)
        // A native edition's text came from OCR, so a re-OCR is what makes its
        // row stale; keying on a translation that will never exist would freeze
        // the vector against text the book no longer has.
        ?? (nativeEdition ? page.ocr?.updated_at : null)
        ?? page.updated_at;
      // A row with NO watermark predates the watermark column; treat it as
      // stale rather than trusting it — `null` is "unknown", not "current".
      const isStale = !stored || (source && new Date(source) > new Date(stored));
      if (!isStale) { alreadyPresent++; continue; }
      restaled++;
    }
    work.push({ page, ...input });
  }
  if (work.length === 0) return { embedded: 0, restaled: 0, missing, alreadyPresent };

  let embedded = 0;
  // Spend is recorded once per book (#4162): one row per 50-text batch would be
  // tens of thousands of rows on a large run, which the spend guard reads as
  // over-budget and fails closed on.
  const usage = newEmbedUsage();
  for (let i = 0; i < work.length; i += EMBED_BATCH_SIZE) {
    const batch = work.slice(i, i + EMBED_BATCH_SIZE);
    // Embed the capped text, STORE the full text — see pageTextForLang.
    const vectors = await embedTexts(batch.map((w) => w.embedText), apiKey, { usage });
    const rows = batch.map((w, j) => buildPageTextRow({
      page: w.page, book, lang, text: w.text, embedding: vectors[j],
    }));
    for (let k = 0; k < rows.length; k += UPSERT_BATCH_SIZE) {
      for (const row of rows.slice(k, k + UPSERT_BATCH_SIZE)) {
        await pg.query(PAGE_TEXT_UPSERT_SQL, pageTextUpsertValues(row));
      }
    }
    embedded += rows.length;
  }

  // After the loop, so a book that throws part-way still records what it spent
  // before throwing — the caller catches per book and continues.
  await logEmbeddingUsage(usage, { model: EMBED_MODEL, bookId: book.id, endpoint: `worker/embed-page-texts:${lang}`, db });

  return { embedded, restaled, missing, alreadyPresent };
}

export { EMBED_MODEL };

/** Convenience for ad-hoc single-book runs outside the worker. */
export async function embedBookPageTextsStandalone(bookId, { lang, mongoUri, pgClient, apiKey, force, pageIds } = {}) {
  const mc = new MongoClient(mongoUri || process.env.MONGODB_URI);
  await mc.connect();
  try {
    const db = mc.db('bookstore');
    const book = await db.collection('books').findOne({ id: bookId });
    if (!book) throw new Error(`No such book: ${bookId}`);
    return await embedBookPageTexts({
      db, pg: pgClient, book, lang, force, pageIds,
      apiKey: apiKey || process.env.GEMINI_API_KEY_TIER3 || process.env.GEMINI_API_KEY,
    });
  } finally {
    await mc.close();
  }
}
