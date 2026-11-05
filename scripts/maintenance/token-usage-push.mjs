#!/usr/bin/env node
/**
 * Token usage pusher (/admin/tokens, #8201): what the Claude CLI used on this machine, from its
 * local transcripts, as one `ops_reports` document per machine. $0: it calls no model.
 *
 * PRIOR ART: ~/tools/claude-limits/usage_report.py + per_session.py (private, laptop-driven) write a
 * weekly markdown file by ssh; a page cannot read that, and it lost a whole box silently in W45.
 * scripts/maintenance/work-board-push.mjs is the pattern followed (one document per box, the page
 * renders it, no deploy to refresh) but it records job state, not tokens. The pricing and the
 * deduplication here deliberately match per_session.py, so the two can check each other.
 *
 *   node --env-file=.env.production.local scripts/maintenance/token-usage-push.mjs --box main [--meter] [--dry-run]
 *
 * --meter also pushes this machine's ~/.claude-limits history and latest reading (main and the laptop poll
 * separately; a login can lapse on either, so the page takes each account's freshest).
 *
 * Units: $-eq is API list price, a common unit and not money paid; the subscriptions are flat.
 * Privacy: job labels, account addresses and counts only. Never a prompt, a transcript line or a path.
 * Nothing but the page reads these documents, so a write here actuates nothing.
 * Blind spot: `claude -p --no-session-persistence` leaves no transcript, so it is not counted here.
 * The page shows the meter beside these totals, so that gap stays visible.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

export const WINDOW_DAYS = 15;
export const MAX_JOBS = 400;
const BIG_CONTEXT = 200_000;
const HUGE_CONTEXT = 400_000;
/** A short scripted session this large at boot carries the CLI's default prompt and tools. */
const FAT_BOOT = 15_000;
const SHORT_SESSION = 4;

export function modelFamily(model) {
  const m = (model || '').toLowerCase();
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  if (m.includes('fable')) return 'fable';
  if (m.includes('opus')) return 'opus';
  return 'other';
}

/** Same prices as per_session.py: Opus $5/$25, cache read $0.50, write $10 (1 h) or $6.25 (5 min). */
export function priceUsage(usage, model) {
  const m = (model || '').toLowerCase();
  const k = m.includes('haiku') ? 0.2 : m.includes('sonnet') ? 0.6 : 1;
  const cc = usage.cache_creation || null;
  const w1 = cc ? cc.ephemeral_1h_input_tokens || 0 : 0;
  const w5 = cc ? cc.ephemeral_5m_input_tokens || 0 : usage.cache_creation_input_tokens || 0;
  const input = usage.input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  const output = usage.output_tokens || 0;
  const parts = {
    input: (k * input * 5) / 1e6,
    write: (k * (w1 * 10 + w5 * 6.25)) / 1e6,
    read: (k * read * 0.5) / 1e6,
    output: (k * output * 25) / 1e6,
  };
  return { parts, cost: parts.input + parts.write + parts.read + parts.output, context: input + w1 + w5 + read };
}

/** A project folder name, as Claude Code flattens the cwd, to a job label that carries no path. */
export function jobLabel(dir) {
  const m = dir.match(/worktrees-(?:job-)?(.+)$/) || dir.match(/-jobs-([^-].*)$/);
  // A per-page lane opens one folder per call inside its job's scratch: all of them are that job.
  if (m) return m[1].replace(/-(?:tmp|claude-ws)-.*$/, '').slice(0, 80);
  if (/^-(private-)?(var-folders|tmp)/.test(dir)) return '(scripted, temp folder)';
  if (/^-(root|Users-[^-]+)-sourcelibrary$/.test(dir) || /-sl-sourcelibrary$/.test(dir)) return '(main checkout)';
  return dir.replace(/^-(root|Users-[^-]+)-/, '').slice(0, 80) || '(unknown)';
}

