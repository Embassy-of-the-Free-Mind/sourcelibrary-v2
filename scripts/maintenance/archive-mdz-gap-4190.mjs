#!/usr/bin/env node
/**
 * Archive the MDZ-sourced page images that are still served from the provider.
 *
 * WHY
 * ---
 * 99.56% of live page images are held on R2 and served from R2. The remainder
 * is 24,488 pages, and once you subtract what CANNOT be archived it is one
 * tractable set:
 *
 *   iiif (MDZ / api.digitale-sammlungen.de)  64 books  16,434 pages  ← this script
 *   etcsl (text-only, no page images)       373 books   5,759 pages  nothing to fetch
 *   already archive_failed                    ~         953 pages    dead sources
 *   gallica / e-rara (MAC_ONLY_PROVIDERS)    15 books   1,084 pages  need the Mac worker
 *   no source url at all                       6 books     379 pages  nothing to fetch
 *
 * The MDZ set is fetchable from our own infrastructure (`digitale-sammlungen.de`
 * is in the route's ARCHIVABLE_SOURCES_REGEX and is not a Mac-only provider) and
 * carries ZERO archive_failed pages, so nothing here is a known-dead source.
 *
 * WHY A DRIVER RATHER THAN ONE CALL
 * ---------------------------------
 * `/api/books/<id>/archive-images` takes a `limit` and routinely returns a
 * Cloudflare 524 — the edge times out at ~100s while the function keeps working
 * to its 300s maxDuration. Its own source comments say so. **So the HTTP
 * response is not the measurement.** This driver re-counts unarchived pages in
 * Mongo after every call and drives from that, which also means a 524 is
 * correctly read as "probably progressed" rather than "failed".
 *
 * Checkpointed per book (corpus-walk rule): an interruption costs one book.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/archive-mdz-gap-4190.mjs
 *   node --env-file=.env.production.local scripts/maintenance/archive-mdz-gap-4190.mjs --apply
 *   … --limit=200            pages per API call (default 100)
 *   … --max-books=5          stop after N books (for a cautious first run)
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const num = (n, d) => { const m = ARGS.find(a => a.startsWith(`--${n}=`)); return m ? Number(m.split('=')[1]) : d; };
const LIMIT = num('limit', 100);
const MAX_BOOKS = num('max-books', 0);
const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;
const R2 = /images\.sourcelibrary\.org/;
const SOURCE = /digitale-sammlungen\.de/;
const OUT_DIR = 'scripts/output';
const CHECKPOINT = path.join(OUT_DIR, 'archive-mdz-gap.checkpoint');

if (APPLY && !CRON_SECRET) { console.error('CRON_SECRET missing — cannot call the archive route.'); process.exit(1); }
fs.mkdirSync(OUT_DIR, { recursive: true });

const client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 0, retryReads: true });
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

/** Pages of this book with no R2 object and a fetchable MDZ source. */
const unarchivedCount = (bookId) => pages.countDocuments({
  book_id: bookId,
  page_number: { $gte: 0 },
  archived_photo: { $not: R2 },
  photo: { $regex: SOURCE.source },
}, { maxTimeMS: 60000 });

const live = await books.find(
  { visible: true, pages_count: { $gt: 0 }, 'image_source.provider': 'iiif' },
  { projection: { _id: 1, title: 1, pages_count: 1 }, maxTimeMS: 300000 },
).toArray();

const done = new Set(fs.existsSync(CHECKPOINT) ? fs.readFileSync(CHECKPOINT, 'utf8').split('\n').filter(Boolean) : []);
console.log(`iiif-provider live books: ${live.length}${done.size ? `  (${done.size} already checkpointed)` : ''}`);

const targets = [];
for (const b of live) {
  const id = b._id.toString();
  if (done.has(id)) continue;
  const n = await unarchivedCount(id);
  if (n > 0) targets.push({ id, title: b.title, pages_count: b.pages_count, missing: n });
}
targets.sort((a, b) => b.missing - a.missing);
const totalMissing = targets.reduce((a, t) => a + t.missing, 0);
console.log(`books needing MDZ archiving: ${targets.length}   pages: ${totalMissing.toLocaleString()}\n`);
for (const t of targets.slice(0, 10)) console.log(`  ${String(t.missing).padStart(5)}p  ${String(t.title).slice(0, 58)}`);
if (targets.length > 10) console.log(`  … and ${targets.length - 10} more`);

if (!APPLY) {
  console.log('\nDRY RUN — pass --apply to archive. Nothing fetched, nothing written.');
  await client.close();
  process.exit(0);
}

let booksDone = 0, pagesArchived = 0;
for (const t of targets) {
  if (MAX_BOOKS && booksDone >= MAX_BOOKS) break;
  let before = t.missing;
  let stagnant = 0;

  while (before > 0) {
    // A 524 here means the edge gave up, not that the work did. The DB decides.
    const res = await fetch(`${BASE_URL}/api/books/${t.id}/archive-images`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ limit: LIMIT }),
      signal: AbortSignal.timeout(290000),
    }).catch(e => ({ ok: false, status: 0, _err: e.message?.slice(0, 60) }));

    const after = await unarchivedCount(t.id);
    const moved = before - after;
    pagesArchived += Math.max(0, moved);
    console.log(`  ${t.title?.slice(0, 40).padEnd(42)} http=${res.status ?? '?'}  ${before} -> ${after}  (+${moved})`);

    if (moved <= 0) {
      if (++stagnant >= 2) { console.log(`    no progress twice — leaving ${after} pages for a look`); break; }
    } else stagnant = 0;
    before = after;
  }

  fs.appendFileSync(CHECKPOINT, `${t.id}\n`);
  booksDone++;
}

console.log(`\nbooks processed: ${booksDone}   pages archived: ${pagesArchived.toLocaleString()}`);
console.log(`checkpoint: ${CHECKPOINT}`);
await client.close();
