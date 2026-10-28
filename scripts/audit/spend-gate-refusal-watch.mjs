#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/vercel-prod-watch.mjs — the exit contract, the state file and the page-once-per-
 * transition shape followed here; it reads Vercel, not worker logs. scripts/audit/spend-daily.mjs /
 * spend-reconcile.mjs — measure what WAS spent, so a lane that spends nothing reads as healthy there.
 * scripts/maintenance/ntfy-morning-digest.mjs — a digest, not a streak detector. None reads the spend gate's
 * verdicts.
 *
 * spend-gate-refusal-watch — page when a recurring worker's spend gate refuses (nearly) every run for 24 h (#7492).
 *
 * Every spend envelope expired at 2026-10-25T16:50Z. From then `embed-gemini --incremental` (cron 30 *\/4) was
 * refused at the gate ("global daily ceiling reached; every envelope closed … — no new dispatch") and exited 0,
 * except for one run a day just after 00:00 UTC that the reset daily dial let through. For two days no new or
 * corrected translation reached semantic search, and nobody was paged. `enrich-worker --batch` stopped the same
 * way and was still stopped on 2026-10-28.
 *
 * Reads each watched worker's cron log, keeps the `[spend-guard] <label>:` verdict lines appended since the last
 * run, and stamps each with the time it was first SEEN (the lines carry no timestamp; at a 15-min cadence the
 * stamp is at most 15 min late). A worker FIRES when its newest verdict is a refusal and there is a run of
 * recent verdicts, ≥ STREAK_HOURS old at its start, of which ≥ REFUSAL_SHARE were refusals with at least
 * minRefusals of them. The share, not "only refusals", is the point: the daily dial lets one run a day through,
 * which is how the incident looked from outside — a strict "no dispatch for 24 h" rule never fires on it.
 *
 * The page names the closed envelopes from the newest refusal (expired, with the expiry instant; spent), so an
 * expiry decision shows which recurring work it stopped. One page per streak; the streak ends at the next
 * allowed verdict, which is logged (no page).
 *
 * Exit contract (measurement-instruments.md): 0 ran, clean · 1 ran, FIRED · 2 could not measure (a log
 * unreadable, a throw). Never branch on != 0.
 *
 * WRITES (not with --dry-run): the state file; one ntfy page (sourcelibrary-uptime) per streak. Nothing else.
 *
 * Usage:
 *   node scripts/audit/spend-gate-refusal-watch.mjs --dry-run     # read + judge, no page, no state
 *   node scripts/audit/spend-gate-refusal-watch.mjs               # cron (scripts/workers/crontab.production)
 *   node scripts/audit/spend-gate-refusal-watch.mjs --replay tests/fixtures/spend-gate-refusal-watch/2026-10-25-embed-gemini.log \
 *        --label embed-gemini --start 2026-10-25T00:30:00Z --every-min 240   # positive control (implies --dry-run)
 *   ... --json   the report on stdout
 *
 * Env: SPEND_GATE_WATCH_STATE (state file), SPEND_GATE_WATCH_TOPIC (ntfy URL), SPEND_GATE_WATCH_LOG_DIR.
 */
import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ntfyPost } from '../lib/ntfy-send.mjs';

export const STREAK_HOURS = 24;
export const REFUSAL_SHARE = 0.8;
const KEEP_DAYS = 9; // embed-site-pages is weekly; keep more than one cycle of verdicts
const KEEP_MAX = 3000;
const LOG_DIR = process.env.SPEND_GATE_WATCH_LOG_DIR || '/var/log/sourcelibrary';
const STATE_FILE = process.env.SPEND_GATE_WATCH_STATE || '/var/lib/sourcelibrary/spend-gate-refusal-watch.json';
const NTFY_TOPIC = process.env.SPEND_GATE_WATCH_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';

