// Mongo `pages` → shards/shard-<w>-<seq>.jsonl.gz: every page the Atlas page lane can match, one line per
// page ({i, b, n, t, tr, o, u}, lib.mjs pageRow). Resumable.
//   node --env-file=/root/sourcelibrary/.env.production.local pull-pages.mjs [--workers 8] [--limit-books N]
//   ... pull-pages.mjs --stdout | venv/bin/python build_index.py --stdin --pull-started-at <iso>
//
// --stdout writes the rows to stdout instead of shards (logs go to stderr) and keeps no checkpoint: the
// pipe feeds the build directly, so the box needs disk for the index only, not ~13 GB of shards beside
// it (bootstrap.sh uses it on a box where both do not fit). A failed pipe is re-run from the start.
//
// Walks the BOOKS (a list of ~154K ids), then reads each book's pages on the (book_id, page_number)
// index — never one cursor over 29M page documents. Every book is read, visible or not: the lane
// searches all of them and drops hidden books afterwards, and the service filters live books at query
// time so a book that becomes visible needs no re-pull. Pages with page_number <= 0 (hidden/deduped)
// and pages with no text are skipped, as the lane's `range page_number > 0` does.
//
// Resume: a shard is written to `.tmp` and renamed when its books are complete; only then are its book
// ids appended to shards/books-done.txt. A crash loses at most one open shard per worker, and the
// re-run deletes stray `.tmp` files and re-reads those books.
//
// Records pull_started_at in shards/pull.json. The delta (sync-delta.mjs) starts from it, minus a margin,
// so a page edited while the pull ran is re-read rather than missed.
//
// PRIOR ART: sourcelibrary-atlas scripts/local-corpus/mirror-pages.mjs — the same per-book walk, one
// uncompressed JSONL per book, single connection, no wire compression. This keeps the walk and adds
// workers, zlib on the wire (the text is the egress) and shard files (154K small files is a lot of inodes).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { SHARD_DIR, mongo, log, PAGE_PROJECTION, pageRow, writeJsonAtomic } from './lib.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const WORKERS = +arg('--workers', 8);
const LIMIT_BOOKS = +arg('--limit-books', 0);
const SHARD_PAGES = +arg('--shard-pages', 200000);
const STDOUT = process.argv.includes('--stdout');
// In --stdout mode stdout carries the rows, so the log goes to stderr.
const say = STDOUT ? (...a) => console.error(new Date().toISOString(), ...a) : log;

if (!STDOUT) {
  fs.mkdirSync(SHARD_DIR, { recursive: true });
  for (const f of fs.readdirSync(SHARD_DIR)) if (f.endsWith('.tmp')) fs.unlinkSync(path.join(SHARD_DIR, f));
}
const DONE_PATH = path.join(SHARD_DIR, 'books-done.txt');
const done = new Set(!STDOUT && fs.existsSync(DONE_PATH) ? fs.readFileSync(DONE_PATH, 'utf8').split('\n').filter(Boolean) : []);
const META_PATH = path.join(SHARD_DIR, 'pull.json');
const meta = !STDOUT && fs.existsSync(META_PATH) ? JSON.parse(fs.readFileSync(META_PATH, 'utf8')) : {};
if (!meta.pull_started_at) { meta.pull_started_at = new Date().toISOString(); if (!STDOUT) writeJsonAtomic(META_PATH, meta); }

const { client, db } = await mongo();
const books = await db.collection('books')
  .find({ $or: [{ pages_count: { $gt: 0 } }, { pages_ocr: { $gt: 0 } }, { pages_translated: { $gt: 0 } }] }, { projection: { _id: 0, id: 1, pages_count: 1 } })
  .toArray();
// Largest first, so the long books are not the tail of a parallel walk.
books.sort((a, b) => (b.pages_count || 0) - (a.pages_count || 0));
let queue = books.map((b) => b.id).filter((id) => id && !done.has(id));
if (LIMIT_BOOKS) queue = queue.slice(0, LIMIT_BOOKS);
say(`books ${books.length}, done ${done.size}, to read ${queue.length}, workers ${WORKERS}${STDOUT ? ', to stdout' : ''}`);

