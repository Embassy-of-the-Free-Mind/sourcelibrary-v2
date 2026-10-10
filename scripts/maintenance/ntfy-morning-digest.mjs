#!/usr/bin/env node
/**
 * ntfy-morning-digest — the ONE default-priority ntfy message of the day (#6181).
 *
 * PRIOR ART: scripts/maintenance/daily-digest.mjs on branch job-daily-digest (PR #5445, #5441,
 *   unmerged, tier:hold since 2026-10-01) — delivers by Telegram/GitHub, scans a month of
 *   Supabase usage per run, and reads the private ops repo's DECISIONS-PENDING.md; Derek's
 *   2026-10-07 tiering asks for ntfy, decisions.txt, and both job boxes. Its "unreadable is said,
 *   never omitted" rule is kept here. scripts/workers/daily-health-snapshot.mjs — corpus counts
 *   (pages translated/OCR'd), not ops; now low priority. scripts/audit/spend-daily.mjs — its
 *   07:00Z ops_reports row (spend-daily-<day>) is READ for the envelope + dial verdict, not
 *   recomputed. scripts/lib/spend-guard.mjs — readDailyBudgetUsd() for the dial.
 *   /root/bin/claude-job.sh status — job states (LIVE hb age, DIED, GAVE-UP), parsed here.
 *
 * What it says (≤ 15 body lines, plain text, full URLs):
 *   - jobs that finished in the ntfy window, on BOTH boxes (from the topic's own history:
 *     ntfy.sh keeps ~12 h, so at 06:00Z that is roughly 18:00–06:00Z), and the ones that did not land
 *   - yesterday's metered Gemini spend (both stores) vs the dial, plus the latest spend-daily verdict
 *     and envelopes at ≥ 90 % of cap (that row is written at 07:00Z, so at 06:00Z it is a day older)
 *   - decisions waiting: new lines in decisions.txt + decision pages from both boxes, top 3 with URLs
 *   - anything stuck: LIVE jobs with a stale heartbeat, DIED jobs, waiter scripts still running
 *   - tier:hold PRs waiting on Derek
 *
 * Every source is read independently; one that fails prints "<section>: unreadable (<why>)" and the
 * digest still goes out. Reads only; no model call; writes nothing but the one ntfy message.
 *
 * Run:
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/ntfy-morning-digest.mjs --dry-run
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/ntfy-morning-digest.mjs
 * Env: MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY; NTFY_DIGEST_TOPIC overrides the topic (testing).
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const MAX_BODY_LINES = 15;
const TOPIC = process.env.NTFY_DIGEST_TOPIC || 'https://ntfy.sh/sourcelibrary-uptime';
const REPO = 'Embassy-of-the-Free-Mind/sourcelibrary-v2';
const GH = `https://github.com/${REPO}`;
const JOB_SH = '/root/bin/claude-job.sh';
const DECISIONS = '/root/claude-jobs/decisions.txt';
const HB_STALE_MIN = 15;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';

// ───────────────────────────────────────────── pure helpers (unit-tested)

const clip = (s, n) => { s = String(s ?? '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const money = (n) => '$' + (n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2));
const list = (names, n = 4) => names.slice(0, n).join(', ') + (names.length > n ? ` +${names.length - n}` : '');
/** "(#5660)" → full URL, so the phone can tap it. */
export const issueUrl = (s) => { const m = String(s).match(/#(\d{3,5})/); return m ? `${GH}/issues/${m[1]}` : null; };

/** Bucket the topic's history (ntfy JSON lines) into job outcomes and decision pages. */
export function classifyNtfy(jsonl) {
  const out = { landed: [], notLanded: [], decisions: [], since: null, total: 0 };
  for (const line of String(jsonl || '').split('\n')) {
    let m; try { m = JSON.parse(line); } catch { continue; }
    if (m.event !== 'message') continue;
    out.total++;
    if (out.since == null || m.time < out.since) out.since = m.time;
    const t = m.title || '';
    let x;
    if ((x = t.match(/^Job done \+ landed: (.+)$/))) out.landed.push(x[1]);
    else if ((x = t.match(/^Job (?:finished but did NOT land|GAVE UP|DIED twice, not resumed): (.+)$/))) out.notLanded.push(x[1]);
    else if ((x = t.match(/^Job (.+): (\d+) decision\(s\) for Derek$/))) out.decisions.push({ name: x[1], n: Number(x[2]) });
  }
  return out;
}

/** decisions.txt rows ("YYYY-MM-DD | job | DECISION: …") dated on/after `sinceDay`, newest first. */
export function recentDecisions(text, sinceDay) {
  return String(text || '').split('\n')
    .map((l) => l.match(/^(\d{4}-\d\d-\d\d) \| ([^|]+) \| DECISION: (.*)$/))
    .filter((m) => m && m[1] >= sinceDay)
    .map((m) => ({ day: m[1], job: m[2].trim(), text: m[3].trim() }))
    .reverse();
}

/** `claude-job.sh status` lines → what is stuck. */
export function stuckJobs(statusText, staleMin = HB_STALE_MIN) {
  const stuck = [];
  for (const l of String(statusText || '').split('\n')) {
    let m;
    if ((m = l.match(/^LIVE\s+(\S+)\s+hb=(\d+)m/)) && Number(m[2]) >= staleMin) stuck.push(`${m[1]} (LIVE, heartbeat ${m[2]}m old)`);
    else if ((m = l.match(/^DIED\s+(\S+)/))) stuck.push(`${m[1]} (DIED)`);
  }
  return stuck;
}

/** Envelopes from a spend-daily row at ≥ 90 % and < 100 % of cap (over-cap ones are closed by the gate). */
export function nearCap(envelopes = []) {
  return envelopes
    .filter((e) => e.budget_usd > 0 && e.spent_usd != null && e.spent_usd / e.budget_usd >= 0.9 && e.spent_usd < e.budget_usd)
    .map((e) => `${e.tag} ${Math.round((e.spent_usd / e.budget_usd) * 100)}% (${money(e.spent_usd)}/${money(e.budget_usd)})`);
}

/**
 * Compose the body. Each section is data or { error }; an error prints "unreadable", never nothing
 * (an omitted line reads as "all clear").
 */
export function formatDigest(d) {
  const L = [];
  const un = (label, e) => `${label}: unreadable (${clip(e, 80)})`;

  const n = d.ntfy;
  if (n?.error) L.push(un('Jobs overnight', n.error));
  else {
    const from = n.since ? new Date(n.since * 1000).toISOString().slice(11, 16) + 'Z' : '?';
    L.push(`Jobs since ${from}: ${n.landed.length} landed${n.landed.length ? ` (${list(n.landed)})` : ''}`);
    if (n.notLanded.length) L.push(`  did NOT land / gave up: ${n.notLanded.length} (${list(n.notLanded)})`);
  }

  const s = d.spend;
  if (s?.error) L.push(un(`Spend ${d.yesterday}`, s.error));
  else L.push(`Spend ${d.yesterday}: ${money(s.usd)} metered (both stores${s.partial ? ', PARTIAL' : ''}) · dial ${s.dial == null ? 'UNSET' : money(s.dial) + '/day outside envelopes'}`);
  const r = d.spendDaily;
  if (r?.error) L.push(un('Spend check', r.error));
  else {
    L.push(`  check ${r.day}: ${clip(r.line.replace(/^spend check: /, ''), 150)}`);
    if (r.nearCap.length) L.push(`  envelopes ≥90% of cap: ${list(r.nearCap, 3)}`);
  }

  const dec = d.decisions;
  if (dec?.error) L.push(un('Decisions', dec.error));
  else {
    const pages = d.ntfy?.error ? '' : ` · ${d.ntfy.decisions.reduce((a, x) => a + x.n, 0)} paged from both boxes since ${d.ntfyFrom}`;
    L.push(`Decisions logged since ${dec.sinceDay}: ${dec.rows.length} on hetzner${pages}`);
    for (const x of dec.rows.slice(0, 3)) {
      const url = issueUrl(x.text);
      L.push(`  ${x.job}: ${clip(x.text.replace(/\s*\(#\d+\)\s*$/, ''), 150)}${url ? ' ' + url : ''}`);
    }
  }

  const st = d.stuck;
  if (st?.error) L.push(un('Stuck', st.error));
  else L.push(st.items.length ? `Stuck: ${list(st.items, 3)}` : 'Stuck: nothing (no stale heartbeat, no DIED job)');
  if (d.waiters && !d.waiters.error && d.waiters.length) L.push(`  waiters running: ${list(d.waiters, 3)}`);

  const h = d.holds;
  if (h?.error) L.push(un('tier:hold PRs', h.error));
  else L.push(`tier:hold PRs waiting: ${h.length} ${GH}/pulls?q=is%3Aopen+label%3Atier%3Ahold`);

  if (L.length > MAX_BODY_LINES) return [...L.slice(0, MAX_BODY_LINES - 1), '…(cut at 15 lines)'].join('\n');
  return L.join('\n');
}

// ───────────────────────────────────────────── collectors (I/O)

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60000 });
const settle = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message || String(e) }; } };