/** `Estimate: 5 pts` in the head of a brief: the job's expected use, in weekly points. */
export function parseEstimate(briefText) {
  const head = briefText.split('\n').slice(0, 15).join('\n');
  const m = head.match(/^Estimate:\s*([\d.]+)\s*(?:pts?|points?)?\s*(?:[—-].*)?$/im);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const addParts = (a, p) => { a.input += p.input; a.write += p.write; a.read += p.read; a.output += p.output; };
const emptyParts = () => ({ input: 0, write: 0, read: 0, output: 0 });
const round = (v, d = 3) => Number(v.toFixed(d));

export function newRollup() {
  return { seen: new Set(), days: new Map(), hours: new Map(), jobs: new Map(), signals: new Map(), sessions: new Map() };
}

function signalDay(r, day) {
  let s = r.signals.get(day);
  if (!s) r.signals.set(day, s = { day, cost: 0, big: 0, huge: 0, sub: 0, sub_opus: 0, polls: 0, poll_cost: 0, fat_calls: 0, fat_cost: 0 });
  return s;
}

/**
 * Feed one transcript's lines. `ctx` = { account, label, session, isSub, since (ms) }.
 * One message spans several lines that repeat its usage, hence the id check; a resumed session
 * can repeat old messages, hence the timestamp check. `sleep` marks the next request as a poll:
 * that request's cache read is what waking up to look again cost.
 */
export function feedLine(r, line, ctx, fileState) {
  let d;
  try { d = JSON.parse(line); } catch { return; }
  const m = d.message;
  if (!m) return;
  const ms = Date.parse(d.timestamp);
  countRequest(r, d, m, ms, ctx, fileState);
  // After counting: the message that asks to sleep was sent before the wait, so the poll is the next one.
  if (d.type === 'assistant' && Array.isArray(m.content) && ms >= ctx.since) {
    for (const b of m.content) {
      if (b?.type === 'tool_use' && b.name === 'Bash' && /\bsleep\s+\d/.test(b.input?.command || '')) fileState.afterSleep = true;
    }
  }
}

function countRequest(r, d, m, ms, ctx, fileState) {
  const u = m.usage;
  if (!u || !m.id || m.model === '<synthetic>' || r.seen.has(m.id)) return;
  r.seen.add(m.id);
  if (!(ms >= ctx.since)) return;

  const { parts, cost, context } = priceUsage(u, m.model);
  const fam = modelFamily(m.model);
  const iso = new Date(ms).toISOString();
  const day = iso.slice(0, 10);
  const account = ctx.accountAt ? ctx.accountAt(ms) : ctx.account;

  const dk = `${day}|${account}|${fam}`;
  let dr = r.days.get(dk);
  if (!dr) r.days.set(dk, dr = { day, account, model: fam, cost: 0, req: 0, parts: emptyParts() });
  dr.cost += cost; dr.req += 1; addParts(dr.parts, parts);

  const hk = `${iso.slice(0, 13)}|${account}`;
  r.hours.set(hk, (r.hours.get(hk) || 0) + cost);

  const jk = `${account}|${ctx.label}`;
  let j = r.jobs.get(jk);
  if (!j) r.jobs.set(jk, j = { job: ctx.label, account, cost: 0, req: 0, ctx_sum: 0, max_ctx: 0, big: 0, sub: 0, sub_opus: 0, polls: 0, poll_cost: 0, sessions: new Set(), first: iso, last: iso, parts: emptyParts() });
  j.cost += cost; j.req += 1; j.ctx_sum += context; j.max_ctx = Math.max(j.max_ctx, context); j.sessions.add(ctx.session);
  addParts(j.parts, parts);
  if (iso < j.first) j.first = iso;
  if (iso > j.last) j.last = iso;

  const s = signalDay(r, day);
  s.cost += cost;
  if (context > BIG_CONTEXT) { s.big += cost; j.big += cost; }
  if (context > HUGE_CONTEXT) s.huge += cost;
  if (ctx.isSub) {
    s.sub += cost; j.sub += cost;
    if (fam === 'opus') { s.sub_opus += cost; j.sub_opus += cost; }
  }
  if (fileState.afterSleep) {
    s.polls += 1; s.poll_cost += parts.read; j.polls += 1; j.poll_cost += parts.read;
    fileState.afterSleep = false;
  }

  if (!ctx.isSub) {
    let ss = r.sessions.get(ctx.session);
    if (!ss) r.sessions.set(ctx.session, ss = { day, cost: 0, req: 0, boot: context });
    ss.cost += cost; ss.req += 1;
  }
}

export function finishRollup(r, { estimates = new Map(), maxJobs = MAX_JOBS } = {}) {
  for (const ss of r.sessions.values()) {
    if (ss.req <= SHORT_SESSION && ss.boot >= FAT_BOOT) {
      const s = signalDay(r, ss.day);
      s.fat_calls += 1; s.fat_cost += ss.cost;
    }
  }
  const roundParts = p => ({ input: round(p.input), write: round(p.write), read: round(p.read), output: round(p.output) });
  const jobs = [...r.jobs.values()].sort((a, b) => b.cost - a.cost);
  return {
    days: [...r.days.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map(d => ({ ...d, cost: round(d.cost), parts: roundParts(d.parts) })),
    hours: [...r.hours.entries()].map(([k, cost]) => { const [hour, account] = k.split('|'); return { hour, account, cost: round(cost) }; })
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    signals: [...r.signals.values()].sort((a, b) => a.day.localeCompare(b.day))
      .map(s => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))),
    jobs: jobs.slice(0, maxJobs).map(({ sessions, ctx_sum, parts, ...j }) => ({
      ...j,
      cost: round(j.cost), big: round(j.big), sub: round(j.sub), sub_opus: round(j.sub_opus), poll_cost: round(j.poll_cost),
      sessions: sessions.size,
      avg_ctx: Math.round(ctx_sum / Math.max(j.req, 1)),
      parts: roundParts(parts),
      estimate_pts: estimates.get(j.job) ?? null,
    })),
    jobs_omitted: Math.max(0, jobs.length - maxJobs),
    jobs_omitted_cost: round(jobs.slice(maxJobs).reduce((t, j) => t + j.cost, 0)),
  };
}

