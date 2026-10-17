// shards/*.jsonl.gz → index/keyword.sqlite: one FTS5 table over (translation, OCR) plus the page table the
// service maps a hit back through. Streamed; tokenizing runs in worker threads, inserts in this one.
//   node build-fts.mjs [--threads 6] [--out <path>] [--no-optimize]
//
// Schema (rowid is shared by `pages` and `fts`):
//   books(idx INTEGER PRIMARY KEY, id TEXT UNIQUE)
//   pages(rowid INTEGER PRIMARY KEY, page_id TEXT UNIQUE, book INTEGER, page_number INTEGER, content INTEGER, u INTEGER)
//      content = 0 for a NON_CONTENT_PAGE_TYPES page (kept in the index, dropped at query time, as the
//      Atlas lane's `$match` drops it after `$search`); u = the later of translation/ocr updated_at (ms).
//   fts USING fts5(tr, ocr, content='', contentless_delete=1, detail=full) — contentless: the text is not
//      stored (the app hydrates it from Mongo by page id), and contentless_delete lets the delta replace a
//      page without its old text. detail=full keeps positions, which phrase queries need.
//   meta(k TEXT PRIMARY KEY, v TEXT)
//
// Writes to <out>.building and renames it into place when done, so a crash never leaves a half index where
// the server looks. Records built_at and the pull's start time (the delta's first checkpoint) in state.json.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import readline from 'node:readline';
import os from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { SHARD_DIR, INDEX_DIR, DB_PATH, STATE_PATH, SCHEMA_SQL, SCHEMA_INDEXES_SQL, NON_CONTENT_PAGE_TYPES, indexText, log, writeJsonAtomic } from './lib.mjs';