/** The crons that call budgetAllowsDispatchScoped on a schedule (crontab.production). label = the gate label. */
export const WORKERS = [
  { name: 'embed-gemini', label: 'embed-gemini', log: 'embed-gemini.log', minRefusals: 3 }, // 30 */4
  { name: 'enrich-worker --batch', label: 'enrich-worker-batch', log: 'enrich-batch.log', minRefusals: 3 }, // */15 + hourly
  { name: 'embed-site-pages', label: 'embed-site-pages', log: 'site-pages.log', minRefusals: 1 }, // weekly
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

/**
 * One `[spend-guard]` line → { ok: true|false } for this label, or null (not a verdict for it). Wording is
 * spend-guard.mjs's: allowed = DISPATCH / SCOPED DISPATCH / DISPATCH unscoped / BYPASS; refused = "no new
 * dispatch", "refusing dispatch", "paid dispatch stays OFF". "daily meter truncated … envelopes decide" is a
 * preamble to a second verdict line, not a verdict.
 */
export function parseVerdict(line, label) {
  const m = new RegExp(`\\[spend-guard\\] ${esc(label)}: (.*)$`).exec(line);
  if (!m) return null;
  const rest = m[1];
  if (/no new dispatch|refusing dispatch|paid dispatch stays OFF/.test(rest)) return { ok: false, closed: closedEnvelopes(rest) };
  if (/→ (SCOPED )?DISPATCH|^BYPASS/.test(rest)) return { ok: true };
  return null;
}

/** "name: EXPIRED <iso> — closed" / "name: $a/$b ENVELOPE SPENT" from a refusal's envelope list. */
export function closedEnvelopes(rest) {
  const list = /\((.*)\) — no new dispatch/.exec(rest)?.[1];
  if (!list) return null;
  const expired = {};
  const spent = [];
  for (const part of list.split('; ')) {
    const e = /^([^:]+): EXPIRED (\S+) — closed$/.exec(part);
    if (e) (expired[e[2]] ||= []).push(e[1]);
    else if (/ENVELOPE SPENT/.test(part)) spent.push(part.split(':')[0]);
  }
  return { expired, spent };
}

/**
 * Judge one worker's verdicts [{ t, ok, closed? }] (oldest first) at `now`. Finds the longest run of newest
 * verdicts whose refusal share is ≥ REFUSAL_SHARE; it fires if the newest is a refusal, the run starts
 * ≥ STREAK_HOURS before now, and holds ≥ minRefusals refusals.
 */
export function judgeWorker(verdicts, { now, minRefusals = 3, streakHours = STREAK_HOURS, share = REFUSAL_SHARE } = {}) {
  const n = verdicts.length;
  if (!n || verdicts[n - 1].ok) return { firing: false, refusing: false };
  let refused = 0;
  let start = -1;
  let startRefused = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (!verdicts[i].ok) refused++;
    if (refused / (n - i) >= share) { start = i; startRefused = refused; }
  }
  const since = verdicts[start].t;
  const hours = (now - since) / 3.6e6;
  const runs = n - start;
  return {
    firing: hours >= streakHours && startRefused >= minRefusals,
    refusing: true, since, hours: +hours.toFixed(1), runs, refused: startRefused, allowed: runs - startRefused,
    closed: verdicts[n - 1].closed || null,
  };
}

export function describeClosed(closed) {
  if (!closed) return 'envelopes: (not named in the refusal — no envelopes, or the meter was unreadable)';
  const parts = Object.entries(closed.expired).map(([at, names]) => `${names.length} EXPIRED ${at}: ${names.join(', ')}`);
  if (closed.spent.length) parts.push(`${closed.spent.length} SPENT: ${closed.spent.join(', ')}`);
  return `closed envelopes — ${parts.join(' | ') || 'none named'}`;
}

export function pageText(worker, r) {
  return `${worker.name} (gate label ${worker.label}): spend gate refused ${r.refused} of ${r.runs} runs over the last `
    + `${r.hours} h (since ${iso(r.since)}); allowed ${r.allowed}. The cron exits 0, so nothing else shows it. `
    + `${describeClosed(r.closed)}. Reopen or extend an envelope that covers this lane `
    + `(scripts/maintenance/set-scope.mjs --tag <tag> --extend <days>), or retire the cron. #7492`;
}

/** New bytes of a log since { ino, offset }, following one logrotate (file → file.1). */
function readNew(path, prev) {
  const st = statSync(path);
  const chunks = [];
  const readFrom = (p, from) => {
    const size = statSync(p).size;
    if (size <= from) return;
    const fd = openSync(p, 'r');
    try { const buf = Buffer.alloc(size - from); readSync(fd, buf, 0, buf.length, from); chunks.push(buf.toString('utf8')); }
    finally { closeSync(fd); }
  };
  if (!prev) return { text: '', ino: st.ino, offset: st.size, fresh: true }; // no baseline: unknown-time lines are not counted
  if (prev.ino === st.ino) readFrom(path, st.size < prev.offset ? 0 : prev.offset);
  else {
    try { if (statSync(`${path}.1`).ino === prev.ino) readFrom(`${path}.1`, prev.offset); } catch { /* rotated past .1 */ }
    readFrom(path, 0);
  }
  return { text: chunks.join(''), ino: st.ino, offset: st.size };
}

function prune(verdicts, now) {
  const keep = verdicts.filter((v) => now - v.t <= KEEP_DAYS * 864e5);
  return keep.slice(-KEEP_MAX);
}

