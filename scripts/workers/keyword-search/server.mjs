// Keyword page service (#6852). HTTP in front of engine.mjs, on a pool of worker threads (each with its own
// read-only SQLite connection), and one writer connection in this thread for the delta.
//
//   public  KEYWORD_SEARCH_HOST:KEYWORD_SEARCH_PORT (default 127.0.0.1:3460) — Bearer KEYWORD_SEARCH_TOKEN on
//           every route. POST /lane, GET /health. Bound to localhost until the TLS proxy (#6843) fronts it.
//   local   127.0.0.1:KEYWORD_SEARCH_LOCAL_PORT (default 3461) — no auth; also /admin/apply, /admin/live,
//           /admin/checkpoint, used by sync-delta.mjs.
//
// PRIOR ART: scripts/workers/vector-search/server.mjs — same two-listener layout, token check and admin
// routes. That service is one in-RAM index answered on the main thread in milliseconds; a BM25 query over
// a common word reads a long posting list synchronously (node:sqlite has no async API), so here queries run
// on worker threads and one slow query does not hold the others.
import http from 'node:http';
import os from 'node:os';
import crypto from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { DB_PATH, readState, writeJsonAtomic, STATE_PATH, NON_CONTENT_PAGE_TYPES, indexText, log } from './lib.mjs';
import { Engine } from './engine.mjs';

const MAX_BODY = 1 << 20;

