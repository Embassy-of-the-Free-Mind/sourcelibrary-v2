#!/usr/bin/env node
// Hetzner standalone archive-ocr worker
// Replaces the Vercel cron /api/cron/archive-ocr
//
// Finds pages needing archiving, downloads the source image,
// uploads to R2, and updates MongoDB.
//
// Priority: first translations > non-English > English (via book lookup)
// Per-domain rate limiting based on robots.txt and library policies.
// Each domain processes in parallel at its own rate.
//
// Run: set -a; source .env.production.local; set +a; node scripts/workers/archive-ocr.mjs

import { MongoClient } from 'mongodb';
import { fetchWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';
import { upgradeToFullRes } from '../lib/iiif-utils.mjs';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';

const MAX_PAGES = 10_000;
// MAX_PAGES_PER_DOMAIN caps how many pages from a single source make it into one
// run. Was 5000; bumped to 8000 because MDZ (Munich, 337K-page backlog at 2 req/s)
// was hitting the cap before saturating its token bucket — 2 req/s × ~70 min run
// = ~8400 requests, so 8000 lets it pull a full run's worth without crowding
// other domains (each capped at its own token bucket rate anyway).
const MAX_PAGES_PER_DOMAIN = 8000;

// Per-domain rate limits (requests per second) — be a good citizen
const DOMAIN_RATE_LIMITS = {
  'archive.org':              15,    // IA is permissive, no crawl-delay
  'digitale-sammlungen.de':   2,    // MDZ: reduced from 8 — was triggering rate limits
  'wellcomecollection.org':   6,    // No explicit policy
  'digital.bodleian.ox.ac.uk':4,    // No explicit policy, conservative
  'cudl.lib.cam.ac.uk':      4,    // No explicit policy, conservative
  'diglib.hab.de':            4,    // No explicit policy, conservative
  'gallica.bnf.fr':           2,    // 403'd robots.txt — gets 429 at 4/s
  'e-rara.ch':                1,    // robots.txt: 1s crawl-delay for allowed bots
  'digi.vatlib.it':           0.1,  // robots.txt: 10s crawl-delay
  'cdli.earth':               2,    // Cuneiform Digital Library — open access
  'contentdm.oclc.org':       1,    // OCLC ContentDM — conservative
  'digitalcollections.manchester.ac.uk': 2, // Manchester — no explicit policy
  'viewer.cbl.ie':            1,    // Chester Beatty Library — conservative
  'universiteitleiden.nl':    2,    // Leiden University — no explicit policy
  'digi.ub.uni-heidelberg.de':2,    // Heidelberg University — no explicit policy
  'iiif.qdl.qa':              1,    // Qatar Digital Library — conservative
  'permalinkbnd.bnportugal.gov.pt': 1, // Portugal National Library
  'images.eap.bl.uk':         4,    // British Library EAP — open access, no explicit policy
  'images.metmuseum.org':     4,    // Met Museum — open access
  'dl.ndl.go.jp':             2,    // NDL Japan IIIF — conservative
  'tudigit.ulb.tu-darmstadt.de': 2, // TU Darmstadt — no explicit policy
  'media.getty.edu':           4,    // Getty Museum IIIF — open access
  'stacks.stanford.edu':       4,   // Stanford Libraries — open access
  'rmda.kulib.kyoto-u.ac.jp':  2,   // Kyoto University — conservative
  'mps.lib.harvard.edu':       1,   // Harvard MPS — 429s at 2/s on /full/full/ upgrades. 294 books with 882 pages got 3-strike-blocked at 2/s in May 2026 before this entry was added.
  _default:                   2,    // Unknown domains: 2 req/s
};

// Token bucket per domain
const buckets = {};

function getDomain(url) {
  try {
    const host = new URL(url).hostname;
    for (const domain of Object.keys(DOMAIN_RATE_LIMITS)) {
      if (domain !== '_default' && host.includes(domain)) return domain;
    }
  } catch {}
  return '_default';
}

async function waitForToken(domain) {
  const rate = DOMAIN_RATE_LIMITS[domain] || DOMAIN_RATE_LIMITS._default;
  if (!buckets[domain]) {
    buckets[domain] = { tokens: rate, lastRefill: Date.now(), rate };
  }
  const bucket = buckets[domain];

  // Refill tokens based on elapsed time
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.rate, bucket.tokens + elapsed * bucket.rate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const waitMs = ((1 - bucket.tokens) / bucket.rate) * 1000;
    await new Promise(r => setTimeout(r, waitMs));
    bucket.tokens = 0;
    bucket.lastRefill = Date.now();
  } else {
    bucket.tokens -= 1;
  }
}

