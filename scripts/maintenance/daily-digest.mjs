#!/usr/bin/env node
/**
 * daily-digest — ONE short message a day from the Hetzner box, instead of a stream (#5441).
 *
 * PRIOR ART: scripts/audit/spend-reconcile.mjs — the billed-vs-metered reconciler; a month/7-day
 *   instrument with Google auth, not a one-screen daily read. Its trap F (sum BOTH gemini_usage
 *   stores) and trap E (unreadable prints UNREADABLE, never $0) are followed here.
 *   scripts/lib/spend-guard.mjs — getTodaySpendUsd() sums both stores for TODAY only, no lane split;
 *   reused for "today so far". scripts/audit/entities-sweep-active.mjs — a single interlock question,
 *   not a digest. /root/speedtest-a/tick.mjs (writer of guard.log / ticks.jsonl) — box-local and
 *   scoped to speed test A; read here as an input, not reused. src/lib/email-digest-generator.ts —
 *   reader-facing email digest, unrelated. None composes spend + jobs + decisions + holds.
 *
 * What it says (≤ 25 lines, plain text):
 *   (a) yesterday's computed Gemini spend from BOTH meter stores vs the dial, per lane, month to date
 *   (b) what is running on the box: claude-job tmux sessions, chained-lane tick health, speed test,
 *       GPU leases (read from the watchdog's own log — it has no --list)
 *   (c) waiting on Derek: DECISIONS-PENDING.md rows in the private ops repo, if gh can read it
 *   (d) tier:hold PRs open more than 24 h
 *
 * Delivery, first that works: Telegram (bot token + chat id from the bridge's .env; a one-way
 * sendMessage, no polling, so it does not conflict with any bridge process), else a comment on the
 * standing GitHub issue titled "Daily digest" — that repo is PUBLIC, so the GitHub copy omits the
 * private ops repo's decision leads (count only). The full text is ALWAYS written to
 * /var/log/sourcelibrary/daily-digest/<date>.txt.
 *
 * Spend is COMPUTED cost_usd, not billed (spend-controls.md "Known holes") — the digest says so.
 * Reads only; makes no model call and writes nothing to Mongo or Supabase.
 *
 * Run:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/daily-digest.mjs --dry-run
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/daily-digest.mjs
 *   ... --date=2026-10-01      # digest as if run that day (yesterday = 2026-09-30)
 *   ... --via=github           # skip Telegram
 *   ... --dry-run --public     # print the public-repo variant (decision leads omitted)
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_LINES = 25;
const LOG_DIR = '/var/log/sourcelibrary';
const OUT_DIR = path.join(LOG_DIR, 'daily-digest');
const CHAINED_LOG = path.join(LOG_DIR, 'translate-batch-chained.log');
const GPU_LOG = path.join(LOG_DIR, 'gpu-lease-watchdog.log');
const JOB_LOG_DIR = path.join(LOG_DIR, 'claude-jobs');
const SPEEDTEST_TICKS = '/root/speedtest-a/ticks.jsonl';
const TELEGRAM_ENV = process.env.DIGEST_TELEGRAM_ENV || '/root/telegram-claude-bridge/.env';
const OPS_REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-ops';
const DIGEST_ISSUE_TITLE = 'Daily digest';

// ───────────────────────────────────────────── pure helpers (unit-tested)

export const LANES = ['chained', 'realtime', 'ocr_batch', 'images', 'other'];
const LANE_LABEL = { chained: 'chained', realtime: 'realtime tr', ocr_batch: 'ocr batch', images: 'images', other: 'other' };

/** Which lane a gemini_usage row belongs to. Mongo says image_extraction, Supabase extract_images. */
export function classifyLane({ type, mode, endpoint } = {}) {
  if (endpoint === 'hetzner/translate-batch-chained') return 'chained';
  if ((type === 'translation' || type === 'translate') && mode !== 'batch') return 'realtime';
  if (type === 'ocr' && mode === 'batch') return 'ocr_batch';
  if (type === 'extract_images' || type === 'image_extraction') return 'images';
  return 'other';
}

