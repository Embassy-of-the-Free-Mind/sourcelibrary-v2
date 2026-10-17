// Is the page-vector service current? Pages ntfy (sourcelibrary-uptime) once per state change, never per run.
//   node --env-file=/root/sourcelibrary/.env.production.local freshness-check.mjs [--dry-run]
//
// Fails on any of:
//   down       the local /health does not answer
//   stale      the last delta (sync-delta.mjs, every 30 min; it posts a heartbeat even when nothing changed)
//              is older than 2 h
//   reconcile  the last reconcile (sync-delta.mjs --reconcile, every 2 h) is older than 6 h or never ran:
//              most new rows reach the service only through it (sync-delta.mjs header, step 4)
//   drift      |service live rows − Supabase `embedding IS NOT NULL` rows| > 0.5% of Supabase, with the
//              Supabase count taken by the last reconcile's scan (logs/reconcile.json) rather than by a
//              second ~1 min scan of page_translations here. The service side is read now, so rows the
//              delta added since then count against it by at most one delta's worth.
// State: $VECTOR_SEARCH_ROOT/logs/freshness-state.json. Exit 0 ok, 1 failing, 2 the push itself failed.
// No database access: everything comes from /health and the reconcile's file.
//
// PRIOR ART: scripts/audit/vercel-prod-watch.mjs — the ntfy-on-state-change shape (state file, one push per
// transition, low priority on recovery). sync-delta.mjs --count-check is the nightly 0.1% rebuild signal;
// this is the alarm when the service falls out of date between those.
import fs from 'node:fs';
import path from 'node:path';
import { LOG_DIR, RECONCILE_PATH, writeJsonAtomic, log } from './lib.mjs';

const LOCAL = `http://127.0.0.1:${process.env.VECTOR_SEARCH_LOCAL_PORT || 3459}`;
const NTFY_TOPIC = process.env.VECTOR_SEARCH_NTFY || 'https://ntfy.sh/sourcelibrary-uptime';
const STATE_FILE = path.join(LOG_DIR, 'freshness-state.json');
const STALE_MS = 2 * 3600e3;
const RESTART_GRACE_MS = 45 * 60e3; // > one delta interval
const RECONCILE_STALE_MS = 6 * 3600e3;
const DRIFT_MAX = 0.005;
const DRY = process.argv.includes('--dry-run');

const prev = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return { key: '' }; } })();
const now = Date.now();
const fails = [];
const ago = (t) => `${((now - t) / 3600e3).toFixed(1)} h ago`;

let h = null;
try {
  const r = await fetch(`${LOCAL}/health`, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  h = await r.json();
} catch (e) { fails.push({ kind: 'down', line: `service /health did not answer: ${e.message}` }); }

if (h) {
  const at = h.last_delta_at ? Date.parse(h.last_delta_at) : null;
  // A restart reloads last_delta_at from the last SAVE (up to a day old) until the next half-hourly delta
  // runs; that is not staleness. Without this grace a restart paged "stale" on 2026-10-17.
  const justLoaded = h.loaded_at && now - Date.parse(h.loaded_at) < RESTART_GRACE_MS;
  if (!justLoaded && (at === null || now - at > STALE_MS)) {
    fails.push({ kind: 'stale', line: `last delta ${h.last_delta_at ?? 'never'}${at ? ` (${ago(at)})` : ''}; checkpoint ${h.checkpoint?.updated_at}` });
  }
}

const rec = (() => { try { return JSON.parse(fs.readFileSync(RECONCILE_PATH, 'utf8')); } catch { return null; } })();
if (!rec || now - Date.parse(rec.at) > RECONCILE_STALE_MS) {
  fails.push({ kind: 'reconcile', line: rec ? `last reconcile ${rec.at} (${ago(Date.parse(rec.at))})` : 'no reconcile has run (logs/reconcile.json missing)' });
}
if (h && rec) {
  const drift = h.live_rows - rec.supabase_served;
  if (Math.abs(drift) > rec.supabase_served * DRIFT_MAX) {
    fails.push({ kind: 'drift', line: `service ${h.live_rows.toLocaleString()} rows vs Supabase ${rec.supabase_served.toLocaleString()} (reconcile ${rec.at}): drift ${drift} > 0.5%` });
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
if (!DRY) writeJsonAtomic(STATE_FILE, { key, at: new Date().toISOString(), fails });
process.exit(fails.length ? 1 : 0);
