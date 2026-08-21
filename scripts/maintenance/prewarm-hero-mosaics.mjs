/**
 * prewarm-hero-mosaics.mjs — generate + cache the book-page hero mosaics ahead
 * of the book-page-v2 launch, so the redesign and its background mosaics go live
 * together (no first-visitor lazy-gen wait on books people actually open).
 *
 * How it works: the mosaic cache lives in the SHARED prod `books` collection
 * (`hero_mosaic_url` / `hero_mosaic_version`). Hitting a v-current deploy's
 * `/api/books/<id>/hero-mosaic` route composites the AVIF, stores it on R2, and
 * writes the cache fields. So we just enumerate the books we want warmed and
 * fire one request each — the route does the work and is idempotent (a book
 * already at MOSAIC_VERSION returns a fast 302 and re-does nothing).
 *
 * Run it AFTER the target deploy is on the final MOSAIC_VERSION, and don't bump
 * the version afterward (that invalidates every cached mosaic).
 *
 * Usage:
 *   BASE=https://sourcelibrary.org \
 *     node --env-file=.env.production.local scripts/maintenance/prewarm-hero-mosaics.mjs
 *
 * Flags / env:
 *   BASE=<url>          deploy that serves the v-current route (default https://sourcelibrary.org)
 *   --all               warm ALL live books (default: only read_count > 0 — the "seen" set)
 *   --min-pages=<n>     skip books with fewer than n pages (default 4 — matches the route's MIN_TILES)
 *   --concurrency=<n>   parallel requests (default 8)
 *   --limit=<n>         cap the number of books (for a test run)
 *   --version=<n>       expected MOSAIC_VERSION; already-warmed books at this version are skipped (default 23)
 *   --timeout=<ms>      per-request client timeout (default 150000). Keep this ABOVE the
 *                       route's real generation time — a client abort doesn't stop the
 *                       server-side gen, it just frees the worker to fire another request,
 *                       piling abandoned-but-running gens onto the function until it stalls.
 *   --dry-run           list what would be warmed, hit nothing
 */
import { MongoClient } from 'mongodb';

const arg = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : def;
};
const flag = (name) => process.argv.includes(`--${name}`);

const BASE = (process.env.BASE || 'https://sourcelibrary.org').replace(/\/$/, '');
const SEEN_ONLY = !flag('all');
const MIN_PAGES = parseInt(arg('min-pages', '4'), 10);
const CONCURRENCY = parseInt(arg('concurrency', '8'), 10);
const LIMIT = parseInt(arg('limit', '0'), 10);
const VERSION = parseInt(arg('version', '23'), 10);
const TIMEOUT = parseInt(arg('timeout', '150000'), 10);
const DRY = flag('dry-run');

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }

const client = await MongoClient.connect(uri);
const db = client.db('bookstore');

// Live books, optionally the "seen" set, that are NOT already at the target version.
const query = {
  visible: true,
  pages_count: { $gte: MIN_PAGES },
  $or: [{ hero_mosaic_version: { $ne: VERSION } }, { hero_mosaic_version: { $exists: false } }],
};
if (SEEN_ONLY) query.read_count = { $gt: 0 };

const cursor = db.collection('books')
  .find(query, { projection: { _id: 0, id: 1, read_count: 1 } })
  .sort({ read_count: -1 }); // most-viewed first, so the important ones land soonest

let books = await cursor.toArray();
if (LIMIT > 0) books = books.slice(0, LIMIT);

console.log(`Base:        ${BASE}`);
console.log(`Scope:       ${SEEN_ONLY ? 'seen (read_count > 0)' : 'ALL live books'}, >= ${MIN_PAGES} pages, version != ${VERSION}`);
console.log(`To warm:     ${books.length} books  (concurrency ${CONCURRENCY})${DRY ? '  [DRY RUN]' : ''}`);

if (DRY || books.length === 0) { await client.close(); process.exit(0); }

let done = 0, ok = 0, fail = 0;
const started = Date.now();

async function warm(book) {
  const url = `${BASE}/api/books/${book.id}/hero-mosaic`;
  try {
    // redirect: 'manual' — the route generates + stores server-side and returns
    // a 302 to the R2 URL; we don't follow it (no need to download the AVIF).
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT) });
    if (res.status === 302 || res.status === 200 || res.status === 204) ok++;
    else { fail++; if (fail <= 20) console.warn(`  ${res.status} ${book.id}`); }
  } catch (e) {
    fail++;
    if (fail <= 20) console.warn(`  ERR ${book.id}: ${e.message}`);
  } finally {
    done++;
    if (done % 50 === 0 || done === books.length) {
      const rate = done / ((Date.now() - started) / 1000);
      const eta = Math.round((books.length - done) / Math.max(rate, 0.01));
      console.log(`  ${done}/${books.length}  ok=${ok} fail=${fail}  ${rate.toFixed(1)}/s  eta ${eta}s`);
    }
  }
}

// Simple fixed-size worker pool over the queue.
const queue = [...books];
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await warm(queue.shift());
  })
);

console.log(`\nDone. warmed=${ok} failed=${fail} of ${books.length} in ${Math.round((Date.now() - started) / 1000)}s`);
await client.close();
