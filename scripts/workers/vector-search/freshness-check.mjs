// Is the page-vector service current? Pages ntfy (sourcelibrary-uptime) once per state change, never per run.
//   node --env-file=/root/sourcelibrary/.env.production.local freshness-check.mjs [--dry-run] [--force-count]
//
// Fails on any of:
//   down   the local /health does not answer
//   stale  the last delta (sync-delta.mjs, every 30 min; it posts a heartbeat even when nothing changed)
//          is older than 2 h
//   drift  |service live rows − Supabase `embedding IS NOT NULL` rows| > 0.5% of Supabase. Deleted rows are
//          invisible to the delta (README), so this is the only thing that sees them. The count is a ~1 min
//          scan of page_translations, so it runs at most every 6 h; the last result is kept in the state file.
// State: $VECTOR_SEARCH_ROOT/logs/freshness-state.json. Exit 0 ok, 1 failing, 2 the check itself broke.
//
// PRIOR ART: scripts/audit/vercel-prod-watch.mjs — the ntfy-on-state-change shape (state file, one push per
// transition, low priority on recovery). sync-delta.mjs --count-check is the nightly 0.1% rebuild signal;
// this is the alarm when the service falls out of date between those.
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, pgClient, writeJsonAtomic, log } from './lib.mjs';

const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const NTFY_TOPIC = process.env.VECTOR_SEARCH_NTFY || 'https://ntfy.sh/sourcelibrary-uptime';
const STATE_FILE = path.join(LOG_DIR, 'freshness-state.json');
const STALE_MS = 2 * 3600e3;
const DRIFT_MAX = 0.005;
const COUNT_EVERY_MS = 6 * 3600e3;
const DRY = process.argv.includes('--dry-run');
const FORCE_COUNT = process.argv.includes('--force-count');

const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { key: '', count: null }; } })();
const now = Date.now();
const fails = [];

let h = null;
try {
  const r = await fetch(`${LOCAL}/health`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  h = await r.json();
} catch (e) { fails.push({ kind: 'down', line: `service /health did not answer: ${e.message}` }); }

if (h) {
  const at = h.last_delta_at ? Date.parse(h.last_delta_at) : null;
  if (at === null || now - at > STALE_MS) {
    fails.push({ kind: 'stale', line: `last delta ${h.last_delta_at ?? 'never'} (${at ? ((now - at) / 3600e3).toFixed(1) + ' h ago' : 'no delta since the build'}); checkpoint ${h.checkpoint?.updated_at}` });
  }
}

let count = prev.count;
if (h && (FORCE_COUNT || !count || now - Date.parse(count.at) > COUNT_EVERY_MS)) {
  const c = await pgClient();
  try {
    const { rows: [{ n }] } = await c.query('SELECT count(*)::bigint AS n FROM page_translations WHERE embedding IS NOT NULL');
    count = { at: new Date().toISOString(), supabase: Number(n), service: h.live_rows };
  } finally { await c.end(); }
}
if (h && count) {
  // Compare the stored Supabase count with the service as it is now: a delta since the count moves both.
  const drift = h.live_rows - count.supabase;
  if (Math.abs(drift) > count.supabase * DRIFT_MAX) {
    fails.push({ kind: 'drift', line: `service ${h.live_rows.toLocaleString()} rows vs Supabase ${count.supabase.toLocaleString()} (counted ${count.at}): drift ${drift} > 0.5% — rebuild (bootstrap.sh --rebuild --no-phase2)` });
  }
}

const key = fails.map((f) => f.kind).sort().join(',');
const summary = fails.length ? fails.map((f) => `${f.kind}: ${f.line}`).join('\n') : `ok · ${h.live_rows.toLocaleString()} rows · last delta ${h.last_delta_at}`;
log(`freshness: ${summary.replace(/\n/g, ' | ')}`);

if (key !== prev.key && !DRY) {
  const res = await fetch(NTFY_TOPIC, {
    method: 'POST',
    headers: {
      Title: key ? `vector service: ${key}` : 'vector service: ok again',
      Priority: key ? 'high' : 'low', Tags: 'mag',
    },
    body: `${summary}\nl7a /data/vector-search/logs/delta.log · #6821`,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) { log(`ntfy HTTP ${res.status}`); process.exit(2); } // state not written: the next run retries the push
}
if (!DRY) writeJsonAtomic(STATE_FILE, { key, at: new Date().toISOString(), fails, count });
process.exit(fails.length ? 1 : 0);