function replay(args) {
  const get = (k) => args[args.indexOf(k) + 1];
  const worker = WORKERS.find((w) => w.label === get('--label')) || { name: get('--label'), label: get('--label'), minRefusals: 3 };
  const start = Date.parse(get('--start'));
  const every = Number(get('--every-min')) * 6e4;
  const lines = readFileSync(get('--replay'), 'utf8').split('\n');
  const verdicts = lines.map((l) => parseVerdict(l, worker.label)).filter(Boolean).map((v, i) => ({ ...v, t: start + i * every }));
  // Evaluate as a 15-minute cron would, from the first verdict to one interval past the last.
  const events = [];
  let paged = false;
  for (let now = start; now <= start + verdicts.length * every; now += 15 * 6e4) {
    const seen = verdicts.filter((v) => v.t <= now);
    const r = judgeWorker(seen, { now, minRefusals: worker.minRefusals });
    if (r.firing && !paged) { paged = true; events.push({ at: iso(now), event: 'PAGE', text: pageText(worker, r) }); }
    if (!r.refusing && paged) { paged = false; events.push({ at: iso(now), event: 'CLEARED' }); }
  }
  return { worker: worker.name, verdicts: verdicts.map((v) => ({ at: iso(v.t), ok: v.ok })), events };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  if (args.includes('--replay')) {
    const r = replay(args);
    if (json) console.log(JSON.stringify(r, null, 2));
    else {
      for (const v of r.verdicts) console.log(`${v.at}  ${v.ok ? 'allowed' : 'REFUSED'}`);
      for (const e of r.events) console.log(`\n${e.at}  ${e.event}${e.text ? `\n  ${e.text}` : ''}`);
    }
    process.exit(r.events.some((e) => e.event === 'PAGE') ? 1 : 0);
  }
  const dry = args.includes('--dry-run');
  const now = Date.now();
  let state = { workers: {} };
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { /* first run */ }
  const report = [];
  let unknown = false;
  for (const w of WORKERS) {
    const s = state.workers[w.name] || { verdicts: [], paged: false };
    let got;
    try { got = readNew(join(LOG_DIR, w.log), s.ino == null ? null : s); }
    catch (e) { unknown = true; report.push({ worker: w.name, status: 'UNKNOWN', error: e.message }); continue; }
    const fresh = got.text.split('\n').map((l) => parseVerdict(l, w.label)).filter(Boolean).map((v) => ({ ...v, t: now }));
    // Only the newest refusal's envelope list is shown; drop the rest so the state file stays small.
    s.verdicts = prune([...s.verdicts, ...fresh], now).map((v, i, a) => (i < a.length - 1 && v.closed ? { t: v.t, ok: v.ok } : v));
    Object.assign(s, { ino: got.ino, offset: got.offset });
    const r = judgeWorker(s.verdicts, { now, minRefusals: w.minRefusals });
    const entry = { worker: w.name, status: r.firing ? 'FIRING' : r.refusing ? 'REFUSING' : 'OK', new_verdicts: fresh.length, ...r, since: r.since && iso(r.since), baseline: got.fresh || undefined };
    if (r.firing && !s.paged) {
      entry.page = pageText(w, r);
      if (!dry) {
        const res = await ntfyPost(NTFY_TOPIC, { headers: { Title: `Spend gate refusing ${w.name} for ${Math.floor(r.hours)} h`, Priority: 'high', Tags: 'money_with_wings,warning' }, body: entry.page });
        if (res.ok) s.paged = true; else { unknown = true; entry.error = `ntfy ${res.status}`; }
      }
    } else if (!r.refusing && s.paged) { s.paged = false; entry.cleared = true; }
    state.workers[w.name] = s;
    report.push(entry);
  }
  if (!dry) { mkdirSync(dirname(STATE_FILE), { recursive: true }); writeFileSync(STATE_FILE, JSON.stringify(state)); }
  if (json) console.log(JSON.stringify({ at: iso(now), dry, workers: report }, null, 2));
  else for (const e of report) {
    console.log(`${iso(now)} ${e.worker}: ${e.status}${e.refusing ? ` — ${e.refused}/${e.runs} refused over ${e.hours} h since ${e.since}` : ''}`
      + `${e.baseline ? ' (baseline set; counting from now)' : ''}${e.cleared ? ' — streak ended' : ''}${e.error ? ` [${e.error}]` : ''}`);
    if (e.page) console.log(`  ${dry ? 'would page' : 'PAGED'}: ${e.page}`);
  }
  process.exit(unknown ? 2 : report.some((e) => e.status === 'FIRING') ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
