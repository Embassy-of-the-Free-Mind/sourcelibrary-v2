#!/usr/bin/env node
// PRIOR ART: build-manifests.mjs (this directory: the 100K pilot sample — same live filter, same getPageSource, same
// "has an archived master" rule — but it samples 5 pages per book and writes one file). This walks EVERY page of every
// book and cuts the result into fixed-size chunk manifests, one GPU-queue task each (#6871 row 8, full run).
/**
 * build-full-manifest — the inputs of the full SigLIP2-so400m page run on gex45 (#6871 row 8, Derek 2026-10-21/26).
 *   chunk-NNN.jsonl         live books (visible, pages_count > 0), CHUNK rows each: {id, book_id, page_number, src} —
 *                           every page with a usable archived master (archived_photo), embedded from the same image the
 *                           pilot used (getPageSource), on images.sourcelibrary.org only (the R2 bucket; embed-shards.py
 *                           reads it straight from R2). Books in id order, pages in page order.
 *   hidden-chunk-NNN.jsonl  the same for hidden books with pages. siglip2-requeue.sh only queues chunk-*.jsonl, so the
 *                           hidden series runs only once someone renames it into the chunk-NNN series (#6871: its own
 *                           spend decision).
 *   summary.json      counts: books, pages walked, rows, skipped by reason, chunks
 * Never re-cut chunks under a running queue: a chunk's shard checkpoints only mean something for the same rows.
 * Read-only. node --env-file=/root/sourcelibrary/.env.production.local build-full-manifest.mjs --out DIR [--chunk 1500000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource, isUsableImageUrl } from '../../lib/page-image-url.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out'); const CHUNK = Number(arg('--chunk', 1_500_000)); const CONC = Number(arg('--conc', 16));
if (!OUT) { console.error('usage: build-full-manifest.mjs --out DIR [--chunk N]'); process.exit(2); }
if (fs.existsSync(path.join(OUT, 'chunk-000.jsonl'))) { console.error(`${OUT} already has chunks: use a new --out`); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const HOST = 'images.sourcelibrary.org';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, enhanced_photo: 1, split_from_spread: 1 };

const books = await db.collection('books').find({ pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, visible: 1 } }).sort({ id: 1 }).toArray();
const order = [...books.filter((b) => b.id && b.visible === true), ...books.filter((b) => b.id && b.visible !== true)];
const nLive = order.filter((b) => b.visible === true).length;

let rows = 0, walked = 0;
const skip = { no_master: 0, no_source: 0, other_host: 0, no_id: 0, dup: 0 };
// one Set per last id character: a single V8 Set stops at ~16.7M entries (RangeError), and the run has more pages than that
const seenBy = new Map(); const seenSet = (id) => { const k = id.slice(-1); if (!seenBy.has(k)) seenBy.set(k, new Set()); return seenBy.get(k); };
const series = { live: { prefix: 'chunk', fd: null, n: -1, inChunk: CHUNK, rows: 0 }, hidden: { prefix: 'hidden-chunk', fd: null, n: -1, inChunk: CHUNK, rows: 0 } };
const emit = (sr, r) => {
  if (sr.inChunk >= CHUNK) {
    if (sr.fd !== null) fs.closeSync(sr.fd);
    sr.n++; sr.inChunk = 0; sr.fd = fs.openSync(path.join(OUT, `${sr.prefix}-${String(sr.n).padStart(3, '0')}.jsonl`), 'w');
  }
  fs.writeSync(sr.fd, JSON.stringify(r) + '\n'); sr.inChunk++; sr.rows++; rows++;
};
const t0 = Date.now();
for (let i = 0; i < order.length; i += CONC) {
  const part = order.slice(i, i + CONC);
  const got = await Promise.all(part.map((b) => db.collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray()));
  got.forEach((ps, j) => {
    for (const p of ps) {
      walked++;
      if (!p.id) { skip.no_id++; continue; }
      if (!isUsableImageUrl(p.archived_photo)) { skip.no_master++; continue; }
      const src = getPageSource(p); if (!src) { skip.no_source++; continue; }
      let u; try { u = new URL(src.trim()); } catch { skip.other_host++; continue; }
      if (u.host !== HOST) { skip.other_host++; continue; }
      if (seenSet(p.id).has(p.id)) { skip.dup++; continue; }   // a page id once only (a page listed under two books)
      seenSet(p.id).add(p.id);
      emit(part[j].visible === true ? series.live : series.hidden, { id: p.id, book_id: p.book_id, page_number: p.page_number, src: u.href });
    }
  });
  if ((i / CONC) % 200 === 0) console.log(`${new Date().toISOString()} books ${i + part.length}/${order.length} pages ${walked} rows ${rows} (live ${series.live.rows}) ${Math.round((Date.now() - t0) / 1000)}s`);
}
for (const sr of Object.values(series)) if (sr.fd !== null) fs.closeSync(sr.fd);
const summary = { built: new Date().toISOString(), books: order.length, live_books: nLive, pages_walked: walked, rows,
  live_rows: series.live.rows, hidden_rows: series.hidden.rows, skipped: skip, chunk_rows: CHUNK,
  live_chunks: series.live.n + 1, hidden_chunks: series.hidden.n + 1 };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));
console.log(JSON.stringify(summary));
await c.close();
