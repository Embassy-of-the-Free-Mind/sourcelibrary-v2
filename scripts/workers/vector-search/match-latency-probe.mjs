// Steady /match load against the running service, to see what a background job (the reconcile, a
// save) does to query latency. Sends unfiltered k=45 queries at a fixed rate, from stored page vectors
// (float32 shards: no model calls), and prints p50/p90/p99/max per window and overall.
//
//   node match-latency-probe.mjs --seconds 240 --rps 20 [--out probe.jsonl]
//
// The local listener (127.0.0.1:3459, no auth) runs on the same event loop as the Bearer one, so a
// stall shows on both. Run it on l7a.
//
// PRIOR ART: latency-eval.mjs — end-to-end latency of real reader vectors through TLS, one query at a
// time; it measures the query, not the query while something else holds the loop. recall-eval.mjs
// reads query vectors from the shards the same way.
import fs from 'node:fs';
import path from 'node:path';
import { DIM, SHARD_DIR } from './lib.mjs';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const SECONDS = +arg('seconds', 120), RPS = +arg('rps', 20), OUT = arg('out', null), WINDOW = +arg('window', 10);
const URL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}/match`;

const shard = fs.readdirSync(SHARD_DIR).find((f) => /^shard-\d+\.f32$/.test(f));
const fh = fs.openSync(path.join(SHARD_DIR, shard), 'r');
const n = fs.fstatSync(fh).size / (DIM * 4);
const vecs = [];
for (let i = 0; i < 50; i++) {
  const b = Buffer.alloc(DIM * 4);
  fs.readSync(fh, b, 0, b.length, Math.floor(((i * 7919) % 50 / 50) * n) * DIM * 4);
  vecs.push(Array.from(new Float32Array(b.buffer, b.byteOffset, DIM)));
}

const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };
const summary = (a) => ({ n: a.length, p50: pct(a, 0.5), p90: pct(a, 0.9), p99: pct(a, 0.99), max: a.length ? +Math.max(...a).toFixed(1) : null });
const out = OUT ? fs.createWriteStream(OUT) : null;
const all = [], inflight = new Set(); let errors = 0, win = [], winStart = Date.now();
const t0 = Date.now();
for (let i = 0; Date.now() - t0 < SECONDS * 1000; i++) {
  const due = t0 + (i * 1000) / RPS;
  const wait = due - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const sent = performance.now(), at = Date.now();
  const p = fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ vector: vecs[i % vecs.length], k: 45, threshold: 0.3 }) })
    .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; })
    .then((j) => { const ms = performance.now() - sent; all.push(ms); win.push(ms); out?.write(JSON.stringify({ at, ms: +ms.toFixed(2), svc_ms: +j.ms.toFixed(2) }) + '\n'); })
    .catch((e) => { errors++; out?.write(JSON.stringify({ at, error: e.message, cause: String(e.cause?.code || e.cause?.message || "") }) + '\n'); })
    .finally(() => inflight.delete(p));
  inflight.add(p);
  if (Date.now() - winStart >= WINDOW * 1000) {
    console.log(new Date(winStart).toISOString().slice(11, 19), JSON.stringify(summary(win)));
    win = []; winStart = Date.now();
  }
}
await Promise.all(inflight);
if (win.length) console.log(new Date(winStart).toISOString().slice(11, 19), JSON.stringify(summary(win)));
console.log('overall', JSON.stringify({ ...summary(all), errors, rps: RPS, seconds: SECONDS }));
out?.end();
