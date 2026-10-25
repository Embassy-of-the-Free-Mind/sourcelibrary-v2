/**
 * Lazy pages (#7343 step 2a): a book that holds only its IIIF manifest and its
 * page count, with NO `pages` docs, until something needs them.
 *
 * PRIOR ART: scripts/iiif-discovery/lib/manifest-store.mjs (getCanvases /
 * extractCanvasImage — reused here, not copied) parses a manifest but writes
 * `iiif_manifests`, never `pages`; src/app/api/import/iiif/route.ts builds page
 * docs inline at import with random ids, which cannot be made idempotent;
 * scripts/lib/pipeline-hold.mjs keeps a book out of every lane but knows nothing
 * of pages. None of them can create a book's pages exactly once on demand.
 *
 * WHY. Everything before 1850 is ~650K books / ~180M pages, about 7x today's
 * `pages` collection on an Atlas M30. A hidden scan nobody opens should cost one
 * `books` doc, not ~286 page docs plus their index entries.
 *
 * THE MARKER. `books.pages_state` — one field, an object:
 *   { state: 'manifest_only' | 'materializing' | 'materialized',
 *     since, lease_at?, lease_by?, trigger?, materialized_at?, pages_written?,
 *     manifest_pages?, error?, failed_at? }
 * ABSENT means what every book before #7343 is: its pages exist. Only importers
 * that choose manifest-only write it. `pages_count` keeps the TRUE page count the
 * whole time (the reconciler must not zero it: see lazyPageCounters()).
 * The manifest URL is the one the book already carries, `image_source.iiif_manifest`.
 *
 * THE ONE MATERIALIZER. materializePages() is the only writer of a lazy book's
 * pages, and every trigger calls it: the reader's first open, OCR dispatch
 * (releasing the pipeline hold), publishing, an archiver. It is idempotent under
 * concurrency twice over:
 *   1. a CLAIM on the book doc (findOneAndUpdate from manifest_only, or from an
 *      expired lease) means one caller fetches the manifest; the rest wait;
 *   2. page `_id`/`id` are DETERMINISTIC (pageIdFor(book, n)), so even two callers
 *      that both get past the claim (a lease that expired mid-write) insert the
 *      same ids, and the existing unique `_id` / `pages_id_idx` indexes refuse the
 *      second copy. No new index on the 29M-doc collection is needed.
 * A book that already has pages under OTHER ids (a pre-#7343 import someone
 * marked lazy) is never given a second set: it is marked materialized as it is.
 */

import { createHash } from 'node:crypto';
import { ObjectId } from 'mongodb';
import { makePageDoc } from './book-docs.mjs';
import { recountBook, VISIBLE_PAGE_MATCH } from './page-counts.mjs';
import { getCanvases, extractCanvasImage } from '../iiif-discovery/lib/manifest-store.mjs';
import { LAZY_PAGES_FILTER, isLazyPagesBook } from './pages-state.mjs';

export {
  PAGES_STATES, LAZY_STATES, LAZY_PAGES_FILTER, PAGES_MATERIALIZED_FILTER, isLazyPagesBook, initialPagesState,
} from './pages-state.mjs';

/** How long a claim is honoured before another caller may take the book over. */
export const DEFAULT_LEASE_MS = 5 * 60_000;

/**
 * Deterministic page id for page `n` (1-based) of a lazy book. A 24-hex string,
 * so it is a valid ObjectId like every other page `_id` and `id` in the corpus.
 * The book id is part of the hash: two books can never share a page id.
 */
export function pageIdFor(bookId, pageNumber) {
  if (typeof bookId !== 'string' || bookId === '') throw new Error('pageIdFor: bookId must be a non-empty string');
  if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error(`pageIdFor: page number must be a positive integer (got ${pageNumber})`);
  return createHash('sha1').update(`lazy-page:${bookId}:${pageNumber}`).digest('hex').slice(0, 24);
}

/**
 * Build the page docs for a book from its manifest. Pure. Same shape the IIIF
 * importer writes (photo, thumbnail, photo_original; no empty ocr/translation —
 * they cause false completion in job-completion.ts), through makePageDoc().
 * A canvas with no image keeps its place in the sequence with an empty photo,
 * exactly as the importer does, so page N is always canvas N.
 */
