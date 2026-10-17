#!/usr/bin/env node
/**
 * MCP latency probe (#6853): wall-clock ms for `initialize`, `tools/list`,
 * `search_library` and `search_concept` against one MCP endpoint.
 *
 * PRIOR ART: scripts/audit/mcp-directory-contract.mjs — checks the handshake's
 *   shape and version against server.json, never its timing; tests/smoke/mcp-search.test.ts
 *   asserts non-emptiness of /api/search, not of the MCP route. Neither times a call.
 *
 * The FIRST round is the cold one only if the endpoint has been idle for more
 * than ~15 minutes, or is a fresh deploy: say which when you quote it.
 * Repeat rounds are warm; search arguments are fixed, so rounds 2+ also measure
 * the repeat-query path (edge cache before #6853, in-process LRU after).
 *
 *   node scripts/eval/mcp-latency-probe.mjs [--base https://sourcelibrary.org] [--rounds 5] [--fresh]
 *     [--calls initialize,tools/list,search_library,search_concept]
 *
 * Cold without a build: an older production deployment's own URL
 * (sourcelibrary-v2-<hash>-dereklomas-projects.vercel.app, see `vercel ls`) goes
 * idle the moment the next deploy replaces it. Point --base at one per cold
 * reading, and lead --calls with the call you want cold. Before #6853 its tools
 * still called https://sourcelibrary.org (warm), so that reading isolates the
 * MCP function's own cold start.
 *
 * --fresh appends a per-run nonce to the search queries so no cache can answer.
 * A Vercel preview behind deployment protection needs VERCEL_AUTOMATION_BYPASS_SECRET
 * in the environment; it is sent as x-vercel-protection-bypass.
 */

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const BASE = opt('base', 'https://sourcelibrary.org').replace(/\/$/, '');
const ROUNDS = Number(opt('rounds', 5));
const FRESH = argv.includes('--fresh');
const nonce = FRESH ? ` ${Date.now().toString(36)}` : '';

const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/json, text/event-stream',
  'User-Agent': 'sl-mcp-latency-probe/1 (#6853)',
};
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers['x-vercel-protection-bypass'] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

let id = 0;
async function rpc(method, params) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, ...(params ? { params } : {}) }),
  });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let ok = res.ok;
  let error = null;
  try {
    const line = text.split('\n').find((l) => l.startsWith('data: '));
    const body = JSON.parse(line ? line.slice(6) : text);
    if (body.error || body.result?.isError) {
      ok = false;
      error = JSON.stringify(body.error ?? body.result?.content?.[0]?.text).slice(0, 300);
    }
  } catch {
    ok = false;
    error = text.slice(0, 300);
  }
  return { ms, ok, error, status: res.status, vercelId: res.headers.get('x-vercel-id') };
}

const ALL_CALLS = [
  ['initialize', () => rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'sl-mcp-latency-probe', version: '1' },
  })],
  ['tools/list', () => rpc('tools/list')],
  ['search_library', () => rpc('tools/call', { name: 'search_library', arguments: { query: `Paracelsus${nonce}`, limit: 5 } })],
  ['search_concept', () => rpc('tools/call', { name: 'search_concept', arguments: { query: `the soul ascends through the planetary spheres${nonce}`, limit: 5 } })],
];
// --calls tools/list,search_concept picks and orders the calls, so the cold
// first call can be any of them (one idle deployment per cold measurement).
const only = opt('calls', '');
const calls = only
  ? only.split(',').map((n) => ALL_CALLS.find(([name]) => name === n) ?? (() => { throw new Error(`unknown call ${n}`); })())
  : ALL_CALLS;

const rows = [];
for (let r = 1; r <= ROUNDS; r++) {
  for (const [name, fn] of calls) {
    const out = await fn();
    rows.push({ round: r, call: name, ...out });
    console.log(`${new Date().toISOString()} round ${r} ${name.padEnd(15)} ${String(out.ms).padStart(6)} ms ${out.ok ? 'ok' : `FAIL ${out.status}`} ${out.vercelId ?? ''}${out.error ? `\n    ${out.error}` : ''}`);
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : null;
};
console.log(`\n${BASE}  rounds=${ROUNDS}${FRESH ? ' fresh-queries' : ''}`);
console.log('call             round1   median(2..n)');
for (const [name] of calls) {
  const mine = rows.filter((x) => x.call === name);
  console.log(`${name.padEnd(15)} ${String(mine[0]?.ms).padStart(7)}   ${String(median(mine.slice(1).map((x) => x.ms))).padStart(7)}`);
}
