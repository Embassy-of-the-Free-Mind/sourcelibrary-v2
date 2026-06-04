#!/usr/bin/env node
/**
 * Backfill IIIF manifests for already-imported books (issue #2416).
 *
 * Fetches the raw manifest for every book that has `image_source.iiif_manifest`
 * set and stores it in the `iiif_manifests` collection (raw JSON + pre-extracted
 * page URLs + version/label/page_count). Idempotent and resumable: by default it
 * skips manifests already stored without an error.
 *
 * Manifests are cheap JSON GETs (not the image servers the archiver hits), but
 * we still throttle per source host to stay polite.
 *
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-iiif-manifests.mjs            # dry run
 *   node scripts/maintenance/backfill-iiif-manifests.mjs --commit   # do it
 *
 * Flags:
 *   --commit            actually fetch + write (default: dry run, just counts)
 *   --limit N           cap number of books processed
 *   --provider X        only books with image_source.provider == X
 *   --visible-only      only visible:true books
 *   --refetch           re-fetch even if already stored (default: skip stored OK)
 *   --concurrency N     parallel fetches (default 8)
 *   --host-delay MS     min ms between requests to the same host (default 200)
 *   --no-raw            store metadata + page URLs but not the raw JSON
 *   --timeout MS        per-request timeout (default 30000)
 */

import { MongoClient } from 'mongodb';
import { ensureManifestIndexes, fetchAndStoreManifest, fetchAndStoreIaMetadata } from '../iiif-discovery/lib/manifest-store.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

const COMMIT = has('--commit');
const LIMIT = parseInt(val('--limit', '0'), 10) || 0;
const PROVIDER = val('--provider', null);
const VISIBLE_ONLY = has('--visible-only');
const REFETCH = has('--refetch');
const CONCURRENCY = parseInt(val('--concurrency', '8'), 10);
const HOST_DELAY = parseInt(val('--host-delay', '200'), 10);
const STORE_RAW = !has('--no-raw');
const TIMEOUT = parseInt(val('--timeout', '30000'), 10);

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set (source .env.production.local)'); process.exit(1); }

const client = new MongoClient(uri, { maxPoolSize: CONCURRENCY + 2 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');

await ensureManifestIndexes(db);

const filter = { 'image_source.iiif_manifest': { $exists: true, $ne: null } };
if (PROVIDER) filter['image_source.provider'] = PROVIDER;
if (VISIBLE_ONLY) filter.visible = true;

const totalMatching = await db.collection('books').countDocuments(filter);

// Already-stored manifest URLs without an error → skip unless --refetch.
const storedOk = new Set();
if (!REFETCH) {
  const cur = db.collection('iiif_manifests').find({ error: null }, { projection: { manifest_url: 1 } });
  for await (const d of cur) storedOk.add(d.manifest_url);
}

// Build the work list (dedupe manifest URLs — page-range imports share one).
const projection = { 'image_source.iiif_manifest': 1, 'image_source.provider': 1, id: 1 };
let cursor = db.collection('books').find(filter, { projection });
if (LIMIT) cursor = cursor.limit(LIMIT);

const seen = new Set();
const work = [];
for await (const b of cursor) {
  const url = b.image_source?.iiif_manifest;
  if (!url || seen.has(url)) continue;
  seen.add(url);
  if (!REFETCH && storedOk.has(url)) continue;
  work.push({ manifest_url: url, book_id: b.id ?? b._id?.toString() ?? null, source: b.image_source?.provider ?? null });
}

console.log(`Books matching filter: ${totalMatching}`);
console.log(`Unique manifest URLs in scope: ${seen.size}`);
console.log(`Already stored (skipped): ${seen.size - work.length}`);
console.log(`To fetch: ${work.length}`);
if (PROVIDER) console.log(`Provider filter: ${PROVIDER}`);
if (!COMMIT) {
  console.log('\nDRY RUN — re-run with --commit to fetch and store.');
  // Show provider breakdown of the work list.
  const byProv = {};
  for (const w of work) byProv[w.source || 'unknown'] = (byProv[w.source || 'unknown'] || 0) + 1;
  Object.entries(byProv).sort((a, b) => b[1] - a[1]).forEach(([p, n]) => console.log(`  ${p}: ${n}`));
  await client.close();
  process.exit(0);
}

// --- Concurrent fetch with per-host min-interval throttle ---
const hostNext = new Map(); // host -> earliest epoch ms for next request
function hostOf(u) { try { return new URL(u).host; } catch { return 'unknown'; } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let idx = 0, ok = 0, failed = 0, pages = 0;
const started = Date.now();

async function worker() {
  while (idx < work.length) {
    const item = work[idx++];
    const host = hostOf(item.manifest_url);
    // Polite spacing per host.
    const now = Date.now();
    const next = hostNext.get(host) || 0;
    if (next > now) await sleep(next - now);
    hostNext.set(host, Date.now() + HOST_DELAY);

    // Internet Archive: use the lightweight metadata endpoint (fast, ~8KB,
    // carries imagecount) instead of the heavy, timeout-prone IIIF manifest.
    const isIA = item.source === 'internet_archive' || /(\.|\/)archive(lab)?\.org/i.test(host);
    const r = isIA
      ? await fetchAndStoreIaMetadata(db, {
          manifest_url: item.manifest_url,
          book_id: item.book_id,
          timeoutMs: TIMEOUT,
          storeRaw: STORE_RAW,
        })
      : await fetchAndStoreManifest(db, {
          manifest_url: item.manifest_url,
          book_id: item.book_id,
          source: item.source,
          timeoutMs: TIMEOUT,
          storeRaw: STORE_RAW,
        });
    if (r.ok) { ok++; pages += r.page_count || 0; }
    else { failed++; }

    const done = ok + failed;
    if (done % 50 === 0 || done === work.length) {
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      const rate = (done / Math.max(1, (Date.now() - started) / 1000)).toFixed(2);
      console.log(`  ${done}/${work.length} — ${ok} ok (${pages} pages), ${failed} failed (${secs}s, ${rate}/s)`);
    }
  }
}

console.log(`\nFetching ${work.length} manifests, concurrency ${CONCURRENCY}, host-delay ${HOST_DELAY}ms${STORE_RAW ? '' : ', no raw'}...`);
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));

console.log(`\nDone: ${ok} stored (${pages} pages), ${failed} failed, ${((Date.now() - started) / 1000).toFixed(0)}s`);
await client.close();
process.exit(0);