function homes() {
  const h = os.homedir();
  const out = [path.join(h, '.claude')];
  for (const e of fs.readdirSync(h)) if (e.startsWith('.claude-')) out.push(path.join(h, e));
  return out.filter(d => fs.existsSync(path.join(d, 'projects')));
}

/** The stored login, with no network call. `claude auth status` can rotate the token. */
function accountOf(home) {
  const f = home === path.join(os.homedir(), '.claude') ? path.join(os.homedir(), '.claude.json') : path.join(home, '.claude.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')).oauthAccount.emailAddress; } catch { return 'unknown'; }
}

/**
 * A transcript does not record its account, and a machine whose login changes (the laptop, by /login) would
 * otherwise file its whole history under whoever is logged in now. climits appends each change to this file.
 * Lines before 2026-11-05 are inferred from which meter rose (source: inferred-from-meters), so an estimate.
 */
export function parseLoginTimeline(text) {
  return text.split('\n').flatMap(l => {
    try {
      const e = JSON.parse(l);
      const t = Date.parse(e.t);
      return e.account && Number.isFinite(t) ? [{ t, account: e.account }] : [];
    } catch { return []; }
  }).sort((x, y) => x.t - y.t);
}

/** The login in force at `ms`. Before the first entry there is no record, so it says so. */
export function loginAt(timeline, ms) {
  let found = 'unknown';
  for (const e of timeline) {
    if (e.t > ms) break;
    found = e.account;
  }
  return found;
}

function readLoginTimeline() {
  try { return parseLoginTimeline(fs.readFileSync(path.join(os.homedir(), '.claude-limits', 'login-history.jsonl'), 'utf8')); } catch { return []; }
}

function* transcripts(dir, sinceMs) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* transcripts(p, sinceMs);
    else if (e.name.endsWith('.jsonl')) {
      try { if (fs.statSync(p).mtimeMs >= sinceMs) yield p; } catch { /* reaped mid-scan */ }
    }
  }
}

async function scan(sinceMs) {
  const r = newRollup();
  const scanned = [];
  let files = 0;
  const timeline = readLoginTimeline();
  for (const home of homes()) {
    const account = accountOf(home);
    scanned.push(account);
    // Only the default home follows /login. A named home (~/.claude-team) stays on its own account.
    const accountAt = timeline.length && home === path.join(os.homedir(), '.claude') ? ms => loginAt(timeline, ms) : null;
    const root = path.join(home, 'projects');
    for (const f of transcripts(root, sinceMs)) {
      const rel = path.relative(root, f).split(path.sep);
      const ctx = { account, accountAt, label: jobLabel(rel[0]), session: (rel[1] || '').replace('.jsonl', ''), isSub: f.includes(`${path.sep}subagents${path.sep}`), since: sinceMs };
      const fileState = { afterSleep: false };
      let stream;
      try { stream = fs.createReadStream(f, 'utf8'); } catch { continue; }
      stream.on('error', () => {});
      try {
        for await (const line of readline.createInterface({ input: stream, crlfDelay: Infinity })) feedLine(r, line, ctx, fileState);
      } catch { /* reaped mid-scan */ }
      files += 1;
    }
  }
  return { r, files, scanned: [...new Set(scanned)] };
}