if (!isMainThread) {
  // Tokenizer thread: [rows] → [[tr, ocr]] in the same order.
  parentPort.on('message', ({ id, rows }) => {
    parentPort.postMessage({ id, out: rows.map((r) => [indexText(r.tr), indexText(r.o)]) });
  });
} else {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const THREADS = +arg('--threads', Math.max(1, Math.min(6, os.cpus().length - 2)));
  const OUT = arg('--out', DB_PATH);
  const OPTIMIZE = !process.argv.includes('--no-optimize');
  const BATCH = 2000;

  const pull = JSON.parse(fs.readFileSync(path.join(SHARD_DIR, 'pull.json'), 'utf8'));
  if (!pull.complete && !process.argv.includes('--partial')) throw new Error('pull.json says the pull is not complete (pass --partial to build anyway)');
  const shards = fs.readdirSync(SHARD_DIR).filter((f) => /^shard-.*\.jsonl\.gz$/.test(f)).sort();
  fs.mkdirSync(INDEX_DIR, { recursive: true });
  const tmp = OUT + '.building';
  for (const f of [tmp, tmp + '-wal', tmp + '-shm', tmp + '-journal']) if (fs.existsSync(f)) fs.unlinkSync(f);

  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(tmp);
  db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA cache_size = -1048576; PRAGMA temp_store = FILE;');
  db.exec(SCHEMA_SQL);
  // Fewer, larger segments while bulk loading; 'optimize' at the end merges them into one.
  db.exec("INSERT INTO fts(fts, rank) VALUES('automerge', 8); INSERT INTO fts(fts, rank) VALUES('crisismerge', 64);");
  const insBook = db.prepare('INSERT INTO books(idx, id) VALUES(?, ?)');
  const insPage = db.prepare('INSERT INTO pages(rowid, page_id, book, page_number, content, u) VALUES(?, ?, ?, ?, ?, ?)');
  const insFts = db.prepare('INSERT INTO fts(rowid, tr, ocr) VALUES(?, ?, ?)');
  const bookIdx = new Map();
  const nonContent = new Set(NON_CONTENT_PAGE_TYPES);
  const seenPage = new Set();

  const workers = Array.from({ length: THREADS }, () => new Worker(fileURLToPath(import.meta.url)));
  const waiting = new Map(); let nextId = 0;
  for (const w of workers) w.on('message', ({ id, out }) => { const r = waiting.get(id); waiting.delete(id); r(out); });
  const tokenizeBatch = (w, rows) => new Promise((resolve) => { const id = nextId++; waiting.set(id, resolve); w.postMessage({ id, rows }); });

  let rowid = 0, pages = 0, dupes = 0, textBytes = 0; const t0 = Date.now();
  const insertBatch = (rows, toks) => {
    db.exec('BEGIN');
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (seenPage.has(r.i)) { dupes++; continue; } // a page re-read on resume
      seenPage.add(r.i);
      let b = bookIdx.get(r.b);
      if (b === undefined) { b = bookIdx.size; bookIdx.set(r.b, b); insBook.run(b, r.b); }
      rowid++;
      insPage.run(rowid, r.i, b, r.n, nonContent.has(r.t) ? 0 : 1, r.u || 0);
      insFts.run(rowid, toks[i][0], toks[i][1]);
      pages++; textBytes += r.tr.length + r.o.length;
    }
    db.exec('COMMIT');
  };

  // Keep THREADS batches in flight; insert them in read order so rowids follow the shards (book-contiguous).
  const inflight = [];
  let rr = 0;
  const flushOne = async () => { const { rows, p } = inflight.shift(); insertBatch(rows, await p); };
  for (const f of shards) {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(SHARD_DIR, f)).pipe(zlib.createGunzip()), crlfDelay: Infinity });
    let batch = [];
    for await (const line of rl) {
      if (!line) continue;
      batch.push(JSON.parse(line));
      if (batch.length >= BATCH) {
        inflight.push({ rows: batch, p: tokenizeBatch(workers[rr++ % THREADS], batch) }); batch = [];
        if (inflight.length >= THREADS * 2) await flushOne();
      }
    }
    if (batch.length) inflight.push({ rows: batch, p: tokenizeBatch(workers[rr++ % THREADS], batch) });
    const s = (Date.now() - t0) / 1000;
    log(`${f}: ${pages.toLocaleString()} pages · ${(textBytes / 1e9).toFixed(2)} GB chars · ${(pages / s).toFixed(0)} pages/s`);
  }
  while (inflight.length) await flushOne();
  for (const w of workers) await w.terminate();

  log(`loaded ${pages.toLocaleString()} pages (${dupes} duplicates skipped) in ${((Date.now() - t0) / 60000).toFixed(1)} min; indexing page_id`);
  db.exec(SCHEMA_INDEXES_SQL);
  if (OPTIMIZE) {
    const t1 = Date.now();
    db.exec("INSERT INTO fts(fts) VALUES('optimize')");
    log(`optimize ${((Date.now() - t1) / 60000).toFixed(1)} min`);
  }
  // Back to normal operation for the server and the delta: WAL, small automerge steps.
  db.exec("INSERT INTO fts(fts, rank) VALUES('automerge', 4); INSERT INTO fts(fts, rank) VALUES('crisismerge', 16);");
  const builtAt = new Date().toISOString();
  const metaIns = db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)');
  metaIns.run('built_at', builtAt); metaIns.run('pull_started_at', pull.pull_started_at); metaIns.run('pages', String(pages));
  db.exec('PRAGMA journal_mode = WAL;');
  db.close();
  fs.renameSync(tmp, OUT);
  const size = fs.statSync(OUT).size;
  // The delta's first checkpoint is the pull's start, so a page edited during the pull is read again.
  writeJsonAtomic(STATE_PATH, { built_at: builtAt, pages, books: bookIdx.size, text_chars: textBytes, db_bytes: size, pull_started_at: pull.pull_started_at, checkpoint: { u: pull.pull_started_at } });
  log(`done: ${OUT} ${(size / 1e9).toFixed(2)} GB, ${pages.toLocaleString()} pages, ${bookIdx.size} books, ${((Date.now() - t0) / 60000).toFixed(1)} min total`);
}