async function readNtfy() {
  const res = await fetch(`${TOPIC}/json?poll=1&since=24h`, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
  return classifyNtfy(await res.text());
}

/** Yesterday's metered Gemini spend, BOTH stores (they are disjoint per row — sum, never pick). */
async function readSpend(db, ObjectId, dayStart, dayEnd) {
  const { readDailyBudgetUsd } = await import('../lib/spend-guard.mjs');
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  const id = (d) => ObjectId.createFromTime(Math.floor(d.getTime() / 1000));
  const [m] = await db.collection('gemini_usage').aggregate([
    { $match: { _id: { $gte: id(dayStart), $lt: id(dayEnd) } } },
    { $group: { _id: null, usd: { $sum: { $ifNull: ['$cost_usd', 0] } } } },
  ], { maxTimeMS: 120000 }).toArray();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
  let supa = 0, partial = false;
  for (let from = 0; ; from += 1000) {
    if (from >= 200_000) { partial = true; break; } // a lower bound, said as PARTIAL
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/gemini_usage?select=cost_usd&timestamp=gte.${dayStart.toISOString()}&timestamp=lt.${dayEnd.toISOString()}&order=id.asc`,
      { headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` }, signal: AbortSignal.timeout(30000) });
    if (!resp.ok && resp.status !== 206) throw new Error(`Supabase HTTP ${resp.status}`);
    const rows = await resp.json();
    for (const r of rows) supa += r.cost_usd || 0;
    if (rows.length < 1000) break;
  }
  return { usd: (m?.usd || 0) + supa, partial, dial: readDailyBudgetUsd(control) };
}

