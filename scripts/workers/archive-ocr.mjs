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
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';

const MAX_PAGES = 10_000;
const MAX_PAGES_PER_DOMAIN = 5000;  // Prevent one domain from crowding out others

// Per-domain rate limits (requests per second) — be a good citizen
const DOMAIN_RATE_LIMITS = {
  'archive.org':              15,    // IA is permissive, no crawl-delay
  'digitale-sammlungen.de':   8,    // MDZ: open robots.txt
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
  _default:                   2,    // Unknown domains: 1 req/s
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

async function downloadImage(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000); // 60s for full-res images
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { buffer, mimeType };
  } finally {
    clearTimeout(timeout);
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

/**
 * Upgrade a IIIF image URL to full resolution.
 * Most sources store photo URLs at reduced resolution (pct:50, 1000px, etc.).
 * For archival, we want the highest resolution available.
 */
function upgradeToFullRes(url) {
  try {
    // Internet Archive IIIF: .../full/pct:50/0/default.jpg -> .../full/full/0/default.jpg
    if (url.includes('archive.org') && url.includes('/full/pct:')) {
      return url.replace(/\/full\/pct:\d+\//, '/full/full/');
    }
    // MDZ (digitale-sammlungen): .../full/1000,/0/default.jpg -> .../full/full/0/default.jpg
    if (url.includes('digitale-sammlungen') && url.match(/\/full\/\d+,\//)) {
      return url.replace(/\/full\/\d+,\//, '/full/full/');
    }
    // Gallica IIIF: same pattern
    if (url.includes('gallica') && url.match(/\/full\/\d+,?\d*\//)) {
      return url.replace(/\/full\/\d+,?\d*\//, '/full/full/');
    }
    // Vatican IIIF
    if (url.includes('digi.vatlib') && url.match(/\/full\/\d+,?\d*\//)) {
      return url.replace(/\/full\/\d+,?\d*\//, '/full/full/');
    }
    // e-rara, Bodleian, Cambridge, HAB, Wellcome — all IIIF
    if (url.match(/\/full\/(?:pct:\d+|\d+,?\d*)\/\d+\/default\./)) {
      return url.replace(/\/full\/(?:pct:\d+|\d+,?\d*)\//, '/full/full/');
    }
  } catch {}
  return url; // Return original if no upgrade pattern matches
}

async function archivePage(page, db) {
  const originalUrl = page.photo;
  const sourceUrl = upgradeToFullRes(originalUrl);
  const domain = getDomain(sourceUrl);
  await waitForToken(domain);

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

    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          archived_photo: urls.archived,
          display_photo: urls.display,
          thumbnail_blob: urls.thumb,
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
    return { ok: false, error: err.message, domain };
  }
}

async function main() {
  const start = Date.now();
  const client = await MongoClient.connect(process.env.MONGODB_URI, { maxPoolSize: 5 });
  const db = client.db('bookstore');

  // Check processing_control pause
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (control?.paused) {
    console.log(`[archive-ocr] Pipeline paused. Exiting.`);
    await client.close();
    process.exit(0);
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
  // Exclude IA (handled by archive-bulk.mjs via JP2 zip download, much faster).
  // Prioritize providers that are NOT yet fully archived (IIIF, Gallica, Cambridge, etc.)
  const PRIORITY_PROVIDERS = ['iiif', 'gallica', 'cambridge', 'vatican', 'loc', 'wellcome', 'heidelberg', 'bl'];
  const priorityBooks = await db.collection('books')
    .find(
      {
        pages_count: { $gt: 0 },
        'archive_metadata.blocked': { $ne: true },
        'image_source.provider': { $in: PRIORITY_PROVIDERS },
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
        'image_source.provider': { $nin: ['e-rara', 'internet_archive', ...PRIORITY_PROVIDERS] },
      },
      { projection: { id: 1, title: 1, 'image_source.provider': 1 } }
    )
    .limit(remainingSlots)
    .maxTimeMS(30_000)
    .toArray()
    .catch(() => []) : [];

  const books = [...priorityBooks, ...otherBooks];
  console.log(`[archive-ocr] Checking ${priorityBooks.length} priority + ${otherBooks.length} other books`);

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
    const bookPages = await db.collection('pages')
      .find(
        {
          book_id: book.id,
          photo: { $exists: true, $nin: [null, ''] },
          $or: [
            { archived_photo: { $exists: false } },
            { archived_photo: null },
            { archived_photo: '' },
          ],
        },
        { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } }
      )
      .limit(pagesPerBook)
      .maxTimeMS(10_000)
      .toArray()
      .catch(() => []);
    pages.push(...bookPages);
  }

  if (pages.length === 0) {
    console.log(`[archive-ocr] No unarchived pages found across ${books.length} books`);
    await client.close();
    return;
  }

  console.log(`[archive-ocr] Found ${pages.length} pages across ${books.length} books`);

  // Group by domain with per-domain cap
  const byDomain = {};
  for (const page of pages) {
    const domain = getDomain(page.photo);
    if (!byDomain[domain]) byDomain[domain] = [];
    if (byDomain[domain].length < MAX_PAGES_PER_DOMAIN) {
      byDomain[domain].push(page);
    }
  }

  console.log(`[archive-ocr] Domain breakdown: ${Object.entries(byDomain).map(([d, p]) => `${d}:${p.length}`).join(', ')}`);

  // Process all domains in parallel — each domain runs multiple concurrent workers.
  // The token bucket ensures we stay within rate limits even with concurrency.
  const DOMAIN_CONCURRENCY = 5; // Workers per domain (token bucket throttles them)
  let circuitBroken = new Set(); // Domains that hit circuit breaker

  const domainWorkers = Object.entries(byDomain).map(async ([domain, domainPages]) => {
    if (!domainStats[domain]) domainStats[domain] = { ok: 0, fail: 0 };
    let idx = 0;

    async function worker() {
      while (idx < domainPages.length && !circuitBroken.has(domain)) {
        const page = domainPages[idx++];
        if (!page) break;

        const result = await archivePage(page, db);
        processed++;

        if (result.ok) {
          archived++;
          totalBytes += result.bytes;
          domainStats[domain].ok++;
          touchedBookIds.add(page.book_id);
        } else {
          failed++;
          domainStats[domain].fail++;
          if (failed <= 10) console.error(`  FAIL [${domain}]: ${result.error}`);
          if (domainStats[domain].fail >= 5 && domainStats[domain].ok === 0) {
            console.warn(`  [${domain}] Circuit breaker: 5 failures with 0 successes, skipping domain`);
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
  if (touchedBookIds.size > 0) {
    let synced = 0;
    for (const bookId of touchedBookIds) {
      const archivedCount = await db.collection('pages').countDocuments(
        { book_id: bookId, archived_photo: { $exists: true, $nin: [null, ''] } },
        { maxTimeMS: 10000 }
      );
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: { pages_archived: archivedCount, updated_at: new Date() } }
      );
      synced++;
    }
    console.log(`[archive-ocr] Synced pages_archived on ${synced} books`);
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