// R2 client
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

// Many archives (e-rara, some Bodleian endpoints, Wellcome, Vatican) reject
// requests without a User-Agent — Node's default UA gets blocked. Match the
// UA the IA bulk archiver uses so per-provider policies are consistent.
const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

// Abort only when a connection goes QUIET this long — never merely because a file
// is big. Overridable per-run; raising it does not slow healthy fetches.
const FETCH_STALL_MS = parseInt(process.env.ARCHIVE_STALL_TIMEOUT_MS || '60000', 10);

async function downloadImage(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Stall timeout, not a total-duration cap. The old 60s wall-clock abort
      // was a file-size limit in disguise: it fires on the LARGEST page in a
      // book — the foldout, the map, the plate — while ordinary text pages
      // sail through, and the book still reports hundreds of archived pages so
      // nothing looks wrong. See scripts/lib/fetch-stall-timeout.mjs for the
      // measured case (42 of 45 double-page engravings lost on one book).
      const { res, buffer } = await fetchWithStallTimeout(url, {
        stallMs: FETCH_STALL_MS,
        headers: { 'User-Agent': USER_AGENT, Accept: 'image/jpeg,image/png,image/*;q=0.9,*/*;q=0.1' },
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt < retries) {
          const delay = (attempt + 1) * 3000; // 3s, 6s backoff
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mimeType = res.headers.get('content-type') || 'image/jpeg';
      return { buffer, mimeType };
    } catch (err) {
      // A stalled fetch now reports "fetch aborted: stalled …" rather than a
      // bare AbortError, so retry on that too — otherwise the rename silently
      // removes a retry path that used to exist.
      const retryable = err.name === 'AbortError'
        || err.message?.includes('fetch failed')
        || err.message?.includes('fetch aborted');
      if (attempt < retries && retryable) {
        const delay = (attempt + 1) * 3000;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// upgradeToFullRes is imported from ../lib/iiif-utils.mjs

async function archivePage(page, db) {
  const originalUrl = page.photo;
  const sourceUrl = upgradeToFullRes(originalUrl);
  const domain = getDomain(sourceUrl);
  await waitForToken(domain);

  // Use the correct pages collection (pages or pages_warehouse)
  const pagesCol = page._collection || 'pages';

  try {
    // Try full-res first, fall back to original URL if it fails (some sources reject /full/full/)
    let result;
    try {
      result = await downloadImage(sourceUrl);
    } catch (err) {
      if (sourceUrl !== originalUrl) {
        result = await downloadImage(originalUrl);
      } else {
        throw err;
      }
    }
    const { buffer } = result;

    // Upload full-res + generate and upload display (1200px) + thumbnail (150px)
    const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);

    const dimFields = {};
    if (urls.width) dimFields.image_width = urls.width;
    if (urls.height) dimFields.image_height = urls.height;

    await db.collection(pagesCol).updateOne(
      { _id: page._id },
      {
        $set: {
          archived_photo: urls.archived,
          display_photo: urls.display,
          thumbnail_blob: urls.thumb,
          ...dimFields,
          'archive_metadata.archived_at': new Date(),
          'archive_metadata.source_url': sourceUrl,
          'archive_metadata.original_url': originalUrl,
          'archive_metadata.full_res': sourceUrl !== originalUrl,
          'archive_metadata.bytes': buffer.byteLength,
          updated_at: new Date(),
        }
      }
    );
    return { ok: true, bytes: buffer.byteLength, domain };
  } catch (err) {
    // Record the failure on the page document so future cron runs have
    // visibility into why the page is stuck (previously the worker returned
    // silently and left `archive_metadata` empty, producing infinite-retry
    // loops with no diagnostic trace — see MDZ 915-book stall, 2026-05-16).
    try {
      await db.collection(pagesCol).updateOne(
        { _id: page._id },
        {
          $set: {
            'archive_metadata.last_failure_at': new Date(),
            'archive_metadata.last_failure_reason': String(err.message || err).slice(0, 200),
            'archive_metadata.last_failure_source_url': sourceUrl,
          },
          $inc: { 'archive_metadata.failure_count': 1 },
        }
      );
    } catch {/* swallow — diagnostic write must not poison the result */}
    return { ok: false, error: err.message, domain };
  }
}

async function main() {
  const start = Date.now();
  const client = await MongoClient.connect(process.env.MONGODB_URI, { maxPoolSize: 10 });
  const db = client.db('bookstore');

  // Check processing_control pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(control)) {
    console.log(`[archive-ocr] Pipeline paused. Exiting.`);
    await client.close();
    process.exit(0);
  }
  // Selective unpause: when globally paused but a scope is configured, proceed
  // but confine archiving to the scoped books (free archiving must honor the
  // same scope as the paid path, #2616, or scoped books strand at `queued` with
  // no R2 images). SCOPE_FILTER spreads into every candidate query; it's empty
  // in normal (unpaused) operation, so the full queue is unaffected.
  let SCOPE_FILTER = {};
  if (control?.paused && hasScope(control)) {
    const scopeIds = [...await resolveScopeBookIds(db, control)];
    SCOPE_FILTER = { id: { $in: scopeIds } };
    console.log(`[archive-ocr] PAUSED globally, selective-unpause scope active — confining to ${scopeIds.length} allowlisted book(s).`);
  }

  console.log(`[archive-ocr] Looking for books with unarchived pages...`);
  console.log(`[archive-ocr] Per-domain rate limits: ${Object.entries(DOMAIN_RATE_LIMITS).filter(([k]) => k !== '_default').map(([k, v]) => `${k}:${v}/s`).join(', ')}`);

  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let processed = 0;
  const domainStats = {};
  const touchedBookIds = new Set();

  // Strategy: find books with pages that need archiving, regardless of pipeline status.
  // Books move through pipeline stages even if archiving isn't complete.
  // Exclude e-rara (blocked on Hetzner IPs, archived locally via launchd on Mac).
  // Exclude Gallica (429s from Hetzner, archived locally via archive-gallica.mjs on Mac).
  // Exclude Harvard (mps.lib.harvard.edu blocks Hetzner IPs at the AWS ELB, archive-harvard.mjs on Mac).
  // Exclude IA (handled by archive-bulk.mjs via JP2 zip download, much faster).
  // Prioritize providers that are NOT yet fully archived (IIIF, Cambridge, etc.)
  const PRIORITY_PROVIDERS = ['iiif', 'bsb', 'cambridge', 'vatican', 'loc', 'wellcome', 'heidelberg', 'bl', 'eap', 'met', 'ndl', 'getty', 'stanford', 'darmstadt'];
  // Candidate queries filter pages_archived < pages_count: without this they're
  // dominated by fully-archived books and the per-book inner query returns 0
  // unarchived pages for nearly every book. Symptom is "Found 6 pages across
  // 3423 books" while the library has hundreds of thousands of unarchived pages.
  const NEEDS_ARCHIVE_EXPR = { $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] } };
  const priorityBooks = await db.collection('books')
    .find(
      {
        pages_count: { $gt: 0 },
        'archive_metadata.blocked': { $ne: true },
        'image_source.provider': { $in: PRIORITY_PROVIDERS },
        ...NEEDS_ARCHIVE_EXPR,
        ...SCOPE_FILTER,
      },
      { projection: { id: 1, title: 1, 'image_source.provider': 1 } }
    )
    .limit(1000)
    .maxTimeMS(30_000)
    .toArray()
    .catch(() => []);

  // Fill remaining slots with any other non-excluded provider
  const remainingSlots = 2000 - priorityBooks.length;
  const otherBooks = remainingSlots > 0 ? await db.collection('books')
    .find(
      {
        pages_count: { $gt: 0 },
        'archive_metadata.blocked': { $ne: true },
        // 'harvard' excluded: mps.lib.harvard.edu HTTP 429s every request from Hetzner
        // IPs (verified 2026-05-25 at AWS ELB layer, both v4 and v6, all UAs, all paces).
        // Routed to Mac-side via scripts/workers/archive-harvard.mjs.
        'image_source.provider': { $nin: ['e-rara', 'gallica', 'internet_archive', 'harvard', ...PRIORITY_PROVIDERS] },
        ...NEEDS_ARCHIVE_EXPR,
        ...SCOPE_FILTER,
      },
      { projection: { id: 1, title: 1, 'image_source.provider': 1 } }
    )
    .limit(remainingSlots)
    .maxTimeMS(30_000)
    .toArray()
    .catch(() => []) : [];

  // Also include warehouse books from Hetzner-safe providers
  // Priority: likely first translations (non-English) first
  const HETZNER_SAFE_PROVIDERS = [...PRIORITY_PROVIDERS, 'mdz', 'cmc_kloss', 'bodleian', 'penn_colenda', 'kyoto_rmda', 'bph', 'oraec'];
  const warehouseBooks = await db.collection('books_warehouse')
    .find(
      {
        pages_count: { $gt: 0 },
        'archive_metadata.blocked': { $ne: true },
        'image_source.provider': { $in: HETZNER_SAFE_PROVIDERS },
        ...NEEDS_ARCHIVE_EXPR,
        ...SCOPE_FILTER,
      },
      { projection: { id: 1, title: 1, 'image_source.provider': 1, language: 1, is_first_translation: 1 } }
    )
    .limit(2000)
    .maxTimeMS(60_000)
    .toArray()
    .catch(() => []);

  // Bulk-unsuitable IA fallback. archive-bulk marks books bulk_unsuitable when
  // the JP2 zip doesn't align with the IIIF-derived photo URLs (archive drift,
  // #1504). Those books can't be archived by bulk; route them here so their
  // per-page photo URLs get fetched directly. archive.org rate limit (15 req/s)
  // is in the per-domain table.
  const bulkUnsuitableIa = await db.collection('books')
    .find(
      {
        pages_count: { $gt: 0 },
        'archive_metadata.blocked': { $ne: true },
        'archive_metadata.bulk_unsuitable': true,
        'image_source.provider': 'internet_archive',
        ...NEEDS_ARCHIVE_EXPR,
        ...SCOPE_FILTER,
      },
      { projection: { id: 1, title: 1, 'image_source.provider': 1 } }
    )
    .limit(500)
    .maxTimeMS(30_000)
    .toArray()
    .catch(() => []);

  // Sort warehouse: likely first translations first (non-English = likely first)
  const ENGLISH_VARIANTS = ['english', 'eng', 'en'];
  warehouseBooks.sort((a, b) => {
    const aEng = ENGLISH_VARIANTS.includes((a.language || '').toLowerCase());
    const bEng = ENGLISH_VARIANTS.includes((b.language || '').toLowerCase());
    if (a.is_first_translation && !b.is_first_translation) return -1;
    if (!a.is_first_translation && b.is_first_translation) return 1;
    if (!aEng && bEng) return -1;
    if (aEng && !bEng) return 1;
    return 0;
  });
  // Tag warehouse books so we know which collections to query
  warehouseBooks.forEach(b => { b._warehouse = true; });

  const books = [...priorityBooks, ...bulkUnsuitableIa, ...otherBooks, ...warehouseBooks];
  console.log(`[archive-ocr] Checking ${priorityBooks.length} priority + ${bulkUnsuitableIa.length} bulk-unsuitable IA + ${otherBooks.length} other + ${warehouseBooks.length} warehouse books`);

  if (books.length === 0) {
    console.log(`[archive-ocr] No books with pages found`);
    await client.close();
    return;
  }

  // Fetch unarchived pages per book (uses pages_book_pagenum_idx)
  const pages = [];
  const pagesPerBook = Math.ceil(MAX_PAGES / books.length);
  for (const book of books) {
    if (pages.length >= MAX_PAGES) break;
    const pagesCol = book._warehouse ? 'pages_warehouse' : 'pages';
    const bookPages = await db.collection(pagesCol)
      .find(
        {
          book_id: book.id,
          photo: { $exists: true, $nin: [null, ''] },
          'archive_metadata.blocked': { $ne: true }, // Skip pages marked dead by cleanup-dead-pages.mjs
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: null },
            { archived_photo: '' },
          ],
          // Skip pages that have failed 3+ times — they have permanently broken
          // source URLs (e.g. malformed IIIF templates from old imports). They
          // poison every run by tripping the per-domain circuit breaker (5 fails
          // with 0 oks). Re-archiving these requires fixing the photo URL first.
          $and: [{
            $or: [
              { 'archive_metadata.failure_count': { $exists: false } },
              { 'archive_metadata.failure_count': { $lt: 3 } },
            ],
          }],
        },
        { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } }
      )
      .limit(pagesPerBook)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);
    // Tag pages with their collection for archivePage to write to the right place
    if (book._warehouse) bookPages.forEach(p => { p._collection = 'pages_warehouse'; });
    pages.push(...bookPages);
  }

  if (pages.length === 0) {
    console.log(`[archive-ocr] No unarchived pages found across ${books.length} books`);
    await client.close();
    return;
  }

  console.log(`[archive-ocr] Found ${pages.length} pages across ${books.length} books`);

  // Group by domain with per-domain cap
  // Skip Gallica pages — handled locally by archive-gallica.mjs (Hetzner gets 429)
  const byDomain = {};
  // Skip domains that block Hetzner egress IPs outright — they're handled by
  // launchd-driven local workers on Mac (archive-gallica, archive-erara).
  // Including them here just trips the 5-fail-0-ok circuit breaker and burns
  // failure_count budget on pages that have no chance of succeeding here.
  const HETZNER_BLOCKED_DOMAINS = new Set(['gallica.bnf.fr', 'e-rara.ch']);
  for (const page of pages) {
    const domain = getDomain(page.photo);
    if (HETZNER_BLOCKED_DOMAINS.has(domain)) continue;
    if (!byDomain[domain]) byDomain[domain] = [];
    if (byDomain[domain].length < MAX_PAGES_PER_DOMAIN) {
      byDomain[domain].push(page);
    }
  }

  console.log(`[archive-ocr] Domain breakdown: ${Object.entries(byDomain).map(([d, p]) => `${d}:${p.length}`).join(', ')}`);

  // Process all domains in parallel — each domain runs multiple concurrent workers.
  // The token bucket ensures we stay within rate limits even with concurrency.
  const DOMAIN_CONCURRENCY = 8; // Workers per domain (token bucket throttles them)
  let circuitBroken = new Set(); // Domains that hit circuit breaker

  // Threshold for the consecutive-failure breaker. Picked to be:
  // - high enough to weather a transient blip (a single bad page won't trip it),
  // - low enough that ~one batch of 8 concurrent workers x ~2 ticks catches a
  //   sustained 429 storm before it burns hundreds of pages.
  const CONSECUTIVE_FAIL_THRESHOLD = 20;

  const domainWorkers = Object.entries(byDomain).map(async ([domain, domainPages]) => {
    if (!domainStats[domain]) domainStats[domain] = { ok: 0, fail: 0, consecutiveFails: 0 };
    let idx = 0;

    async function worker() {
      while (idx < domainPages.length && !circuitBroken.has(domain)) {
        const page = domainPages[idx++];
        if (!page) break;

        const result = await archivePage(page, db);
        processed++;

        const ds = domainStats[domain];
        if (result.ok) {
          archived++;
          totalBytes += result.bytes;
          ds.ok++;
          ds.consecutiveFails = 0; // any success resets the streak
          touchedBookIds.add(page.book_id);
        } else {
          failed++;
          ds.fail++;
          ds.consecutiveFails = (ds.consecutiveFails || 0) + 1;
          if (failed <= 10) console.error(`  FAIL [${domain}]: ${result.error}`);

          // Cold-start breaker: 5 fails with 0 successes — looks like the
          // domain is unreachable from the start.
          if (ds.fail >= 5 && ds.ok === 0) {
            console.warn(`  [${domain}] Circuit breaker: 5 failures with 0 successes, skipping domain`);
            circuitBroken.add(domain);
            break;
          }
          // Sustained-failure breaker: N back-to-back failures after some
          // earlier successes. This catches the "rate limit kicks in
          // mid-run" case the cumulative ratio check misses — once a
          // domain has thousands of early successes, cumulative ratio
          // stays under 90% even during a sustained 429 storm, so the
          // worker would keep burning pages forever (see #1909/#1914
          // class of issues). Any success resets the counter, so a
          // transient blip doesn't trip it.
          if (ds.consecutiveFails >= CONSECUTIVE_FAIL_THRESHOLD) {
            console.warn(`  [${domain}] Circuit breaker: ${ds.consecutiveFails} consecutive failures after ${ds.ok} successes, skipping domain`);
            circuitBroken.add(domain);
            break;
          }
          // Cumulative-ratio breaker: noisy domain with mostly-bad pages.
          const total = ds.ok + ds.fail;
          if (total >= 50 && ds.fail / total > 0.9) {
            console.warn(`  [${domain}] Circuit breaker: ${ds.fail}/${total} failed (${(ds.fail/total*100).toFixed(0)}%), skipping domain`);
            circuitBroken.add(domain);
            break;
          }
        }

        if (processed % 100 === 0) {
          const mb = (totalBytes / (1024 * 1024)).toFixed(1);
          console.log(`  ${processed}/${pages.length} processed, ${archived} archived (${mb} MB), ${failed} failed`);
        }
      }
    }

    const workerCount = Math.min(DOMAIN_CONCURRENCY, domainPages.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  });

  await Promise.all(domainWorkers);

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[archive-ocr] Done in ${duration}s: ${archived} archived (${mb} MB), ${failed} failed`);
  console.log(`[archive-ocr] Per-domain: ${Object.entries(domainStats).map(([d, s]) => `${d}:${s.ok}ok/${s.fail}fail`).join(', ')}`);

  // Sync pages_archived counter on touched books (#497)
  // Track which books are warehouse vs live
  const warehouseBookIds = new Set(books.filter(b => b._warehouse).map(b => b.id));
  if (touchedBookIds.size > 0) {
    let synced = 0;
    for (const bookId of touchedBookIds) {
      const isWarehouse = warehouseBookIds.has(bookId);
      const pagesCol = isWarehouse ? 'pages_warehouse' : 'pages';
      const booksCol = isWarehouse ? 'books_warehouse' : 'books';
      const archivedCount = await db.collection(pagesCol).countDocuments(
        { book_id: bookId, archived_photo: { $exists: true, $nin: [null, ''] } },
        { maxTimeMS: 10000 }
      );
      // Look up pages_count for the status flip (the IA bulk worker has this
      // in its book projection; here we don't, so look it up).
      const bookDoc = await db.collection(booksCol).findOne(
        { id: bookId },
        { projection: { pages_count: 1 } },
      );
      const isComplete = bookDoc && archivedCount >= (bookDoc.pages_count || 0);
      const update = {
        pages_archived: archivedCount,
        archive_status: isComplete ? 'archive_complete' : 'archive_partial',
        updated_at: new Date(),
      };
      // See archive-bulk.mjs for the same pattern — stamp completion time
      // so weekly-throughput queries don't have to scan pages.
      if (isComplete) update.archive_completed_at = new Date();
      await db.collection(booksCol).updateOne(
        { id: bookId },
        { $set: update }
      );
      synced++;
    }
    console.log(`[archive-ocr] Synced pages_archived on ${synced} books (${[...touchedBookIds].filter(id => warehouseBookIds.has(id)).length} warehouse)`);
  }

  // Log to cron_runs for monitoring
  await db.collection('cron_runs').insertOne({
    cron: 'archive-ocr',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, domainStats },
  });

  await client.close();
}

main().catch(err => {
  console.error('[archive-ocr] Fatal:', err);
  process.exit(1);
});
