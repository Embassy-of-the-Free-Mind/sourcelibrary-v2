/**
 * Archive a manifest-only book (#7343 lazy pages) straight from its IIIF manifest, WITHOUT
 * creating its page docs (#5448 step 2). Canvas n goes to `pages/<bookId>/<NNNN>.jpg`, and the
 * progress goes to the book's ledger (scripts/lib/manifest-ledger.mjs). When the book is later
 * materialized, materializePages() points page n at that object.
 *
 * PRIOR ART: scripts/catalog-coverage/archive-acquired.ts `archiveIiif` (the per-page fetch, the
 * placeholder refusal, the breaker and miss rules — mirrored here, but it reads and writes PAGE
 * docs, which is exactly what a lazy book does not have; materializing first would create ~286 page
 * docs per hidden scan, the cost #7343 exists to avoid); scripts/lib/lazy-pages.mjs `ensurePages`
 * (materializes, the opposite of the point); iiif-utils.mjs `fetchPageMaster` / `dimensionFields`
 * (reused: the tile-stitch route and the native-dimension record). This file is the only writer of
 * the ledger's `done` bits.
 *
 * WHY. ~650K pre-1850 books are being imported manifest-only. Every archiver selected work through
 * page docs, so none of them could ever be archived (the 2026-10-25 plan on #5448).
 *
 * ONE WRITER PER BOOK. The ledger is written whole (`$set`) from this process's view. A book is on
 * one host, a host is one lane, a lane holds a flock: two writers on one book is a hand-run --book
 * racing a lane, and the worst it does is lose a bit, which re-fetches that page later. It never
 * claims a page that is not on R2: a bit is set only after storagePut answered.
 *
 * MATERIALIZED MEANWHILE. Each flush is conditional on the book still being lazy. If a reader opened
 * the book while we were archiving it, the flush matches nothing, and the pages archived since the
 * last flush are written to the page docs directly (by book_id + page_number, only where
 * archived_photo is absent). materializePages() re-reads the ledger AFTER its own finish(), so a bit
 * flushed before the flip is applied there. Between the two, no archived page is left unpointed.
 */

import sharp from 'sharp';
import { getCanvases, extractCanvasImage } from '../iiif-discovery/lib/manifest-store.mjs';
import { rateLimitedFetch, fetchPageMaster } from './iiif-utils.mjs';
import { classifyFetchError } from './host-breaker.mjs';
import { assertNotQuotaPlaceholder } from './archive-failure-class.mjs';
import { isMissFor, isBookScopedFailure, MISS_LIMIT, bookVerdict, createBookMissGuard } from './archive-miss.mjs';
import { LAZY_STATES, isLazyPagesBook } from './pages-state.mjs';
import {
  LEDGER_FIELD, newLedger, openLedger, manifestFingerprint, ledgerKey, ledgerPageFields,
} from './manifest-ledger.mjs';

/** Flush the ledger after this many newly stored pages (and always at the end). */
export const FLUSH_EVERY = 10;

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return 'unknown'; } };

/** The canvases' image URLs, in order, exactly as buildPageDocs() derives each page's `photo`. */
export function manifestPhotos(manifest) {
  return getCanvases(manifest).map((c) => extractCanvasImage(c).photo || '');
}

async function defaultFetchManifest(url) {
  const buf = await rateLimitedFetch(url, { timeout: 30_000, retries: 2 });
  return JSON.parse(buf.toString('utf8'));
}