const doneOut = STDOUT ? null : fs.createWriteStream(DONE_PATH, { flags: 'a' });
let pagesOut = 0, bytesOut = 0, booksOut = 0; const t0 = Date.now();
const runTag = Date.now().toString(36);

async function readBook(id) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await db.collection('pages')
        .find({ book_id: id, page_number: { $gt: 0 } }, { projection: PAGE_PROJECTION })
        .sort({ page_number: 1 })
        .maxTimeMS(300000)
        .toArray();
    } catch (e) {
      if (attempt >= 5) throw e;
      say(`retry ${attempt} ${id}: ${e.constructor.name} ${String(e.message).slice(0, 100)}`);
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }
  }
}

/** --stdout: every worker writes whole books to the one pipe, waiting when the reader falls behind. */
async function stdoutWorker() {
  while (queue.length) {
    const id = queue.shift();
    const pages = await readBook(id);
    let buf = '';
    for (const p of pages) { const r = pageRow(p); if (r) { buf += JSON.stringify(r) + '\n'; pagesOut++; } }
    if (buf) { bytesOut += buf.length; if (!process.stdout.write(buf)) await once(process.stdout, 'drain'); }
    booksOut++;
    if (booksOut % 2000 === 0) say(`${booksOut}/${queue.length + booksOut} books · ${pagesOut.toLocaleString()} pages · ${(bytesOut / 1e9).toFixed(2)} GB text`);
  }
}

async function worker(w) {
  let seq = 0, gz = null, ws = null, file = null, n = 0, pending = [];
  const open = () => {
    file = path.join(SHARD_DIR, `shard-${runTag}-${w}-${seq++}.jsonl.gz`);
    gz = zlib.createGzip({ level: 4 });
    ws = fs.createWriteStream(file + '.tmp');
    gz.pipe(ws);
    n = 0; pending = [];
  };
  const close = async () => {
    if (!gz) return;
    const finished = once(ws, 'close');
    gz.end();
    await finished;
    if (n === 0) fs.unlinkSync(file + '.tmp'); else fs.renameSync(file + '.tmp', file);
    for (const id of pending) doneOut.write(id + '\n');
    gz = null;
  };
  while (queue.length) {
    const id = queue.shift();
    if (!gz) open();
    const pages = await readBook(id);
    let buf = '';
    for (const p of pages) {
      const r = pageRow(p);
      if (!r) continue;
      buf += JSON.stringify(r) + '\n'; n++; pagesOut++;
    }
    if (buf) { bytesOut += buf.length; if (!gz.write(buf)) await new Promise((r) => gz.once('drain', r)); }
    pending.push(id); booksOut++;
    if (n >= SHARD_PAGES) await close();
    if (booksOut % 2000 === 0) {
      const s = (Date.now() - t0) / 1000;
      say(`${booksOut}/${queue.length + booksOut} books · ${pagesOut.toLocaleString()} pages · ${(bytesOut / 1e9).toFixed(2)} GB text · ${(pagesOut / s).toFixed(0)} pages/s`);
    }
  }
  await close();
}

await Promise.all(Array.from({ length: WORKERS }, (_, w) => (STDOUT ? stdoutWorker() : worker(w))));
if (STDOUT) {
  await new Promise((r) => process.stdout.end(r));
  say(`done: ${booksOut} books, ${pagesOut.toLocaleString()} pages, ${(bytesOut / 1e9).toFixed(2)} GB text, pull_started_at ${meta.pull_started_at}`);
  await client.close();
  process.exit(0);
}
await new Promise((r) => doneOut.end(r));
meta.pull_finished_at = new Date().toISOString();
meta.pages = (meta.pages || 0) + pagesOut; meta.text_bytes = (meta.text_bytes || 0) + bytesOut;
if (!LIMIT_BOOKS) meta.complete = true;
writeJsonAtomic(META_PATH, meta);
log(`done: ${booksOut} books, ${pagesOut.toLocaleString()} pages, ${(bytesOut / 1e9).toFixed(2)} GB text (JSON), ${((Date.now() - t0) / 60000).toFixed(1)} min`);
await client.close();