function readEstimates(labels) {
  const out = new Map();
  for (const jd of ['/root/claude-jobs', '/data/scratch/sl/claude-jobs']) {
    if (!fs.existsSync(jd)) continue;
    for (const label of labels) {
      if (out.has(label)) continue;
      try {
        const est = parseEstimate(fs.readFileSync(path.join(jd, `${label}.brief.txt`), 'utf8'));
        if (est != null) out.set(label, est);
      } catch { /* no brief: not a job, or reaped */ }
    }
  }
  return out;
}

/** Hourly meter readings, last WINDOW_DAYS, one series per account. */
export function meterSeries(historyText, sinceIso) {
  const by = new Map();
  for (const line of historyText.split('\n')) {
    if (!line.trim()) continue;
    let h;
    try { h = JSON.parse(line); } catch { continue; }
    const v = h.limits?.['weekly_all:all'];
    if (v == null || h.t < sinceIso) continue;
    if (!by.has(h.email)) by.set(h.email, new Map());
    by.get(h.email).set(h.t.slice(0, 13), v);
  }
  return [...by.entries()].map(([account, m]) => ({ account, points: [...m.entries()].map(([hour, pct]) => ({ hour, pct })) }));
}

/** Each account's latest weekly reading and reset time. An account this machine cannot read is left out. */
function meterReadings(file) {
  let latest;
  try { latest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  return (latest.accounts || []).flatMap(a => {
    const week = a.ok && Array.isArray(a.limits) ? a.limits.find(l => l.key === 'weekly_all:all') : null;
    return week ? [{ account: a.email, percent: week.percent, resets_at: week.resets_at || null, checked_at: a.checked_at || latest.checked_at }] : [];
  });
}

async function main() {
  const args = process.argv.slice(2);
  const box = args[args.indexOf('--box') + 1];
  if (!args.includes('--box') || !box) { console.error('usage: token-usage-push.mjs --box <name> [--meter] [--dry-run]'); process.exit(2); }
  const dry = args.includes('--dry-run');
  const started = Date.now();
  const sinceMs = started - WINDOW_DAYS * 86400e3;

  const { r, files, scanned } = await scan(sinceMs);
  const estimates = readEstimates(new Set([...r.jobs.values()].map(j => j.job)));
  const roll = finishRollup(r, { estimates });
  const doc = { _id: `token-usage:${box}`, type: 'token-usage', box, generated_at: new Date().toISOString(), window_days: WINDOW_DAYS, files, accounts: scanned, scan_seconds: Math.round((Date.now() - started) / 1000), ...roll };

  let meter = null;
  if (args.includes('--meter')) {
    const f = path.join(os.homedir(), '.claude-limits', 'history.jsonl');
    meter = { _id: `token-usage-meter:${box}`, type: 'token-usage-meter', box, generated_at: doc.generated_at, series: meterSeries(fs.readFileSync(f, 'utf8'), new Date(sinceMs).toISOString()), readings: meterReadings(path.join(os.homedir(), '.claude-limits', 'latest.json')) };
  }

  const week = started - 7 * 86400e3;
  const weekDay = new Date(week).toISOString().slice(0, 10);
  const total7 = doc.days.filter(d => d.day > weekDay).reduce((t, d) => t + d.cost, 0);
  const bytes = Buffer.byteLength(JSON.stringify(doc));
  console.log(`${box}: ${files} files, ${doc.jobs.length} jobs (${doc.jobs_omitted} omitted, $${doc.jobs_omitted_cost}), ~$${Math.round(total7)} since ${weekDay}, ${Math.round(bytes / 1024)} KB, ${doc.scan_seconds}s`);
  if (dry) {
    if (args.includes('--print')) console.log(JSON.stringify({ doc, meter }));
    return;
  }

  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
  try {
    await client.connect();
    const reports = client.db('bookstore').collection('ops_reports');
    await reports.replaceOne({ _id: doc._id }, doc, { upsert: true });
    if (meter) await reports.replaceOne({ _id: meter._id }, meter, { upsert: true });
  } finally {
    await client.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.error(String(e?.stack || e).slice(0, 800)); process.exit(1); });
}