/**
 * @param {import('mongodb').Db} db
 * @param {string} bookId
 * @param {object} deps
 * @param {(key: string, body: Buffer, opts: object) => Promise<{url: string}>} deps.put  storagePut
 * @param {(url: string) => Promise<object>} [deps.fetchManifest]
 * @param {(url: string) => Promise<Buffer>} [deps.download]  the image GET (default rateLimitedFetch)
 * @param {object} [deps.breaker]  a createHostBreaker() instance shared with the run
 * @param {object} [deps.missGuard]  a createBookMissGuard() instance shared with the run
 * @param {number} [deps.pageConcurrency=2]
 * @param {boolean} [deps.retryMisses=false]  ask again for pages that missed MISS_LIMIT times
 * @param {Function} [deps.openZip]  ia-zip-ledger.mjs openIaZip: archive an IA book from its item zip
 *   when the canvas→member mapping is proven; null = page by page only
 * @param {(url: string) => string} [deps.fetchUrl]  where to GET a canvas image from (e.g. gallicaOpenApiUrl);
 *   the ledger's fingerprint and miss record stay keyed to the manifest's own URL
 * @param {() => boolean} [deps.shouldStop]  checked between pages
 * @param {(event: object) => void} [deps.onPage]  per-page outcome, for the run's counters
 * @param {(msg: string) => void} [deps.log]
 * @returns {Promise<object>} { status, book_id, host?, requested, archived, missed, failed, local, bytes, verdict?, error? }
 */