/** Fold usage rows into { usd, rows, costless, lanes{} }. */
export function sumByLane(rows) {
  const out = { usd: 0, rows: 0, costless: 0, lanes: Object.fromEntries(LANES.map(l => [l, 0])) };
  for (const r of rows) {
    const n = r.n ?? 1;
    out.rows += n;
    if (r.cost_usd == null) { out.costless += n; continue; }
    out.usd += r.cost_usd;
    out.lanes[classifyLane(r)] += r.cost_usd;
  }
  return out;
}

/**
 * The chained lane's own log has no date on its tick lines, only `  HH:MM:SS … open chained runs: N`.
 * Pair the last such stamp with the file's mtime to get a full time.
 */
export function parseChainedLog(text, mtime) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s+(\d\d:\d\d:\d\d) open chained runs: (\d+)/);
    if (m) {
      let at = null;
      if (mtime) {
        at = new Date(`${mtime.toISOString().slice(0, 10)}T${m[1]}Z`);
        if (at > mtime) at = new Date(at.getTime() - 864e5); // stamp is from before midnight
      }
      return { lastTick: at, lastStamp: m[1], openFromLog: Number(m[2]) };
    }
  }
  return { lastTick: null, lastStamp: null, openFromLog: null };
}

/** Last status row of the speed-test tick log (event rows skipped). */
export function parseSpeedtest(text) {
  const rows = String(text || '').split('\n').filter(Boolean);
  for (let i = rows.length - 1; i >= 0; i--) {
    let r; try { r = JSON.parse(rows[i]); } catch { continue; }
    if (!r.status) continue;
    const sum = a => (Array.isArray(a) ? a.reduce((s, x) => s + (x.pages || 0), 0) : 0);
    return { t: r.t, test: r.test, status: r.status, ocrPages: sum(r.ocr), trPages: sum(r.translation), todayUsd: r.today_usd, windowUsd: r.window_usd_since_start };
  }
  return null;
}

/** Last block of the GPU lease watchdog log: header + one line per instance. */
export function parseGpuLog(text) {
  const lines = String(text || '').split('\n').filter(Boolean);
  let h = -1;
  for (let i = lines.length - 1; i >= 0; i--) if (/^\d{4}-\d\d-\d\dT\S+Z /.test(lines[i])) { h = i; break; }
  if (h < 0) return null;
  const at = lines[h].split(' ')[0];
  const inst = lines.slice(h + 1).map(l => l.trim()).filter(Boolean);
  return {
    at,
    stopped: inst.filter(l => l.startsWith('stopped')).length,
    live: inst.filter(l => !l.startsWith('stopped')).map(l => l.replace(/\s+/g, ' ').replace(/ \([^)]*\b([0-9a-f]{8})-[0-9a-f-]+\)/, ' ($1)')),
  };
}

/**
 * DECISIONS-PENDING.md rows: table rows whose first cell opens with a bold lead, outside `## Done`.
 * Returns [{ section, lead }].
 */
export function parseDecisions(md) {
  const out = [];
  let section = '';
  for (const line of String(md || '').split('\n')) {
    const h = line.match(/^##\s+(.*)/);
    if (h) { section = h[1].trim(); continue; }
    if (/^done\b/i.test(section)) continue;
    const m = line.match(/^\|\s*\*\*(.+?)\*\*/);
    if (m) out.push({ section: section.replace(/\s*\((added|updated)[^)]*\)\s*$/, ''), lead: m[1].trim() });
  }
  return out;
}