if (!isMainThread) {
  // ----- query worker ------------------------------------------------------------------------------
  const engine = new Engine(workerData.dbPath, { readonly: true });
  parentPort.postMessage({ ready: true, pages: engine.maxRow });
  parentPort.on('message', (m) => {
    if (m.op === 'lane') {
      try { parentPort.postMessage({ id: m.id, ok: true, result: engine.lane(m.params) }); }
      catch (e) { parentPort.postMessage({ id: m.id, ok: false, error: String(e.message || e).slice(0, 300) }); }
    } else if (m.op === 'rows') {
      for (const [r, b, c] of m.rows) engine.setRow(r, b, c);
    } else if (m.op === 'book') {
      engine.addBook(m.idx, m.bookId);
    } else if (m.op === 'live') {
      engine.setLive(m.ids);
    }
  });
} else {
  // ----- main thread -------------------------------------------------------------------------------
  const PORT = +(process.env.KEYWORD_SEARCH_PORT || 3460);
  const HOST = process.env.KEYWORD_SEARCH_HOST || '127.0.0.1';
  const LOCAL_PORT = +(process.env.KEYWORD_SEARCH_LOCAL_PORT || 3461);
  const TOKEN = process.env.KEYWORD_SEARCH_TOKEN || '';
  const THREADS = +(process.env.KEYWORD_SEARCH_THREADS || Math.max(2, Math.min(4, os.cpus().length - 1)));
  const dbPath = process.env.KEYWORD_SEARCH_DB || DB_PATH;
  if (!TOKEN && HOST !== '127.0.0.1') { console.error('KEYWORD_SEARCH_TOKEN is required on a public listener'); process.exit(2); }

  const writer = new Engine(dbPath, { readonly: false });
  const nonContent = new Set(NON_CONTENT_PAGE_TYPES);
  const stmt = {
    byPage: writer.db.prepare('SELECT rowid AS r, book AS b FROM pages WHERE page_id = ?'),
    insBook: writer.db.prepare('INSERT INTO books(idx, id) VALUES(?, ?)'),
    upPage: writer.db.prepare('INSERT OR REPLACE INTO pages(rowid, page_id, book, page_number, content, u) VALUES(?, ?, ?, ?, ?, ?)'),
    delPage: writer.db.prepare('DELETE FROM pages WHERE rowid = ?'),
    delFts: writer.db.prepare('DELETE FROM fts WHERE rowid = ?'),
    insFts: writer.db.prepare('INSERT INTO fts(rowid, tr, ocr) VALUES(?, ?, ?)'),
    meta: writer.db.prepare('INSERT OR REPLACE INTO meta(k, v) VALUES(?, ?)'),
    getMeta: writer.db.prepare('SELECT v FROM meta WHERE k = ?'),
  };
  const state = readState() || {};
  let lastDeltaAt = stmt.getMeta.get('last_delta_at')?.v || null;
  let checkpoint = JSON.parse(stmt.getMeta.get('checkpoint')?.v || 'null') || state.checkpoint || null;

  // Worker pool: an idle worker takes the next request; requests queue when all are busy.
  const workers = []; const queue = []; let nextId = 0; const pending = new Map();
  const stats = { served: 0, errors: 0, queued_max: 0 };
  function spawn(i) {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: { dbPath } });
    const slot = { w, busy: false, ready: false, i };
    w.on('message', (m) => {
      if (m.ready) { slot.ready = true; log(`worker ${i} ready`); pump(); return; }
      const p = pending.get(m.id); if (!p) return;
      pending.delete(m.id); slot.busy = false;
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error));
      pump();
    });
    w.on('error', (e) => log(`worker ${i} error: ${e.message}`));
    w.on('exit', (code) => {
      log(`worker ${i} exited ${code}; respawning`);
      for (const [id, p] of pending) if (p.slot === slot) { pending.delete(id); p.reject(new Error('worker exited')); }
      workers[i] = spawn(i);
    });
    return slot;
  }
  for (let i = 0; i < THREADS; i++) workers.push(spawn(i));
  function pump() {
    while (queue.length) {
      const slot = workers.find((s) => s.ready && !s.busy);
      if (!slot) return;
      const job = queue.shift();
      slot.busy = true; job.slot = slot; pending.set(job.id, job);
      slot.w.postMessage({ id: job.id, op: 'lane', params: job.params });
    }
  }
  const runLane = (params) => new Promise((resolve, reject) => {
    queue.push({ id: nextId++, params, resolve, reject });
    stats.queued_max = Math.max(stats.queued_max, queue.length);
    pump();
  });
  const broadcast = (m) => { for (const s of workers) s.w.postMessage(m); };

  // ----- writes (delta) ----------------------------------------------------------------------------
  function bookIndexFor(id) {
    let b = writer.bookIdx.get(id);
    if (b !== undefined) return b;
    b = writer.books.length;
    stmt.insBook.run(b, id); writer.addBook(b, id); broadcast({ op: 'book', idx: b, bookId: id });
    return b;
  }
  /** upserts: pageRow()s (lib.mjs); removes: page ids. One transaction. */
  function apply({ upserts = [], removes = [] }) {
    const res = { added: 0, replaced: 0, removed: 0 }; const rows = [];
    writer.db.exec('BEGIN IMMEDIATE');
    try {
      for (const id of removes) {
        const cur = stmt.byPage.get(id);
        if (!cur) continue;
        const r = Number(cur.r);
        stmt.delFts.run(r); stmt.delPage.run(r); writer.setRow(r, cur.b, 0); rows.push([r, cur.b, 0]); res.removed++;
      }
      for (const p of upserts) {
        const cur = stmt.byPage.get(p.i);
        const b = bookIndexFor(p.b);
        let r;
        if (cur) { r = Number(cur.r); stmt.delFts.run(r); res.replaced++; }
        else { r = writer.maxRow + 1; res.added++; }
        const c = nonContent.has(p.t) ? 0 : 1;
        stmt.upPage.run(r, p.i, b, p.n, c, p.u || 0);
        stmt.insFts.run(r, indexText(p.tr), indexText(p.o));
        writer.setRow(r, b, c); rows.push([r, b, c]);
      }
      writer.db.exec('COMMIT');
    } catch (e) { writer.db.exec('ROLLBACK'); throw e; }
    if (rows.length) broadcast({ op: 'rows', rows });
    return res;
  }
  function setLive(ids) {
    writer.db.exec('BEGIN IMMEDIATE');
    try {
      writer.db.exec('DELETE FROM live_books');
      const ins = writer.db.prepare('INSERT OR IGNORE INTO live_books(id) VALUES(?)');
      for (const id of ids) ins.run(id);
      writer.db.exec('COMMIT');
    } catch (e) { writer.db.exec('ROLLBACK'); throw e; }
    writer.setLive(ids); broadcast({ op: 'live', ids });
    return { live_books: writer.liveCount, posted: ids.length };
  }

  // ----- HTTP --------------------------------------------------------------------------------------
  const readBody = (req) => new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY * 64) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
  const send = (res, code, obj) => { const s = JSON.stringify(obj); res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) }); res.end(s); };
  const tokenOk = (req) => {
    const h = req.headers.authorization || '';
    const got = Buffer.from(h.startsWith('Bearer ') ? h.slice(7) : '');
    const want = Buffer.from(TOKEN);
    return TOKEN && got.length === want.length && crypto.timingSafeEqual(got, want);
  };
  const health = () => ({
    ok: workers.every((s) => s.ready), pages_max_rowid: writer.maxRow, books: writer.books.length,
    live_books: writer.liveCount, built_at: state.built_at || null, checkpoint, last_delta_at: lastDeltaAt,
    threads: THREADS, busy: workers.filter((s) => s.busy).length, queued: queue.length, ...stats,
  });

  async function route(req, res, local) {
    const url = new URL(req.url, 'http://x');
    if (!local && !tokenOk(req)) return send(res, 401, { error: 'unauthorized' });
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, health());
    if (req.method !== 'POST') return send(res, 404, { error: 'not found' });
    const raw = await readBody(req);
    if (!local && raw.length > MAX_BODY) return send(res, 413, { error: 'body too large' });
    let body; try { body = JSON.parse(raw || '{}'); } catch { return send(res, 400, { error: 'bad json' }); }
    if (url.pathname === '/lane') {
      if (typeof body.query !== 'string' || body.query.trim().length < 2) return send(res, 400, { error: 'query must be a string of 2+ characters' });
      if (body.book_ids != null && !Array.isArray(body.book_ids)) return send(res, 400, { error: 'book_ids must be an array' });
      const t0 = performance.now();
      try {
        const r = await runLane(body);
        stats.served++;
        return send(res, 200, { ...r, server_ms: +(performance.now() - t0).toFixed(1) });
      } catch (e) { stats.errors++; return send(res, 500, { error: e.message }); }
    }
    if (!local) return send(res, 404, { error: 'not found' });
    if (url.pathname === '/admin/apply') return send(res, 200, apply(body));
    if (url.pathname === '/admin/live') {
      if (!Array.isArray(body.book_ids) || body.book_ids.length < 1000) return send(res, 400, { error: 'refusing a live set under 1,000 books (a failed read must not empty the index)' });
      return send(res, 200, setLive(body.book_ids));
    }
    if (url.pathname === '/admin/checkpoint') {
      checkpoint = body.checkpoint; lastDeltaAt = new Date().toISOString();
      stmt.meta.run('checkpoint', JSON.stringify(checkpoint)); stmt.meta.run('last_delta_at', lastDeltaAt);
      writeJsonAtomic(STATE_PATH, { ...state, checkpoint, last_delta_at: lastDeltaAt });
      return send(res, 200, { checkpoint, last_delta_at: lastDeltaAt });
    }
    return send(res, 404, { error: 'not found' });
  }
  const handler = (local) => (req, res) => route(req, res, local).catch((e) => { try { send(res, 500, { error: e.message }); } catch {} });
  http.createServer(handler(false)).listen(PORT, HOST, () => log(`keyword-search on ${HOST}:${PORT} (token ${TOKEN ? 'on' : 'OFF'}), ${THREADS} threads, db ${dbPath}`));
  http.createServer(handler(true)).listen(LOCAL_PORT, '127.0.0.1', () => log(`admin on 127.0.0.1:${LOCAL_PORT}`));
}