export async function archiveFromManifest(db, bookId, deps) {
  const {
    put, fetchManifest = defaultFetchManifest, download = (u) => rateLimitedFetch(u),
    breaker = null, missGuard = createBookMissGuard(), pageConcurrency = 2, retryMisses = false, fetchUrl = (u) => u,
    shouldStop = () => false, onPage = () => {}, log = () => {}, openZip = null,
  } = deps ?? {};
  if (typeof put !== 'function') throw new Error('archiveFromManifest: deps.put (storagePut) is required');
  const books = db.collection('books');
  const res = { status: 'partial', book_id: bookId, requested: 0, archived: 0, missed: 0, failed: 0, local: 0, bytes: 0, pausedSkips: 0 };

  const book = await books.findOne({ id: bookId }, { projection: { id: 1, pages_state: 1, pages_count: 1, image_source: 1, [LEDGER_FIELD]: 1 } });
  if (!book) return { ...res, status: 'not_found' };
  if (!isLazyPagesBook(book)) return { ...res, status: 'not_lazy' };
  const manifestUrl = book.image_source?.iiif_manifest;
  if (typeof manifestUrl !== 'string' || !/^https?:\/\//.test(manifestUrl)) return { ...res, status: 'no_manifest' };

  let manifest;
  try {
    manifest = await fetchManifest(manifestUrl);
  } catch (e) {
    breaker?.failure(hostOf(manifestUrl), classifyFetchError(e));
    return { ...res, status: 'manifest_failed', error: String(e?.message ?? e).slice(0, 200) };
  }
  const photos = manifestPhotos(manifest);
  if (photos.length === 0) return { ...res, status: 'no_canvases' };
  const host = hostOf(photos.find(Boolean) || manifestUrl);
  res.host = host;

  let stored = book.archive_metadata?.manifest_ledger ?? null;
  if (stored && (stored.fp !== manifestFingerprint(photos) || stored.canvases !== photos.length)) {
    // The manifest changed since the ledger was started: its bits describe other canvases. Start
    // again; the objects it wrote are overwritten page by page (same keys, same book).
    log(`book ${bookId}: manifest changed since the ledger was started (${stored.canvases} → ${photos.length} canvases) — ledger restarted`);
    stored = null;
  }
  stored ??= newLedger({ photos, host });
  if (!stored.host) stored = { ...stored, host };
  const ledger = openLedger(stored);

  const pending = [];
  for (let p = 1; p <= photos.length; p++) {
    if (!photos[p - 1] || ledger.isDone(p)) continue;
    if (!retryMisses && ledger.missCount(p) >= MISS_LIMIT) continue;
    pending.push(p);
  }

  let base = stored.base ?? null;
  let sinceFlush = [];
  let materializedMeanwhile = false;
  /** Write the ledger; if the book is no longer lazy, point the page docs instead. */
  const flush = async (extra = {}) => {
    const now = new Date();
    const doc = ledger.encode({ base, updated_at: now, ...extra });
    const r = await books.updateOne({ id: bookId, 'pages_state.state': { $in: [...LAZY_STATES] } }, { $set: { [LEDGER_FIELD]: doc } });
    if (r.matchedCount === 0 && !materializedMeanwhile) {
      materializedMeanwhile = true;
      log(`book ${bookId}: materialized while archiving — pointing its page docs directly`);
    }
    if (materializedMeanwhile) {
      // Keep the record, and point the pages archived since the last flush.
      await books.updateOne({ id: bookId }, { $set: { [LEDGER_FIELD]: doc } });
      const pages = db.collection('pages');
      for (const p of sinceFlush) {
        const f = ledgerPageFields(doc, ledger, bookId, p);
        if (f) await pages.updateOne({ book_id: bookId, page_number: p, archived_photo: { $exists: false } }, { $set: f });
      }
    }
    sinceFlush = [];
  };

  /** Put one page's JPEG at its book-scoped key and mark it in the ledger. */
  const storePage = async (p, jpg, native, h) => {
    const key = ledgerKey(bookId, p);
    const blob = await put(key, jpg, { contentType: 'image/jpeg', access: 'public' });
    // The URL base comes from the store's own answer, never assumed: the page docs will carry it.
    const b = typeof blob?.url === 'string' && blob.url.endsWith(`/${key}`) ? blob.url.slice(0, -(key.length + 1)) : null;
    if (!b) throw new Error(`storagePut answered ${JSON.stringify(blob?.url)} for ${key}`);
    if (base && base !== b) throw new Error(`storage base changed mid-book: ${base} → ${b}`);
    base = b;
    let dims = {};
    try { dims = await sharp(jpg).metadata(); } catch { /* dimensions are a nice-to-have */ }
    ledger.markDone(p, { width: dims.width, height: dims.height, bytes: jpg.length, nativeWidth: native?.nativeWidth, nativeHeight: native?.nativeHeight });
    res.archived++;
    res.bytes += jpg.length;
    sinceFlush.push(p);
    onPage({ outcome: 'ok', host: h, bytes: jpg.length });
    if (sinceFlush.length >= FLUSH_EVERY) await flush();
  };

  // ── IA item zip (one request per book; the JP2 is the master). Only on a PROVEN mapping
  // (ia-zip-ledger.mjs); a refusal, or a page the zip cannot give, falls through to per-page IIIF.
  if (openZip && pending.length > 0 && /(^|\.)archive\.org$/.test(host)) {
    const z = await openZip({ manifestUrl, photos, log, onRefuse: (why) => { res.zip = { refused: why }; log(`book ${bookId}: IA zip refused (${why}) — archiving page by page`); } });
    if (z) {
      res.zip = { route: z.route, bytes: z.bytes, pages: 0 };
      res.requested++;
      try {
        // Decoding is CPU, not requests: pageConcurrency decoders, each opj_decompress single-threaded.
        const left = [];
        let zi = 0;
        const zipWorker = async () => {
          for (;;) {
            const p = pending[zi++];
            if (p === undefined) return;
            const f = shouldStop() ? null : z.fileFor(p);
            if (!f) { left.push(p); continue; }
            let decoded = null;
            try { decoded = await z.decode(f); } catch (e) {
              res.local++; onPage({ outcome: 'local', host, error: `jp2 decode: ${String(e?.message ?? e).slice(0, 120)}` }); left.push(p); continue;
            }
            try {
              // The JP2 IS the master: its size is native.
              await storePage(p, decoded.buffer, { nativeWidth: decoded.width, nativeHeight: decoded.height }, host);
              res.zip.pages++;
            } catch (e) {
              res.local++; onPage({ outcome: 'local', host, error: String(e?.message ?? e).slice(0, 140) }); left.push(p);
            }
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(pageConcurrency, pending.length)) }, () => zipWorker()));
        pending.splice(0, pending.length, ...left.sort((a, b) => a - b));
      } finally {
        await z.close();
      }
    }
  }

  let next = 0;
  let abandoned = false;
  const worker = async () => {
    while (!abandoned && !shouldStop()) {
      const p = pending[next++];
      if (p === undefined) return;
      const url = fetchUrl(photos[p - 1]);
      const h = hostOf(url);
      if (breaker && !breaker.allow(h)) { breaker.skipped(h); res.pausedSkips++; onPage({ outcome: 'skipped', host: h }); continue; }
      res.requested++;
      let fetched = false;
      try {
        const master = await fetchPageMaster(url, { download });
        // BSB/MDZ answer an over-quota request with a 1×1 JPEG at 200 OK (#7371): a throttle, not a page.
        await assertNotQuotaPlaceholder(master.buffer, (b) => sharp(b).metadata());
        fetched = true;
        breaker?.success(h);
        missGuard.ok(bookId);
        // Source fidelity, same encode as archive-acquired.ts (#3897): no resize.
        const jpg = await sharp(master.buffer).rotate().jpeg({ quality: 90, mozjpeg: true }).toBuffer();
        await storePage(p, jpg, { nativeWidth: master.nativeWidth, nativeHeight: master.nativeHeight }, h);
      } catch (e) {
        const code = classifyFetchError(e);
        if (!fetched && isMissFor(url, code)) {
          ledger.markMiss(p);
          res.missed++;
          breaker?.pageMiss(h, code);
          missGuard.miss(bookId);
          onPage({ outcome: 'miss', host: h, code });
          if (missGuard.abandoned(bookId)) {
            abandoned = true;
            log(`book ${bookId}: ${missGuard.stateOf(bookId)?.miss} page misses [${code}] and nothing served — leaving it for a later run`);
            if ((breaker?.stateOf(h)?.ok ?? 0) === 0) breaker?.failure(h, `dead-book-${code}`);
          }
          continue;
        }
        if (!fetched && isBookScopedFailure(code) && missGuard.fresh(bookId)) {
          // A 400/500 from a book that has served nothing yet is about the book (archive-miss.mjs).
          missGuard.fail(bookId);
          res.failed++;
          breaker?.pageMiss(h, code);
          onPage({ outcome: 'failed', host: h, code });
          if (!abandoned && missGuard.abandoned(bookId)) {
            abandoned = true;
            log(`book ${bookId}: ${missGuard.stateOf(bookId)?.fail} page failures [${code}] and nothing served — leaving it for a later run`);
            if ((breaker?.stateOf(h)?.ok ?? 0) === 0) breaker?.failure(h, `dead-book-${code}`);
          }
          continue;
        }
        if (fetched) {
          // Ours (sharp, R2, Mongo): never charged to the institution.
          res.local++;
          onPage({ outcome: 'local', host: h, error: String(e?.message ?? e).slice(0, 140) });
        } else {
          res.failed++;
          breaker?.failure(h, code);
          onPage({ outcome: 'failed', host: h, code });
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(pageConcurrency, pending.length)) }, () => worker()));

  // Completion: every canvas with an image is stored, or has missed MISS_LIMIT times; a canvas with
  // no image counts as a gap (it can never be fetched).
  let gaps = 0;
  for (let p = 1; p <= photos.length; p++) {
    if (ledger.isDone(p)) continue;
    if (!photos[p - 1] || ledger.missCount(p) >= MISS_LIMIT) gaps++;
  }
  const verdict = bookVerdict({ pagesCount: photos.length, archived: ledger.countDone(), misses: gaps });
  const complete = verdict !== 'partial' && ledger.countDone() + gaps === photos.length;
  // Nothing left that a run could fetch, yet too many gaps to call it complete: say so, so the lane
  // stops drawing it (the 108,133-run Heidelberg spin, #5448). `--book` (retryMisses) asks again.
  const exhausted = !complete && ledger.countDone() + gaps === photos.length;
  await flush({ complete, exhausted });
  if (complete) {
    const $set = verdict === 'complete'
      ? { archive_status: 'archive_complete', updated_at: new Date() }
      : { archive_status: 'archive_complete_with_gaps', 'archive_metadata.gaps': gaps, updated_at: new Date() };
    await books.updateOne({ id: bookId }, { $set });
  }
  return { ...res, status: materializedMeanwhile ? 'materialized_meanwhile' : complete ? 'complete' : exhausted ? 'exhausted' : 'partial', verdict: complete ? verdict : 'partial', done: ledger.countDone(), canvases: photos.length, gaps };
}