const money = n => '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2));
const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ago = (t, now) => {
  const m = Math.round((now - new Date(t)) / 60000);
  return m < 90 ? `${m} min ago` : m < 48 * 60 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const hhmm = t => new Date(t).toISOString().slice(11, 16) + 'Z';

/**
 * Compose the digest. Every section takes either data or { error } — an unreadable source is said
 * out loud, never left out (an omitted line reads as "nothing").
 *
 * publicSafe: the decision leads come from the PRIVATE ops repo (fundraising, budgets, contacts);
 * anything posted to the public sourcelibrary-v2 repo carries the count only.
 */
export function formatDigest(d, { publicSafe = false } = {}) {
  const now = new Date(d.now);
  const L = [];
  L.push(`Source Library — daily digest ${d.date} (yesterday = ${d.yesterday} UTC)`);

  // (a) spend
  const s = d.spend;
  if (s?.error) {
    L.push(`SPEND: UNREADABLE — ${clip(s.error, 120)}`);
  } else if (s) {
    const dial = s.dial == null ? 'dial UNSET (closed)' : `dial ${money(s.dial)} (${Math.round((s.y.usd / s.dial) * 100)}%)`;
    const env = s.envelopes ? ` + ${s.envelopes} envelope${s.envelopes === 1 ? '' : 's'}` : '';
    L.push(`SPEND ${d.yesterday}: ${money(s.y.usd)} vs ${dial}${env} · supabase ${money(s.ySupa)} + mongo ${money(s.yMongo)} · ${s.y.rows.toLocaleString('en-US')} calls${s.y.costless ? `, ${s.y.costless} w/o cost` : ''}`);
    L.push('  lanes: ' + LANES.map(l => `${LANE_LABEL[l]} ${money(s.y.lanes[l])}`).join(' · '));
    const mtdTop = LANES.map(l => [l, s.mtd.lanes[l]]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([l, v]) => `${LANE_LABEL[l]} ${money(v)}`).join(', ');
    const today = s.today?.error ? 'today UNREADABLE' : s.today ? `today so far ${money(s.today.usd)}` : '';
    L.push(`  month to date (${s.mtdLabel}): ${money(s.mtd.usd)} — top ${mtdTop}${today ? ` · ${today}` : ''} · computed cost, not billed`);
  }

  // (b) box
  const j = d.jobs;
  if (j?.error) L.push(`JOBS: UNREADABLE — ${clip(j.error, 120)}`);
  else if (j) {
    L.push(`JOBS: ${j.running.length} running${j.running.length ? ` (${j.running.map(r => r.name).join(', ')})` : ''}${j.finished.length ? ` · ${j.finished.length} finished in 24 h` : ''}`);
    const shown = [...j.running, ...j.finished].slice(0, 4);
    for (const r of shown) L.push(`  ${r.name}${r.state === 'done' ? ' [done]' : ''}: ${clip(r.last || '(no output yet)', 90)}`);
    const more = j.running.length + j.finished.length - shown.length;
    if (more > 0) L.push(`  …${more} more: /root/bin/claude-job.sh status`);
  }
  const c = d.chained;
  if (c?.error) L.push(`chained lane: UNREADABLE — ${clip(c.error, 100)}`);
  else if (c) {
    const tick = c.lastTick ? `last tick ${hhmm(c.lastTick)} (${ago(c.lastTick, now)})` : 'NO tick found in log';
    const stale = c.lastTick && now - new Date(c.lastTick) > 30 * 60000 ? ' — STALE' : '';
    L.push(`chained lane: ${tick}${stale} · ${c.open} open · ${c.parked} parked (${c.parked24} in 24 h) · ${c.complete24} completed in 24 h`);
  }
  const st = d.speedtest;
  if (st) L.push(`${st.test || 'speed test'}: ${st.status} @ ${hhmm(st.t)} · OCR ${st.ocrPages.toLocaleString('en-US')} pp · translated ${st.trPages.toLocaleString('en-US')} pp · today ${money(st.todayUsd || 0)}`);
  const g = d.gpu;
  if (g?.error) L.push(`GPU leases: UNREADABLE — ${clip(g.error, 100)}`);
  else if (g) L.push(`GPU (${hhmm(g.at)}): ${g.live.length ? clip(g.live.join(' | '), 150) : 'no live instance'}${g.stopped ? ` · ${g.stopped} stopped` : ''}`);

  // (c) decisions
  const dec = d.decisions;
  if (dec?.error) L.push(`WAITING ON DEREK: ${dec.error}`);
  else if (dec) {
    L.push(`WAITING ON DEREK: ${dec.rows.length} row${dec.rows.length === 1 ? '' : 's'} in DECISIONS-PENDING.md`);
    if (publicSafe) {
      if (dec.rows.length) L.push('  (leads omitted — private ops repo; /decisions lists them)');
    } else {
      dec.rows.slice(0, 3).forEach((r, i) => L.push(`  ${i + 1}. ${clip(r.lead, 140)}`));
      if (dec.rows.length > 3) L.push(`  …${dec.rows.length - 3} more (/decisions)`);
    }
  }

  // (d) holds
  const p = d.holds;
  if (p?.error) L.push(`TIER:HOLD PRs: UNREADABLE — ${clip(p.error, 100)}`);
  else if (p) {
    L.push(`TIER:HOLD PRs open > 24 h: ${p.length}`);
    p.slice(0, 4).forEach(x => L.push(`  #${x.number} (${ago(x.createdAt, now).replace(' ago', '')}) ${clip(x.title, 90)}`));
    if (p.length > 4) L.push(`  …${p.length - 4} more`);
  }

  if (L.length > MAX_LINES) return [...L.slice(0, MAX_LINES - 1), '…(truncated)'].join('\n');
  return L.join('\n');
}

// ───────────────────────────────────────────── collectors (I/O)

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const dayIso = d => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 864e5);

