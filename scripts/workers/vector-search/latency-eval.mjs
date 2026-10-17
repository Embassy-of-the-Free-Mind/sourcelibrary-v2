// End to end, as the app sees it: the service over HTTPS with its own text (`with_text`, phase 4) against
// match_semantic over PostgREST, and the phase-3 serve path (service ids + Supabase hydration) between them.
// Also checks that every column the service returns equals the RPC's for the same page.
//
//   VECTOR_SEARCH_URL=https://vectors.sourcelibrary.org VECTOR_SEARCH_TOKEN=… \
//   node --env-file=/root/sourcelibrary/.env.production.local latency-eval.mjs --queries qvecs.json [--n 50] [--k 45] [--out f.json]
//
// --queries: a JSON object {query text: [768 floats]} of real query vectors (no Gemini call is made here).
// Per query, in this order (hydration before the RPC, so the RPC's heap reads do not warm the hydration):
//   svc_text_warm   POST /match with_text on a kept-alive TLS connection (a warm Vercel function)
//   svc_text_cold   the same on a NEW connection: TCP + TLS handshake included (a cold function)
//   svc_ids_hydrate POST /match without text, then PostgREST select … in(page_id) — the phase-3 serve path
//   rpc             PostgREST rpc/match_semantic with the same vector, k and threshold (the anon key, as the app)
// Run it from Hetzner main for fra1-like numbers; from l7a the service legs are loopback through Caddy.
//
// PRIOR ART: recall-eval.mjs (same directory) — server-side latency and overlap against brute force, no
// network, no text. This one is the network + text half; it reuses nothing of that file but the idea.
import fs from 'node:fs';
import https from 'node:https';
import http from 'node:http';
import zlib from 'node:zlib';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = +arg('--n', 50), K = +arg('--k', 45), OUT = arg('--out', null);
const QFILE = arg('--queries');
const URL_ = process.env.VECTOR_SEARCH_URL, TOKEN = process.env.VECTOR_SEARCH_TOKEN;
const SB = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY;
if (!QFILE || !URL_ || !TOKEN || !SB || !ANON) { console.error('need --queries, VECTOR_SEARCH_URL, VECTOR_SEARCH_TOKEN, SUPABASE_URL, SUPABASE_ANON_KEY'); process.exit(2); }

// Deterministic sample: the first N queries in key order after a seeded shuffle.
const all = Object.entries(JSON.parse(fs.readFileSync(QFILE, 'utf8'))).filter(([, v]) => Array.isArray(v) && v.length === 768);
let seed = 6843; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const queries = all.slice(0, N);

const u = new URL(URL_);
const lib = u.protocol === 'https:' ? https : http;
const warmAgent = new lib.Agent({ keepAlive: true, maxSockets: 1 });

/** POST /match; agent false = a fresh TCP + TLS connection. Returns {ms, body, bytes}. */
function svc(vector, withText, agent) {
  const payload = JSON.stringify({ vector, k: K, threshold: 0.3, ...(withText ? { with_text: true } : {}) });
  return new Promise((resolve, reject) => {
    const t = performance.now();
    const req = lib.request({
      host: u.hostname, port: u.port || (u.protocol === 'https:' ? 443 : 80), path: '/match', method: 'POST', agent,
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', 'accept-encoding': 'gzip', 'content-length': Buffer.byteLength(payload) },
    }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const buf = res.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(raw) : raw;
        if (res.statusCode !== 200) return reject(new Error(`svc HTTP ${res.statusCode} ${buf.toString().slice(0, 100)}`));
        resolve({ ms: performance.now() - t, body: JSON.parse(buf), wire_bytes: raw.length });
      });
    });
    req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('svc timeout')));
    req.end(payload);
  });
}

