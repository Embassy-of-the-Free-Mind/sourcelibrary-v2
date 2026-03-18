#!/usr/bin/env node
// Hetzner standalone archive-ocr worker
// Replaces the Vercel cron /api/cron/archive-ocr
//
// Finds pages with OCR data but no archived_photo, downloads the source image,
// uploads to R2, and updates MongoDB.
//
// Per-domain rate limiting based on robots.txt and library policies:
//   IA: permissive (no crawl-delay)
//   e-rara: 1s crawl-delay in robots.txt
//   Vatican: 10s crawl-delay in robots.txt
//   Gallica, Bodleian, Cambridge, HAB: conservative (no explicit policy)
//   MDZ: open (no restrictions)
//
// Run: set -a; source .env.production.local; set +a; node scripts/workers/archive-ocr.mjs

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const MAX_PAGES = 2000;

// Per-domain rate limits (requests per second) — be a good citizen
const DOMAIN_RATE_LIMITS = {
  'archive.org':              8,    // IA is permissive, no crawl-delay
  'digitale-sammlungen.de':   4,    // MDZ: open robots.txt
  'wellcomecollection.org':   3,    // No explicit policy
  'digital.bodleian.ox.ac.uk':2,    // No explicit policy, conservative
  'cudl.lib.cam.ac.uk':      2,    // No explicit policy, conservative
  'diglib.hab.de':            2,    // No explicit policy, conservative
  'gallica.bnf.fr':           2,    // 403'd robots.txt — be careful
  'e-rara.ch':                1,    // robots.txt: 1s crawl-delay for allowed bots
  'digi.vatlib.it':           0.1,  // robots.txt: 10s crawl-delay
  _default:                   1,    // Unknown domains: 1 req/s
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
  const timeout = setTimeout(() => controller.abort(), 30_000);
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

async function archivePage(page, db) {
  const sourceUrl = page.photo;
  const domain = getDomain(sourceUrl);
  await waitForToken(domain);

  try {
    const { buffer, mimeType } = await downloadImage(sourceUrl);
    const key = `archived/${page.book_id}/${page.page_number}.jpg`;
    const url = await uploadToR2(key, buffer, mimeType);

    await db.collection('pages').updateOne(
      { _id: page._id },
      {
        $set: {
          archived_photo: url,
          'archive_metadata.archived_at': new Date(),
          'archive_metadata.source_url': sourceUrl,
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
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const query = {
    'ocr.data': { $exists: true, $nin: [null, ''] },
    photo: { $exists: true, $nin: [null, ''] },
    $or: [
      { archived_photo: { $exists: false } },
      { archived_photo: null },
      { archived_photo: '' },
    ],
  };

  const totalNeeding = await db.collection('pages').countDocuments(query);
  if (totalNeeding === 0) {
    console.log(`[archive-ocr] No pages need archiving`);
    await client.close();
    return;
  }

  console.log(`[archive-ocr] ${totalNeeding} pages need archiving (processing up to ${MAX_PAGES})`);
  console.log(`[archive-ocr] Per-domain rate limits: ${Object.entries(DOMAIN_RATE_LIMITS).filter(([k]) => k !== '_default').map(([k, v]) => `${k}:${v}/s`).join(', ')}`);

  let archived = 0;
  let failed = 0;
  let totalBytes = 0;
  let processed = 0;
  const domainStats = {};

  // Group pages by domain and process each domain's pages concurrently
  // but respect per-domain rate limits within each group
  const pages = await db.collection('pages')
    .find(query, { projection: { _id: 1, book_id: 1, page_number: 1, photo: 1 } })
    .limit(MAX_PAGES)
    .toArray();

  // Group by domain
  const byDomain = {};
  for (const page of pages) {
    const domain = getDomain(page.photo);
    if (!byDomain[domain]) byDomain[domain] = [];
    byDomain[domain].push(page);
  }

  console.log(`[archive-ocr] Domain breakdown: ${Object.entries(byDomain).map(([d, p]) => `${d}:${p.length}`).join(', ')}`);

  // Process all domains in parallel — each domain processes sequentially at its own rate
  const domainWorkers = Object.entries(byDomain).map(async ([domain, domainPages]) => {
    for (const page of domainPages) {
      const result = await archivePage(page, db);
      processed++;

      if (!domainStats[domain]) domainStats[domain] = { ok: 0, fail: 0 };

      if (result.ok) {
        archived++;
        totalBytes += result.bytes;
        domainStats[domain].ok++;
      } else {
        failed++;
        domainStats[domain].fail++;
        if (failed <= 10) console.error(`  FAIL [${domain}]: ${result.error}`);
        // Circuit breaker: if 5 consecutive failures on a domain, skip it
        if (domainStats[domain].fail >= 5 && domainStats[domain].ok === 0) {
          console.warn(`  [${domain}] Circuit breaker: 5 failures with 0 successes, skipping domain`);
          break;
        }
      }

      if (processed % 100 === 0) {
        const mb = (totalBytes / (1024 * 1024)).toFixed(1);
        console.log(`  ${processed}/${pages.length} processed, ${archived} archived (${mb} MB), ${failed} failed`);
      }
    }
  });

  await Promise.all(domainWorkers);

  const duration = ((Date.now() - start) / 1000).toFixed(1);
  const mb = (totalBytes / (1024 * 1024)).toFixed(1);
  console.log(`[archive-ocr] Done in ${duration}s: ${archived} archived (${mb} MB), ${failed} failed, ${totalNeeding - processed} remaining`);
  console.log(`[archive-ocr] Per-domain: ${Object.entries(domainStats).map(([d, s]) => `${d}:${s.ok}ok/${s.fail}fail`).join(', ')}`);

  // Log to cron_runs for monitoring
  await db.collection('cron_runs').insertOne({
    cron: 'archive-ocr',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: failed === 0 ? 'success' : 'partial',
    actions: { archived, failed, bytes: totalBytes, remaining: totalNeeding - processed, domainStats },
  });

  await client.close();
}

main().catch(err => {
  console.error('[archive-ocr] Fatal:', err);
  process.exit(1);
});