export function buildPageDocs(bookId, manifest, { now = new Date() } = {}) {
  const canvases = getCanvases(manifest);
  return canvases.map((canvas, i) => {
    const pageNumber = i + 1;
    const hex = pageIdFor(bookId, pageNumber);
    const { photo, thumbnail } = extractCanvasImage(canvas);
    return makePageDoc({
      _id: new ObjectId(hex),
      id: hex,
      book_id: bookId,
      page_number: pageNumber,
      photo: photo || '',
      thumbnail: thumbnail || '',
      photo_original: photo || '',
      created_at: now,
      updated_at: now,
    });
  });
}

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)';

/** Default manifest fetcher: one GET with a timeout. Callers in bulk lanes pass a rate-limited one. */
async function defaultFetchManifest(url, { timeoutMs = 20_000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json, application/ld+json' },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

let manifestFetcherOverride = null;
/** Tests only: replace the default manifest fetcher for callers that do not pass one (null restores it). */
export function _setManifestFetcherForTest(fn) {
  manifestFetcherOverride = fn;
}

function isDuplicateKeyOnly(err) {
  if (err?.code === 11000) return true;
  const writeErrors = err?.writeErrors ?? err?.result?.writeErrors;
  const list = Array.isArray(writeErrors) ? writeErrors : writeErrors ? [writeErrors] : [];
  return list.length > 0 && list.every((e) => (e?.code ?? e?.err?.code) === 11000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Create a lazy book's page docs, exactly once. THE writer — every trigger calls this.
 *
 * @param {import('mongodb').Db} db
 * @param {string} bookId  the book's string `id` (what `pages.book_id` carries)
 * @param {object} opts
 * @param {string} opts.trigger  who is asking: 'reader' | 'ocr-dispatch' | 'publish' | 'archive' | …
 * @param {(url: string) => Promise<object>} [opts.fetchManifest]  injected for tests and rate-limited lanes
 * @param {number} [opts.leaseMs]  claim lifetime (default 5 min)
 * @param {number} [opts.waitMs]   how long a caller that lost the claim waits for the winner (default 0)
 * @param {Date} [opts.now]
 * @returns {Promise<{ status: 'not_found'|'not_lazy'|'materialized'|'in_progress'|'failed',
 *   book_id: string, pages?: number, error?: string, existing?: number }>}
 *   `materialized` means THIS call (or the winner it waited for) left the book's pages in place;
 *   `not_lazy` means the book never was, or already is, materialized — nothing to do.
 */
export async function materializePages(db, bookId, opts = {}) {
  const { trigger, leaseMs = DEFAULT_LEASE_MS, waitMs = 0 } = opts;
  const fetchManifest = opts.fetchManifest ?? manifestFetcherOverride ?? defaultFetchManifest;
  if (typeof bookId !== 'string' || bookId === '') throw new Error('materializePages: bookId must be a non-empty string');
  if (typeof trigger !== 'string' || trigger === '') throw new Error('materializePages: pass { trigger } naming the caller');

  const books = db.collection('books');
  const pages = db.collection('pages');
  const projection = { id: 1, pages_state: 1, pages_count: 1, image_source: 1 };

  const book = await books.findOne({ id: bookId }, { projection });
  if (!book) return { status: 'not_found', book_id: bookId };
  if (!isLazyPagesBook(book)) return { status: 'not_lazy', book_id: bookId };

  const now = opts.now ?? new Date();
  const token = new ObjectId().toHexString();
  // Driver 6: findOneAndUpdate resolves to the document itself, or null.
  const claimedDoc = await books.findOneAndUpdate(
    {
      id: bookId,
      $or: [
        { 'pages_state.state': 'manifest_only' },
        { 'pages_state.state': 'materializing', 'pages_state.lease_at': { $lt: new Date(now.getTime() - leaseMs) } },
      ],
    },
    { $set: { 'pages_state.state': 'materializing', 'pages_state.lease_at': now, 'pages_state.lease_by': token, 'pages_state.trigger': trigger } },
    { returnDocument: 'after', projection },
  );

  if (!claimedDoc) {
    // Someone else holds the claim (or just finished). Wait for them if asked to.
    const deadline = Date.now() + waitMs;
    for (;;) {
      const cur = await books.findOne({ id: bookId }, { projection: { pages_state: 1 } });
      if (!isLazyPagesBook(cur)) return { status: 'materialized', book_id: bookId };
      if (Date.now() >= deadline) return { status: 'in_progress', book_id: bookId };
      await sleep(Math.min(250, Math.max(10, deadline - Date.now())));
    }
  }

  const release = async (fields) => {
    await books.updateOne(
      { id: bookId, 'pages_state.lease_by': token },
      { $set: { 'pages_state.state': 'manifest_only', ...fields }, $unset: { 'pages_state.lease_at': '', 'pages_state.lease_by': '' } },
    );
  };

  try {
    // Pages that already exist under ids that are not ours: a pre-#7343 import
    // marked lazy by mistake. Never give it a second set.
    const first = await pages.findOne({ book_id: bookId }, { projection: { id: 1, page_number: 1 } });
    const foreign = first && !(Number.isInteger(first.page_number) && first.page_number > 0 && first.id === pageIdFor(bookId, first.page_number));
    if (foreign) {
      const existing = await pages.countDocuments({ book_id: bookId, ...VISIBLE_PAGE_MATCH });
      await finish(db, bookId, token, now, { pages_written: 0, existing });
      return { status: 'materialized', book_id: bookId, pages: existing, existing };
    }

    const manifestUrl = claimedDoc.image_source?.iiif_manifest;
    if (typeof manifestUrl !== 'string' || !/^https?:\/\//.test(manifestUrl)) {
      await release({ 'pages_state.error': 'no image_source.iiif_manifest', 'pages_state.failed_at': now });
      return { status: 'failed', book_id: bookId, error: 'no image_source.iiif_manifest' };
    }

    let manifest;
    try {
      manifest = await fetchManifest(manifestUrl);
    } catch (e) {
      const error = `manifest fetch: ${e?.message ?? e}`;
      await release({ 'pages_state.error': error, 'pages_state.failed_at': new Date() });
      return { status: 'failed', book_id: bookId, error };
    }

    const docs = buildPageDocs(bookId, manifest, { now: new Date() });
    if (docs.length === 0) {
      await release({ 'pages_state.error': 'manifest has no canvases', 'pages_state.failed_at': new Date() });
      return { status: 'failed', book_id: bookId, error: 'manifest has no canvases' };
    }
    for (const d of docs) {
      if (d.book_id !== bookId) throw new Error(`materializePages: page doc for ${d.book_id} built for ${bookId}`);
    }

    try {
      await pages.insertMany(docs, { ordered: false });
    } catch (e) {
      // Another writer already inserted some or all of these exact ids: that is the
      // idempotence working, not a failure. Anything else is.
      if (!isDuplicateKeyOnly(e)) throw e;
    }

    await finish(db, bookId, token, now, { pages_written: docs.length, manifest_pages: docs.length });
    return { status: 'materialized', book_id: bookId, pages: docs.length };
  } catch (e) {
    await release({ 'pages_state.error': String(e?.message ?? e), 'pages_state.failed_at': new Date() }).catch(() => {});
    throw e;
  }
}

async function finish(db, bookId, token, now, detail) {
  const done = new Date();
  // Conditional on still being a lazy state, not on our token: if our lease
  // expired and another caller finished first, the pages are the same ids and
  // the book is already materialized — this is then a no-op.
  await db.collection('books').updateOne(
    { id: bookId, ...LAZY_PAGES_FILTER },
    {
      $set: {
        'pages_state.state': 'materialized',
        'pages_state.materialized_at': done,
        ...Object.fromEntries(Object.entries(detail).map(([k, v]) => [`pages_state.${k}`, v])),
      },
      $unset: { 'pages_state.lease_at': '', 'pages_state.lease_by': '', 'pages_state.error': '', 'pages_state.failed_at': '' },
    },
  );
  // The counters now come from the pages, through THE counter writer.
  await recountBook(db, bookId, { reason: 'materialize-pages', now: done });
}

/**
 * For a caller that cannot proceed without pages (OCR dispatch, archivers,
 * publishing): materialize if needed, and THROW if the pages are still not there.
 * Returns the materializePages() result on success.
 */
export async function ensurePages(db, bookId, opts) {
  const res = await materializePages(db, bookId, { waitMs: 60_000, ...opts });
  if (res.status === 'materialized' || res.status === 'not_lazy') return res;
  throw new Error(`ensurePages(${bookId}): ${res.status}${res.error ? ` — ${res.error}` : ''}`);
}
