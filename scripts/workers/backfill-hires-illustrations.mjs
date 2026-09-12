#!/usr/bin/env node
/**
 * Backfill high-resolution archives for illustration pages.
 *
 * Existing R2 archives are capped at 2000px (often less because IIIF source URLs
 * were imported at /full/2000,/ or /full/1000,/). Pages with extracted illustrations
 * deserve full native resolution for zoom and scholarly use. This script targets only
 * pages that appear in `gallery_images` — text-only pages stay at the existing display
 * resolution.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/backfill-hires-illustrations.mjs
 *
 *   --limit N           Process at most N illustration pages (default: all)
 *   --book-id ID        Only process this specific book (for testing)
 *   --concurrency N     Per-domain concurrency (default 3)
 *   --rate-per-sec N    Override per-domain rate cap for ALL domains
 *   --include-domain X  Override SKIP_DOMAINS for X (e.g. gallica.bnf.fr — only safe
 *                       from a residential IP, since cloud IPs get hard-throttled)
 *   --dry-run           Just show what would be re-archived
 *
 * Source URL upgrade: applies the same /full/<size>/ → /full/full/ transform as
 * archive-ocr.mjs. Books on BPH or other non-IIIF providers are skipped.
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';
import { upgradeToFullRes, fetchPageMaster, dimensionFields } from '../lib/iiif-utils.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = (() => { const i = process.argv.indexOf('--limit'); return i !== -1 ? parseInt(process.argv[i+1]) : 0; })();
const BOOK_ID = (() => { const i = process.argv.indexOf('--book-id'); return i !== -1 ? process.argv[i+1] : null; })();
const CONCURRENCY = (() => { const i = process.argv.indexOf('--concurrency'); return i !== -1 ? parseInt(process.argv[i+1]) : 3; })();
const RATE_OVERRIDE = (() => { const i = process.argv.indexOf('--rate-per-sec'); return i !== -1 ? parseFloat(process.argv[i+1]) : null; })();
const INCLUDE_DOMAINS = (() => {
  const out = new Set();
  for (let i = 0; i < process.argv.length - 1; i++) {
    if (process.argv[i] === '--include-domain') out.add(process.argv[i + 1]);
  }
  return out;
})();

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function uploadToR2(key, buffer, contentType) {
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET, Key: key, Body: buffer, ContentType: contentType,
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Token bucket per domain (mirror archive-ocr.mjs limits, conservative)
const RATE = {
  'gallica.bnf.fr': 2, 'api.digitale-sammlungen.de': 4, 'iiif.bodleian.ox.ac.uk': 2,
  'images.lib.cam.ac.uk': 3, 'iiif.wellcomecollection.org': 3, 'digi.vatlib.it': 3,
  'bl.digirati.io': 2, 'archive.org': 4, '_default': 3,
};
const buckets = new Map();
function getDomain(url) { try { return new URL(url).hostname; } catch { return 'unknown'; } }
async function waitForToken(domain) {
  const limit = RATE_OVERRIDE ?? RATE[domain] ?? RATE._default;
  if (!buckets.has(domain)) buckets.set(domain, { last: 0, count: 0 });
  const b = buckets.get(domain);
  const now = Date.now();
  if (now - b.last >= 1000) { b.last = now; b.count = 0; }
  if (b.count >= limit) {
    await new Promise(r => setTimeout(r, 1000 - (now - b.last) + 50));
    b.last = Date.now(); b.count = 0;
  }
  b.count++;
}

async function downloadImage(url, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 60_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'SourceLibrary-Backfill/1.0' } });
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        clearTimeout(t);
        await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      clearTimeout(t);
      if (attempt < retries) { await new Promise(r => setTimeout(r, (attempt + 1) * 3000)); continue; }
      throw err;
    } finally { clearTimeout(t); }
  }
}

// Domains that hard-throttle from Hetzner/cloud IPs. archive-ocr.mjs already
// excludes Gallica for the same reason — they use archive-gallica.mjs from a
// residential IP. Run that separately for Gallica books.
const SKIP_DOMAINS = new Set(['gallica.bnf.fr']);

async function archivePageHires(page, db) {
  const original = page.photo;
  if (!original || !/^https?:\/\//.test(original)) return { skip: 'no source url' };
  // Skip non-IIIF sources — already at native res or different provider entirely
  if (!original.match(/\/full\/(?:pct:\d+|\d+,?\d*|full|max)\/\d+\/default\./i)) {
    return { skip: 'not IIIF' };
  }
  const d = getDomain(original);
  if (SKIP_DOMAINS.has(d) && !INCLUDE_DOMAINS.has(d)) {
    return { skip: 'rate-throttled domain (use archive-gallica.mjs or pass --include-domain)' };
  }
  const fullRes = upgradeToFullRes(original);
  if (fullRes === original) return { skip: 'no upgrade pattern' };

  const domain = getDomain(fullRes);
  await waitForToken(domain);

  // This worker exists to get HIGHER resolution for illustrated pages, so a
  // silently-capped response defeats its whole purpose. fetchPageMaster adds the
  // tile-stitch route on known cappers and reports what the source said was
  // available; the retry + full-res-then-original fallback below stays this
  // worker's own (#4406).
  let master;
  try {
    const download = async (u) => {
      try {
        return await downloadImage(u);
      } catch (err) {
        if (u !== original) return await downloadImage(original);
        throw err;
      }
    };
    master = await fetchPageMaster(fullRes, { download });
  } catch (err) {
    return { fail: err.message };
  }
  const buffer = master.buffer;

  if (!buffer || buffer.byteLength < 1000) return { fail: `tiny buffer (${buffer?.byteLength || 0}b)` };

  const urls = await uploadPageVariants(buffer, page.book_id, page.page_number, uploadToR2);
  const dimFields = dimensionFields({ width: urls.width, height: urls.height }, master);

  await db.collection('pages').updateOne(
    { _id: page._id },
    { $set: {
      archived_photo: urls.archived,
      display_photo: urls.display,
      thumbnail_blob: urls.thumb,
      ...dimFields,
      'archive_metadata.archived_at': new Date(),
      'archive_metadata.source_url': fullRes,
      'archive_metadata.original_url': original,
      'archive_metadata.full_res': true,
      'archive_metadata.bytes': buffer.byteLength,
      'archive_metadata.hires_backfill': new Date(),
      updated_at: new Date(),
    }}
  );

  return { ok: true, bytes: buffer.byteLength, width: urls.width, height: urls.height };
}

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI, { socketTimeoutMS: 600_000 });
  const db = client.db('bookstore');
  console.log(`[backfill-hires] ${DRY_RUN ? 'DRY RUN' : 'LIVE'} | concurrency ${CONCURRENCY}`);

  // Get unique (book_id, page_number) from gallery_images
  const matchStage = BOOK_ID ? { $match: { book_id: BOOK_ID } } : { $match: { book_id: { $exists: true }, page_number: { $exists: true } } };
  console.log(`[backfill-hires] Aggregating illustration pages from gallery_images...`);
  const pairs = await db.collection('gallery_images').aggregate([
    matchStage,
    { $group: { _id: { b: '$book_id', p: '$page_number' } } },
    { $project: { book_id: '$_id.b', page_number: '$_id.p', _id: 0 } },
  ], { allowDiskUse: true }).toArray();
  console.log(`[backfill-hires] Found ${pairs.length.toLocaleString()} unique illustration pages`);

  // Fetch the actual page documents
  const pages = [];
  const PAGE_BATCH = 500;
  for (let i = 0; i < pairs.length; i += PAGE_BATCH) {
    const batch = pairs.slice(i, i + PAGE_BATCH);
    const orClauses = batch.map(p => ({ book_id: p.book_id, page_number: p.page_number }));
    const docs = await db.collection('pages').find({ $or: orClauses })
      .project({ _id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, 'archive_metadata.hires_backfill': 1 })
      .toArray();
    pages.push(...docs);
  }
  console.log(`[backfill-hires] Resolved ${pages.length.toLocaleString()} page documents`);

  // Skip pages already backfilled (idempotent)
  const todo = pages.filter(p => !p.archive_metadata?.hires_backfill);
  console.log(`[backfill-hires] To process: ${todo.length.toLocaleString()} (skipped ${pages.length - todo.length} already done)`);

  const subset = LIMIT ? todo.slice(0, LIMIT) : todo;
  console.log(`[backfill-hires] Processing ${subset.length.toLocaleString()} pages`);

  if (DRY_RUN) {
    const samples = subset.slice(0, 5);
    for (const p of samples) {
      const upgraded = upgradeToFullRes(p.photo || '');
      console.log(`  ${p.book_id} p${p.page_number}: ${(p.photo || '').substring(0, 70)} → ${upgraded.substring(0, 70)}`);
    }
    if (subset.length > 5) console.log(`  ... and ${subset.length - 5} more`);
    await client.close();
    return;
  }

  // Group by domain, run concurrent workers per domain
  const byDomain = {};
  for (const p of subset) {
    const d = getDomain(p.photo || '');
    if (!byDomain[d]) byDomain[d] = [];
    byDomain[d].push(p);
  }
  console.log(`[backfill-hires] Domain breakdown:`, Object.fromEntries(Object.entries(byDomain).map(([d, ps]) => [d, ps.length])));

  let ok = 0, fail = 0, skip = 0, totalBytes = 0;
  const t0 = Date.now();

  await Promise.all(Object.entries(byDomain).map(async ([domain, queue]) => {
    async function worker() {
      while (queue.length > 0) {
        const page = queue.shift();
        if (!page) break;
        try {
          const r = await archivePageHires(page, db);
          if (r.ok) {
            ok++;
            totalBytes += r.bytes;
            if (ok % 10 === 0) {
              const mb = (totalBytes / 1024 / 1024).toFixed(1);
              const rate = (ok / ((Date.now() - t0) / 1000)).toFixed(1);
              console.log(`  ${ok} ok / ${fail} fail / ${skip} skip — ${mb}MB — ${rate} pages/s`);
            }
          } else if (r.skip) skip++;
          else { fail++; console.log(`  FAIL ${page.book_id} p${page.page_number}: ${r.fail}`); }
        } catch (err) {
          fail++;
          console.log(`  ERR ${page.book_id} p${page.page_number}: ${err.message?.substring(0, 80)}`);
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  }));

  const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
  const mb = (totalBytes / 1024 / 1024).toFixed(1);
  console.log(`\n[backfill-hires] DONE — ${ok} ok, ${fail} fail, ${skip} skip — ${mb}MB in ${elapsed}min`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