/** One UTC day of Supabase gemini_usage, paginated (PostgREST caps at 1,000; aggregates disabled). */
async function supabaseDay(day) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  const rows = [];
  for (let from = 0; ; from += 1000) {
    if (from >= 200_000) throw new Error(`>200K Supabase rows on ${dayIso(day)} — sum truncated`);
    const url = `${SUPABASE_URL}/rest/v1/gemini_usage?select=type,mode,endpoint,cost_usd`
      + `&timestamp=gte.${day.toISOString()}&timestamp=lt.${addDays(day, 1).toISOString()}&order=id.asc`;
    const resp = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` } });
    if (!resp.ok && resp.status !== 206) throw new Error(`Supabase read failed (${resp.status}) on ${dayIso(day)}`);
    const batch = await resp.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

/** Mongo fallback store, by ObjectId time range (string timestamps defeat Date queries). */
async function mongoRange(db, ObjectId, from, to) {
  const id = d => ObjectId.createFromTime(Math.floor(d.getTime() / 1000));
  return db.collection('gemini_usage').aggregate([
    { $match: { _id: { $gte: id(from), $lt: id(to) } } },
    { $group: { _id: { type: '$type', mode: '$mode', endpoint: '$endpoint', costless: { $eq: [{ $ifNull: ['$cost_usd', null] }, null] } },
      n: { $sum: 1 }, usd: { $sum: { $ifNull: ['$cost_usd', 0] } } } },
  ], { maxTimeMS: 120000 }).toArray()
    .then(g => g.map(x => ({ ...x._id, n: x.n, cost_usd: x._id.costless ? null : x.usd })));
}

async function collectSpend(db, ObjectId, yesterday) {
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const { readDailyBudgetUsd, readScopeEnvelopes, getTodaySpendUsd } = await import('../lib/spend-guard.mjs');
  const monthStart = new Date(Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), 1));
  const days = [];
  for (let d = monthStart; d <= yesterday; d = addDays(d, 1)) days.push(d);
  // Days in parallel, five at a time: a month is ~300 sequential PostgREST pages otherwise.
  const supaByDay = new Map();
  for (let i = 0; i < days.length; i += 5) {
    const chunk = days.slice(i, i + 5);
    const res = await Promise.all(chunk.map(supabaseDay));
    chunk.forEach((d, k) => supaByDay.set(dayIso(d), res[k]));
  }
  const [mongoY, mongoMtd, today] = await Promise.all([
    mongoRange(db, ObjectId, yesterday, addDays(yesterday, 1)),
    mongoRange(db, ObjectId, monthStart, addDays(yesterday, 1)),
    getTodaySpendUsd(db).then(t => (t.meterError ? { error: t.meterError } : t)),
  ]);
  const supaY = sumByLane(supaByDay.get(dayIso(yesterday)));
  const monY = sumByLane(mongoY);
  return {
    dial: readDailyBudgetUsd(control),
    envelopes: readScopeEnvelopes(control).length,
    y: sumByLane([...supaByDay.get(dayIso(yesterday)), ...mongoY]),
    ySupa: supaY.usd, yMongo: monY.usd,
    mtd: sumByLane([...[...supaByDay.values()].flat(), ...mongoMtd]),
    mtdLabel: `${dayIso(monthStart).slice(5)}..${dayIso(yesterday).slice(5)}`,
    today,
  };
}

async function collectChained(db, now) {
  const { RUNS_COLLECTION } = await import('../lib/translate-batch-seam.mjs');
  const runs = db.collection(RUNS_COLLECTION);
  const since = new Date(now.getTime() - 864e5);
  const [open, parked, parked24, complete24] = await Promise.all([
    runs.countDocuments({ mode: 'chained', phase: { $nin: ['complete', 'parked', 'failed'] } }),
    runs.countDocuments({ mode: 'chained', phase: 'parked' }),
    runs.countDocuments({ mode: 'chained', phase: 'parked', updated_at: { $gte: since } }),
    runs.countDocuments({ mode: 'chained', phase: 'complete', updated_at: { $gte: since } }),
  ]);
  let log = { lastTick: null };
  if (fs.existsSync(CHAINED_LOG)) {
    // Only the tail: the stamp we want is the last one.
    const st = fs.statSync(CHAINED_LOG);
    const fd = fs.openSync(CHAINED_LOG, 'r');
    const len = Math.min(st.size, 256 * 1024);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len);
    fs.closeSync(fd);
    log = parseChainedLog(buf.toString('utf8'), st.mtime);
  }
  return { ...log, open, parked, parked24, complete24 };
}

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000, ...opts });
}

/** claude-job.sh's sessions: tmux job-* (running) and logs touched in 24 h (finished). */
function collectJobs(now) {
  let tmux = '';
  try { tmux = sh('tmux', ['ls']); } catch { tmux = ''; } // no server = no sessions
  const running = new Set(tmux.split('\n').map(l => l.match(/^job-([^:]+):/)?.[1]).filter(Boolean));
  const lastLine = f => {
    try {
      const lines = fs.readFileSync(f, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
      return lines.at(-1) || '';
    } catch { return ''; }
  };
  const out = { running: [], finished: [] };
  for (const name of running) out.running.push({ name, state: 'running', last: lastLine(path.join(JOB_LOG_DIR, `${name}.log`)) });
  if (fs.existsSync(JOB_LOG_DIR)) {
    for (const f of fs.readdirSync(JOB_LOG_DIR).filter(f => f.endsWith('.log'))) {
      const name = f.slice(0, -4);
      if (running.has(name)) continue;
      const st = fs.statSync(path.join(JOB_LOG_DIR, f));
      if (now - st.mtime > 864e5) continue;
      out.finished.push({ name, state: 'done', last: lastLine(path.join(JOB_LOG_DIR, f)) });
    }
  }
  return out;
}

function collectDecisions() {
  let b64;
  try { b64 = sh('gh', ['api', `repos/${OPS_REPO}/contents/DECISIONS-PENDING.md`, '--jq', '.content']); } catch {
    return { error: 'ops repo unreadable from the box — skipped' };
  }
  return { rows: parseDecisions(Buffer.from(b64.replace(/\s/g, ''), 'base64').toString('utf8')) };
}

function collectHolds(now) {
  const prs = JSON.parse(sh('gh', ['pr', 'list', '--repo', 'Embassy-of-the-Free-Mind/sourcelibrary-v2', '--label', 'tier:hold',
    '--state', 'open', '--limit', '200', '--json', 'number,title,createdAt']));
  return prs.filter(p => now - new Date(p.createdAt) > 864e5).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
}

const settle = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message }; } };

// ───────────────────────────────────────────── delivery

function readEnvFile(f) {
  const env = {};
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

/** One-way Bot API send. Plain text (no parse_mode): the digest is not markdown. */
async function sendTelegram(text) {
  if (!fs.existsSync(TELEGRAM_ENV)) throw new Error(`no ${TELEGRAM_ENV}`);
  const env = readEnvFile(TELEGRAM_ENV);
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.DIGEST_CHAT_ID || (env.ALLOWED_USER_IDS || '').split(',')[0].trim();
  if (!token || !chatId) throw new Error('bridge .env has no TELEGRAM_BOT_TOKEN / chat id');
  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  });
  const body = await resp.json().catch(() => ({}));
  if (!body.ok) throw new Error(`telegram refused (${resp.status} ${body.description || ''})`); // never echo the token
  return 'telegram';
}

function sendGithub(text) {
  const repo = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
  const found = JSON.parse(sh('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--search', `"${DIGEST_ISSUE_TITLE}" in:title`, '--json', 'number,title']))
    .find(i => i.title === DIGEST_ISSUE_TITLE);
  let n = found?.number;
  if (!n) {
    const url = sh('gh', ['issue', 'create', '--repo', repo, '--title', DIGEST_ISSUE_TITLE,
      '--body', 'Standing issue: scripts/maintenance/daily-digest.mjs comments here once a day when Telegram is unavailable (#5441).']).trim();
    n = Number(url.split('/').pop());
  }
  sh('gh', ['issue', 'comment', String(n), '--repo', repo, '--body', '```\n' + text + '\n```']);
  return `github #${n}`;
}