const sbHeaders = { apikey: ANON, authorization: `Bearer ${ANON}`, 'content-type': 'application/json' };
async function rpc(vector) {
  const t = performance.now();
  const r = await fetch(`${SB}/rest/v1/rpc/match_semantic`, {
    method: 'POST', headers: sbHeaders,
    body: JSON.stringify({ query_embedding: JSON.stringify(vector), match_threshold: 0.3, match_count: K, filter_tenant_id: null,
      filter_language: null, filter_year_min: null, filter_year_max: null, filter_languages: null, filter_exclude_languages: null }),
  });
  if (!r.ok) throw new Error(`rpc HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const rows = await r.json();
  return { ms: performance.now() - t, rows };
}
const HYDRATE = 'page_id,book_id,page_number,translation,book_title,book_author,book_language,book_year';
async function hydrate(ids) {
  const t = performance.now();
  const r = await fetch(`${SB}/rest/v1/page_translations?select=${HYDRATE}&page_id=in.(${ids.join(',')})`, { headers: sbHeaders });
  if (!r.ok) throw new Error(`hydrate HTTP ${r.status}`);
  const rows = await r.json();
  return { ms: performance.now() - t, rows };
}

const COLS = ['book_id', 'page_number', 'translation', 'book_title', 'book_author', 'book_language', 'book_year'];
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1); };

await svc(queries[0][1], true, warmAgent); // open the kept-alive connection
const t = { svc_text_warm: [], svc_text_cold: [], svc_ids_hydrate: [], hydrate_only: [], rpc: [] };
const server = { text_ms: [], ms: [] };
const cmp = { rows_compared: 0, mismatches: {}, examples: [], svc_text_missing: 0, overlap: [] };
let wire = 0;
for (const [i, [qtext, v]] of queries.entries()) {
  const w = await svc(v, true, warmAgent); t.svc_text_warm.push(w.ms); wire += w.wire_bytes;
  server.text_ms.push(w.body.text_ms ?? 0); server.ms.push(w.body.ms);
  const c = await svc(v, true, false); t.svc_text_cold.push(c.ms);
  const ids = await svc(v, false, warmAgent);
  const h = await hydrate(ids.body.rows.map((r) => r.page_id));
  t.svc_ids_hydrate.push(ids.ms + h.ms); t.hydrate_only.push(h.ms);
  const r = await rpc(v); t.rpc.push(r.ms);
  cmp.svc_text_missing += w.body.text_missing ?? 0;
  const byId = new Map(r.rows.map((x) => [x.page_id, x]));
  let common = 0;
  for (const s of w.body.rows) {
    const x = byId.get(s.page_id); if (!x) continue; common++;
    cmp.rows_compared++;
    for (const col of COLS) {
      if (s[col] === x[col]) continue;
      cmp.mismatches[col] = (cmp.mismatches[col] || 0) + 1;
      if (cmp.examples.length < 10) cmp.examples.push({ page_id: s.page_id, col, svc: String(s[col]).slice(0, 80), rpc: String(x[col]).slice(0, 80) });
    }
  }
  cmp.overlap.push(common / Math.max(1, Math.max(w.body.rows.length, r.rows.length)));
  if (i % 10 === 9) console.error(`${i + 1}/${queries.length} · rpc ${pct(t.rpc, 0.5)} ms p50 · svc+text warm ${pct(t.svc_text_warm, 0.5)} ms p50`);
}

const table = Object.fromEntries(Object.entries(t).map(([k, a]) => [k, { p50: pct(a, 0.5), p90: pct(a, 0.9), mean: +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) }]));
const out = {
  at: new Date().toISOString(), from: (await import('node:os')).hostname(), url: URL_, n: queries.length, k: K,
  latency_ms: table,
  server_ms: { search_p50: pct(server.ms, 0.5), search_p90: pct(server.ms, 0.9), text_p50: pct(server.text_ms, 0.5), text_p90: pct(server.text_ms, 0.9) },
  wire_kb_per_text_response: +(wire / queries.length / 1024).toFixed(1),
  columns: { ...cmp, overlap_at_k_mean: +(cmp.overlap.reduce((a, b) => a + b, 0) / cmp.overlap.length).toFixed(3), overlap: undefined },
};
console.log(JSON.stringify(out, null, 2));
if (OUT) fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
warmAgent.destroy();