async function readSpendDaily(db) {
  const r = await db.collection('ops_reports').find({ type: 'spend_daily' }).sort({ day: -1 }).limit(1).next();
  if (!r) throw new Error('no spend_daily row');
  return { day: r.day, line: r.line || r.status, nearCap: nearCap(r.checks?.envelopes?.envelopes) };
}

function readDecisions(sinceDay) {
  return { sinceDay, rows: recentDecisions(fs.readFileSync(DECISIONS, 'utf8'), sinceDay) };
}

function readStuck() {
  return { items: stuckJobs(sh(JOB_SH, ['status', '3'])) };
}

function readWaiters() {
  return sh('ps', ['-eo', 'args=']).split('\n')
    .filter((a) => /^(\/bin\/)?(ba)?sh \S*waiter\S*/.test(a) || /^node \S*waiter\S*/.test(a))
    .map((a) => path.basename(a.split(/\s+/)[1]));
}

function readHolds() {
  return JSON.parse(sh('gh', ['pr', 'list', '--repo', REPO, '--label', 'tier:hold', '--state', 'open', '--limit', '200', '--json', 'number']));
}

// ───────────────────────────────────────────── main

async function main() {
  const dry = process.argv.includes('--dry-run');
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yStart = new Date(todayStart.getTime() - 864e5);
  const day = (d) => d.toISOString().slice(0, 10);

  let db = null, client = null, ObjectId = null, dbError = null;
  try {
    const mongo = await import('mongodb');
    ObjectId = mongo.ObjectId;
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI not set');
    client = new mongo.MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
    await client.connect();
    db = client.db('bookstore');
  } catch (e) { dbError = e.message; }

  const ntfy = await settle(readNtfy);
  const data = {
    yesterday: day(yStart),
    ntfy,
    ntfyFrom: ntfy.since ? new Date(ntfy.since * 1000).toISOString().slice(11, 16) + 'Z' : '?',
    spend: db ? await settle(() => readSpend(db, ObjectId, yStart, todayStart)) : { error: dbError },
    spendDaily: db ? await settle(() => readSpendDaily(db)) : { error: dbError },
    decisions: await settle(() => readDecisions(day(yStart))),
    stuck: await settle(readStuck),
    waiters: await settle(readWaiters),
    holds: await settle(readHolds),
  };
  if (client) await client.close().catch(() => {});

  const title = `Morning digest ${day(now)}`; // ASCII: HTTP header
  const body = formatDigest(data);
  console.log(`${title}\n${body}`);
  if (dry) return;
  try {
    const res = await fetch(TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: 'default', Tags: 'sunrise' },
      body, signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    console.log('[morning-digest] sent');
  } catch (e) {
    console.error(`[morning-digest] ntfy send failed: ${e.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((e) => { console.error('[morning-digest] FAILED:', e.message); process.exit(1); });
}