// ───────────────────────────────────────────── main

async function main() {
  const args = process.argv.slice(2);
  const arg = k => args.find(a => a.startsWith(`--${k}=`))?.split('=')[1];
  const dry = args.includes('--dry-run');
  const now = arg('date') ? new Date(`${arg('date')}T06:30:00Z`) : new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterday = addDays(todayStart, -1);

  const { MongoClient, ObjectId } = await import('mongodb');
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set — run with --env-file=/root/sourcelibrary/.env.production.local');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  let data;
  try {
    const [spend, chained] = await Promise.all([
      settle(() => collectSpend(db, ObjectId, yesterday)),
      settle(() => collectChained(db, now)),
    ]);
    data = {
      now: now.toISOString(), date: dayIso(todayStart), yesterday: dayIso(yesterday),
      spend, chained,
      jobs: await settle(() => collectJobs(now)),
      speedtest: fs.existsSync(SPEEDTEST_TICKS) ? parseSpeedtest(fs.readFileSync(SPEEDTEST_TICKS, 'utf8')) : null,
      gpu: fs.existsSync(GPU_LOG) ? (parseGpuLog(fs.readFileSync(GPU_LOG, 'utf8')) ?? { error: 'no block in watchdog log' }) : { error: `no ${GPU_LOG}` },
      decisions: collectDecisions(),
      holds: await settle(() => collectHolds(now)),
    };
  } finally {
    await client.close();
  }

  const text = formatDigest(data);
  const publicText = formatDigest(data, { publicSafe: true });
  console.log(args.includes('--public') ? publicText : text);
  if (dry) return;

  let via = null;
  const errors = [];
  if (arg('via') !== 'github') {
    try { via = await sendTelegram(text); } catch (e) { errors.push(`telegram: ${e.message}`); }
  }
  if (!via) {
    try { via = sendGithub(publicText); } catch (e) { errors.push(`github: ${e.message}`); }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${data.date}.txt`), `${text}\n\n[delivered via ${via || 'NOTHING'}${errors.length ? `; ${errors.join('; ')}` : ''}]\n`);
  console.log(`\n[daily-digest] delivered via ${via || 'NOTHING'}${errors.length ? ` (${errors.join('; ')})` : ''}`);
  if (!via) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch(e => { console.error('[daily-digest] FAILED:', e.message); process.exit(1); });
}
