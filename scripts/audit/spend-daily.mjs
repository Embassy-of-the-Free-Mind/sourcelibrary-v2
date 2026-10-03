#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/paid-vs-got.mjs — the daily Gemini ledger (#5499). Check (a) READS its
 * stored ops_reports row for yesterday rather than re-running it. scripts/maintenance/
 * gpu-lease-watchdog.mjs (+ --hetzner, #5736/PR #5741) — stops expired/idle GPUs and FLAGS
 * unleased/idle servers into ops_reports `work-board:infra-*`. Check (b) reads those flags; the
 * rules are not rebuilt here. scripts/lib/spend-guard.mjs — readScopeEnvelopes() and
 * getScopeSpendUsd() are the gate's own envelope meter, reused for (c). scripts/maintenance/
 * set-scope.mjs --show — prints each envelope's spend, but no 24 h window, no pages, no verdict.
 * scripts/audit/spend-reconcile.mjs — billed-vs-metered gap over 7 days (its own 08:30 cron and
 * email). Its googleToken()/bigQuery()/BILLING_EXPORT are reused for (d), which asks something
 * else: was yesterday's BILL inside what was authorised (the dial plus envelope spend)?
 * scripts/maintenance/daily-digest.mjs (#5441) — yesterday's spend vs the dial, as a message. It
 * is not on main, and it has no verdict. None of them gives ONE pass/fail line over all four
 * questions, which is what /admin/work shows.
 *
 * spend-daily — the daily spend check (#5743). No model call. One verdict from four checks:
 *
 *   (a) LEDGER    paid-vs-got's verdict for yesterday (FAIL/WARN carried, missing row = UNKNOWN).
 *   (b) MACHINES  servers flagged by the lease watchdog (no lease, expired, idle), with €/month,
 *                 plus RunPod pods (lease = `until-YYYYMMDDTHHMMZ` in the pod name, the #5600
 *                 watchdog's grammar). A flag is FAIL. A provider the watchdog cannot read, or a
 *                 flag document older than 3 h, is UNKNOWN. An unread provider is not an empty one.
 *   (c) ENVELOPES every allow_scopes envelope. FAIL: more than $1 paid on its books in the last 24 h
 *                 (realtime by call time, batch by COLLECTION time, OCR+translation lanes) and zero
 *                 pages written on them in that window. WARN: 90–100 % of cap; open, more than 3 days
 *                 old and no OCR/translation spend on its books for 3 days (stored spend: authority
 *                 nobody is using). Attribution is by book, as the gate meters it, so envelopes
 *                 sharing books share spend.
 *                 INFO: at or over cap and still configured (the gate refuses it; clutter).
 *   (d) DIAL      yesterday's metered spend OUTSIDE every envelope vs the dial (FAIL above
 *                 max(1.5 × dial, dial + $5): the known ungated holes are ~$1.6/day), and the
 *                 invoice (BigQuery export) vs what was authorised (dial + envelope-attributed
 *                 spend): FAIL when billed > 1.25 × authorised + $10, for D-1 and D-2. The export
 *                 lags, so a partial D-1 can only under-report. It cannot raise a false FAIL.
 *
 * Overall: FAIL if any check FAILs, else UNKNOWN if any could not be read, else WARN, else PASS.
 * Exit 1 = FAIL, 2 = UNKNOWN (could not measure), 0 = PASS/WARN. Never branch on != 0.
 *
 * WRITES (--apply only): one ops_reports document `spend-daily-<day>` (type `spend_daily`), read by
 * /admin/work as the one "spend check" line, and on FAIL one email (Resend, the watchdog's sender)
 * unless the same set of failures was mailed in the last 7 days. State: SPEND_DAILY_STATE_DIR
 * (default ~/.spend-daily/state.json). It stops, deletes, or changes nothing else.
 *
 * --week prints the facts the Monday cut-list job needs (scripts/audit/spend-weekly-brief.md), so that
 * job only composes and posts: the last 7 daily checks and ledgers, every envelope with its spend, its
 * week of paid and pages summed from the stored daily rows (never a 7-day scan of `pages`, which
 * exceeds Mongo's time limit), and its owning issue, every running machine with its price, and the vendor bills
 * that can be read ($0 APIs: BigQuery Gemini export, Vercel FOCUS charges; Atlas and Cloudflare have
 * no token on this box, so they are reported as not readable).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/spend-daily.mjs            # dry run
 *   node --env-file=.env.production.local scripts/audit/spend-daily.mjs --apply    # cron 07:00Z
 *   node --env-file=.env.production.local scripts/audit/spend-daily.mjs --week [--json]
 * Env: MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY (required); GOOGLE_SERVICE_ACCOUNT_JSON (billing),
 * RUNPOD_API_KEY, SCALEWAY_SECRET_KEY, VERCEL_API_TOKEN, RESEND_API_KEY, ALERT_EMAIL (optional,
 * each missing one is reported as not readable).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MongoClient, ObjectId } from 'mongodb';
import { readScopeEnvelopes, getScopeSpendUsd } from '../lib/spend-guard.mjs';
import { laneOf, REPORT_TYPE as PVG_TYPE } from './paid-vs-got.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const REPORT_TYPE = 'spend_daily';
export const ENVELOPE_NOISE_USD = 1;
export const NEAR_CAP = 0.9;
export const STORED_DAYS = 3;
export const INFRA_STALE_H = 3;
export const MAIL_COOLDOWN_DAYS = 7;
const PLACEHOLDER = new Set(['submitted', 'pending', 'duplicate', 'unknown']);
const INFRA_SOURCES = ['infra-hetzner', 'infra-scaleway'];

const ms = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN);
const r2 = (n) => Math.round(n * 100) / 100;
const $ = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const clean = (v) => (v || '').replace(/\\n/g, '').trim();
const dayStr = (t) => new Date(t).toISOString().slice(0, 10);

// ─────────────────────────────────────────── pure judgement (pinned by tests/unit/spend-daily.test.ts)

/** (a) paid-vs-got's stored row → one check. */
export function ledgerCheck(row, day) {
  if (!row) return { status: 'UNKNOWN', lines: [`paid-vs-got wrote no row for ${day} (cron 06:10Z) — the ledger did not run`] };
  const h = row.headline || [];
  const paid = h.reduce((a, x) => a + (x.paid_usd || 0), 0);
  const waste = h.reduce((a, x) => a + (x.waste_usd || 0), 0);
  const pages = h.reduce((a, x) => a + (x.pages_written || 0), 0);
  const v = row.verdict || {};
  const lines = [`${$(paid)} paid → ${pages.toLocaleString('en-US')} pages; ${$(waste)} measured waste (${paid > 0 ? (100 * waste / paid).toFixed(1) : '0.0'}%)`];
  for (const f of v.fails || []) lines.push(`FAIL ${f}`);
  for (const w of v.warns || []) lines.push(`WARN ${w}`);
  const status = v.status === 'FAIL' ? 'FAIL' : v.status === 'WARN' ? 'WARN' : v.status === 'PASS' ? 'PASS' : 'UNKNOWN';
  return { status, lines, paid_usd: r2(paid), waste_usd: r2(waste), pages };
}

/** RunPod pods: the #5600 watchdog's lease grammar is a deadline in the name. */
export function podDeadline(name) {
  const m = String(name || '').match(/until-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})Z/);
  return m ? new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`) : null;
}
export function podFlags(pods, now = new Date()) {
  const flags = [];
  for (const p of pods) {
    if (p.desiredStatus !== 'RUNNING') continue;
    const until = podDeadline(p.name);
    const usdMonth = r2((p.costPerHr || 0) * 730);
    if (!until) flags.push({ provider: 'runpod', name: p.name, kind: 'no-lease', usd_month: usdMonth, reason: 'running RunPod pod with no until-<deadline> in its name' });
    else if (until.getTime() < now.getTime() - HOUR) flags.push({ provider: 'runpod', name: p.name, kind: 'expired', usd_month: usdMonth, reason: `deadline ${until.toISOString()} passed and the pod is still running` });
  }
  return flags;
}

/** (b) watchdog flag documents + RunPod → one check. `infraDocs` keyed by box. `pods` null = unread. */
export function machinesCheck({ infraDocs = {}, pods = null, podsError = null, now = new Date() }) {
  const lines = [], flags = [], unknown = [];
  for (const src of INFRA_SOURCES) {
    const d = infraDocs[src];
    if (!d) { unknown.push(`${src}: no flag document — the watchdog pass is not running (#5741 not on main?)`); continue; }
    const age = (now.getTime() - ms(d.generated_at)) / HOUR;
    if (!(age <= INFRA_STALE_H)) { unknown.push(`${src}: flags are ${age.toFixed(1)} h old — the watchdog pass has stopped`); continue; }
    for (const f of d.flags || []) {
      if (f.kind === 'unwatched') { unknown.push(`${src}: ${f.reason || 'provider NOT watched'}`); continue; }
      flags.push({ provider: f.provider || src.replace('infra-', ''), name: f.name, kind: f.kind, eur_month: f.eur_month ?? null, reason: f.reason, owner: f.owner ?? null });
    }
  }
  if (pods == null) unknown.push(`runpod: ${podsError || 'not read'}`);
  else flags.push(...podFlags(pods, now));
  const eur = flags.reduce((a, f) => a + (f.eur_month || 0), 0);
  const usd = flags.reduce((a, f) => a + (f.usd_month || 0), 0);
  flags.sort((a, b) => (b.eur_month || b.usd_month || 0) - (a.eur_month || a.usd_month || 0));
  for (const f of flags) lines.push(`FAIL ${f.provider} ${f.name}: ${f.kind}${f.eur_month != null ? ` · €${Math.round(f.eur_month)}/month` : ''}${f.usd_month != null ? ` · $${Math.round(f.usd_month)}/month` : ''} — ${f.reason}`);
  for (const u of unknown) lines.push(`UNKNOWN ${u}`);
  if (!flags.length && !unknown.length) lines.push('no idle or unleased machine flagged');
  return { status: flags.length ? 'FAIL' : unknown.length ? 'UNKNOWN' : 'PASS', lines, flags, eur_month: r2(eur), usd_month: r2(usd) };
}

/** The issue an envelope belongs to: `-NNNN` at the end of its tag, else the first #NNNN in its trail. */
export function envelopeIssue(tag, scope = {}) {
  const m = String(tag).match(/-(\d{4,5})[a-z]?$/);
  if (m) return Number(m[1]);
  const t = `${scope.created_by || ''} ${scope.updated_by || ''}`.match(/#(\d{3,5})\b/);
  return t ? Number(t[1]) : null;
}

/**
 * (c) one envelope → its level. `e` carries: budget_usd, spent_usd (gate's meter, since created_at),
 * paid24_usd (OCR+translation, paid-vs-got's clocks), pages24, last_spend_at, created_at.
 */
export function envelopeLevel(e, now = new Date()) {
  const pct = e.budget_usd > 0 ? e.spent_usd / e.budget_usd : 0;
  if (e.meter_error) return { level: 'UNKNOWN', why: `meter unreadable: ${e.meter_error}` };
  if (e.paid24_usd > ENVELOPE_NOISE_USD && !e.pages24) return { level: 'FAIL', why: `${$(e.paid24_usd)} paid in 24 h, 0 pages written` };
  if (pct >= 1) return { level: 'INFO', why: `spent ${$(e.spent_usd)} of ${$(e.budget_usd)} (${Math.round(pct * 100)}%) — closed by the meter, still configured` };
  if (pct >= NEAR_CAP) return { level: 'WARN', why: `${Math.round(pct * 100)}% of cap (${$(e.spent_usd)} / ${$(e.budget_usd)}) — top up or close` };
  const age = now.getTime() - ms(e.created_at);
  const idle = e.last_spend_at ? now.getTime() - ms(e.last_spend_at) : Infinity;
  if (age > STORED_DAYS * DAY && idle > STORED_DAYS * DAY) {
    return { level: 'WARN', why: `stored spend: ${$(e.budget_usd - e.spent_usd)} unspent, no OCR/translation spend on its books for ${idle === Infinity ? `${STORED_DAYS}+ d` : `${Math.floor(idle / DAY)} d`}` };
  }
  return { level: 'ok', why: `${$(e.spent_usd)} / ${$(e.budget_usd)}; 24 h: ${$(e.paid24_usd)} → ${e.pages24 || 0} pages` };
}

/**
 * --week: an envelope's week from the stored daily rows (each holds its 24 h paid and pages), so the
 * weekly job never re-counts `pages`. Today's run stands in when no stored row has the envelope.
 */
export function weekOf(tag, dailies, today = { pages24: 0, paid24_usd: 0 }) {
  let pages = 0, paid = 0, days = 0;
  for (const d of dailies) {
    const e = (d.checks?.envelopes?.envelopes || []).find((x) => x.tag === tag);
    if (!e) continue;
    pages += e.pages24 || 0; paid += e.paid24_usd || 0; days++;
  }
  if (!days) return { pages_week: today.pages24 || 0, paid_week_usd: r2(today.paid24_usd || 0), days_counted: 1, from_today_only: true };
  return { pages_week: pages, paid_week_usd: r2(paid), days_counted: days };
}

export function envelopesCheck(envs, now = new Date()) {
  const rows = envs.map((e) => ({ ...e, ...envelopeLevel(e, now) }));
  const n = (l) => rows.filter((r) => r.level === l);
  const lines = [];
  for (const l of ['FAIL', 'UNKNOWN', 'WARN']) for (const r of n(l)) lines.push(`${l} ${r.tag}${r.issue ? ` (#${r.issue})` : ''}: ${r.why}`);
  const info = n('INFO');
  if (info.length) lines.push(`INFO ${info.length} envelope(s) at or over cap still configured: ${info.map((r) => r.tag).join(', ')}`);
  const open = rows.filter((r) => r.level !== 'INFO');
  lines.unshift(`${rows.length} envelopes, ${open.length} with room: ${$(open.reduce((a, r) => a + Math.max(0, r.budget_usd - r.spent_usd), 0))} authorised and unspent`);
  const status = n('FAIL').length ? 'FAIL' : n('UNKNOWN').length ? 'UNKNOWN' : n('WARN').length ? 'WARN' : 'PASS';
  return { status, lines, envelopes: rows };
}

/**
 * The highest dial in force at any moment of [a, b): the value at `a`, and every value set inside the
 * window. `revs` are system_config_revisions rows (`prior` = the whole doc before each change),
 * `current` today's value. The highest, because a ceiling raised for an hour allowed that hour's spend.
 */
export function dialDuring(revs, current, a, b) {
  const sorted = revs.filter((r) => ms(r.created_at) >= a).sort((x, y) => ms(x.created_at) - ms(y.created_at));
  const after = (i) => (i + 1 < sorted.length ? sorted[i + 1].prior?.daily_budget_usd : current);
  const vals = [sorted.length ? sorted[0].prior?.daily_budget_usd : current];
  sorted.forEach((r, i) => { if (ms(r.created_at) < b) vals.push(after(i)); });
  const nums = vals.map(Number).filter((v) => Number.isFinite(v));
  return nums.length ? Math.max(...nums) : 0;
}

/** (d) yesterday (and the day before) against the dial in force that day, and the invoice. */
export function dialCheck({ days, billedUnreadable = null }) {
  const lines = [], fails = [];
  for (const d of days) {
    const dial = d.dial_usd || 0;
    const limit = dial ? Math.max(1.5 * dial, dial + 5) : 5;
    const authorised = dial + d.envelope_usd;
    const parts = [`${d.day}: metered ${$(d.metered_usd)} (in envelopes ${$(d.envelope_usd)}, outside ${$(d.outside_usd)}) vs dial ${$(dial)} (highest in force that day)`];
    if (d.primary && d.outside_usd > limit) fails.push(`${d.day}: ${$(d.outside_usd)} spent outside every envelope against a ${$(dial)} dial (limit ${$(limit)})`);
    if (d.billed_usd != null) {
      parts.push(`billed ${$(d.billed_usd)} vs authorised ${$(authorised)}`);
      if (d.billed_usd > 1.25 * authorised + 10) fails.push(`${d.day}: billed ${$(d.billed_usd)} > 1.25 × authorised ${$(authorised)} + $10 — spend the dial and envelopes did not see`);
    }
    lines.push(parts.join('; '));
  }
  if (billedUnreadable) lines.push(`UNKNOWN invoice not readable: ${billedUnreadable}`);
  for (const f of fails) lines.push(`FAIL ${f}`);
  return { status: fails.length ? 'FAIL' : billedUnreadable ? 'UNKNOWN' : 'PASS', lines, fails };
}

export function overall(checks) {
  const s = Object.values(checks).map((c) => c.status);
  return s.includes('FAIL') ? 'FAIL' : s.includes('UNKNOWN') ? 'UNKNOWN' : s.includes('WARN') ? 'WARN' : 'PASS';
}

/** The one line /admin/work shows. */
export function summaryLine(status, checks) {
  const bits = [];
  const L = checks.ledger;
  if (L.paid_usd != null) bits.push(`${$(L.paid_usd)} paid yesterday, ${L.paid_usd > 0 ? (100 * L.waste_usd / L.paid_usd).toFixed(1) : '0.0'}% waste`);
  const M = checks.machines;
  if (M.flags.length) bits.push(`${M.flags.length} machine(s) flagged${M.eur_month ? ` €${Math.round(M.eur_month)}/mo` : ''}${M.usd_month ? ` $${Math.round(M.usd_month)}/mo` : ''}`);
  const E = checks.envelopes.envelopes || [];
  const ef = E.filter((e) => e.level === 'FAIL').length, ew = E.filter((e) => e.level === 'WARN').length;
  if (ef) bits.push(`${ef} envelope(s) paying for no pages`);
  if (ew) bits.push(`${ew} envelope(s) near cap or idle`);
  if (checks.dial.fails?.length) bits.push('dial/invoice over');
  const unk = Object.entries(checks).filter(([, c]) => c.status === 'UNKNOWN').map(([k]) => k);
  if (unk.length) bits.push(`not readable: ${unk.join(', ')}`);
  return `spend check: ${status}${bits.length ? ' — ' + bits.join(' · ') : ''}`;
}

/** Same failures as last time → no second email inside the cooldown. */
export function shouldMail({ status, fingerprint, state, now = new Date() }) {
  if (status !== 'FAIL') return false;
  if (!state?.last_mailed_at) return true;
  if (state.fingerprint !== fingerprint) return true;
  return now.getTime() - ms(state.last_mailed_at) > MAIL_COOLDOWN_DAYS * DAY;
}

// ─────────────────────────────────────────── readers

/** Usage rows from the Supabase primary store. Throws on a failed page: an unreadable meter is not $0. */
async function supabaseRows(qs, select) {
  const url = clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — the primary usage store is unreadable');
  const out = [];
  for (let from = 0; ; from += 1000) {
    if (from > 600_000) throw new Error('Supabase: >600K usage rows in the window — refusing a truncated sum');
    const r = await fetch(`${url}/rest/v1/gemini_usage?${qs}&select=${select}&order=id.asc`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
      signal: AbortSignal.timeout(90_000),
    });
    if (!r.ok && r.status !== 206) throw new Error(`Supabase gemini_usage read failed (${r.status})`);
    const batch = await r.json();
    out.push(...batch);
    if (batch.length < 1000) break;
  }
  return out;
}

/**
 * Usage rows in the window from BOTH stores (disjoint per row, #3826): every row by call time since
 * `since`, plus batch rows collected in the last 24 h (submitted up to 3 days earlier).
 */
async function readUsageWindow(db, since, now) {
  const sel = 'id,book_id,timestamp,completed_at,cost_usd,mode,status,type';
  const c24 = new Date(now.getTime() - DAY).toISOString();
  const [byTime, collected] = await Promise.all([
    supabaseRows(`timestamp=gte.${since.toISOString()}`, sel),
    supabaseRows(`mode=eq.batch&completed_at=gte.${c24}&timestamp=gte.${new Date(now.getTime() - 4 * DAY).toISOString()}`, sel),
  ]);
  const mongo = await db.collection('gemini_usage').find({
    _id: { $gte: ObjectId.createFromTime(Math.floor(Math.min(since.getTime(), now.getTime() - 4 * DAY) / 1000)) },
  }, { projection: { _id: 0, book_id: 1, timestamp: 1, completed_at: 1, cost_usd: 1, mode: 1, status: 1, type: 1 } }).toArray();
  const t0 = since.getTime();
  return {
    byTime: [...byTime, ...mongo.filter((r) => ms(r.timestamp) >= t0)],
    collected: [...collected, ...mongo.filter((r) => r.mode === 'batch' && ms(r.completed_at) >= now.getTime() - DAY)],
  };
}

/** Pages written (OCR or translation) per book since `since`, from the pages' own clocks. */
async function pagesWrittenByBook(db, since) {
  const by = new Map();
  for (const field of ['ocr', 'translation']) {
    const rows = await db.collection('pages').aggregate([
      { $match: { [`${field}.updated_at`]: { $gte: since } } },
      { $group: { _id: '$book_id', n: { $sum: 1 } } },
    ], { allowDiskUse: true, maxTimeMS: 540_000 }).toArray();
    for (const r of rows) by.set(String(r._id), (by.get(String(r._id)) || 0) + r.n);
  }
  return by;
}

async function envelopeIds(db, env) {
  const ids = new Set(env.book_ids);
  if (env.collections.length) {
    for (const b of await db.collection('books').find({ collections: { $in: env.collections } }, { projection: { id: 1 } }).toArray()) ids.add(String(b.id));
  }
  return ids;
}

async function readEnvelopes(db, control, { usage, pages24, now }) {
  const scopes = control?.allow_scopes || {};
  const out = [];
  const t24 = now.getTime() - DAY;
  for (const env of readScopeEnvelopes(control)) {
    const ids = await envelopeIds(db, env);
    const idList = [...ids];
    const meter = idList.length ? await getScopeSpendUsd(db, { ids: idList, since: env.created_at }) : { usd: 0, rows: 0, meterError: null };
    const createdT = ms(env.created_at) || 0;
    let paid24 = 0, last = null, spend72 = 0;
    for (const r of usage.byTime) {
      if (!ids.has(String(r.book_id)) || ms(r.timestamp) < createdT) continue;
      spend72 += r.cost_usd || 0;
      // Only the lanes an envelope is opened for count as its activity: an eval or embedding pass
      // that touches every book (2026-10-02 17:30) would otherwise make every envelope look busy.
      const lane = laneOf(r.type);
      if (lane !== 'ocr' && lane !== 'translation') continue;
      if ((r.cost_usd || 0) > 0 && (!last || ms(r.timestamp) > ms(last))) last = r.timestamp;
      if (r.mode !== 'batch' && ms(r.timestamp) >= t24) paid24 += r.cost_usd || 0;
    }
    for (const r of usage.collected) {
      if (!ids.has(String(r.book_id)) || PLACEHOLDER.has(r.status) || ms(r.timestamp) < createdT) continue;
      const lane = laneOf(r.type);
      if (lane === 'ocr' || lane === 'translation') paid24 += r.cost_usd || 0;
    }
    let p24 = 0;
    for (const id of ids) p24 += pages24.get(id) || 0;
    const s = scopes[env.tag] || {};
    out.push({
      tag: env.tag, issue: envelopeIssue(env.tag, s), budget_usd: env.budget_usd, spent_usd: r2(meter.usd),
      meter_error: meter.meterError || null, books: ids.size, lanes: env.lanes, created_at: env.created_at,
      paid24_usd: r2(paid24), pages24: p24, spend_window_usd: r2(spend72), last_spend_at: last ? new Date(last) : null,
      why_opened: String(s.created_by || '').slice(0, 160),
    });
  }
  return out;
}

/** Invoice by day from the BigQuery billing export, or { error }. */
async function billedByDay(fromDay, toDayExcl) {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON && !fs.existsSync('/root/.gcp/spend-reconcile.json')) return { error: 'no GOOGLE_SERVICE_ACCOUNT_JSON' };
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON ||= '/root/.gcp/spend-reconcile.json';
  try {
    const sr = await import('./spend-reconcile.mjs');
    const token = await sr.googleToken();
    if (!token) return { error: 'no Google access token' };
    const { rows, error } = await sr.bigQuery(token, `
      SELECT DATE(usage_start_time) AS day, SUM(cost) AS cost
      FROM ${sr.BILLING_EXPORT.table}
      WHERE service.description LIKE '%Gemini%'
        AND usage_start_time >= TIMESTAMP('${fromDay}T00:00:00Z') AND usage_start_time < TIMESTAMP('${toDayExcl}T00:00:00Z')
      GROUP BY day`);
    if (error) return { error: `BigQuery: ${error}` };
    return { byDay: Object.fromEntries(rows.map((r) => [String(r.day), Number(r.cost || 0)])) };
  } catch (e) { return { error: e.message }; }
}

async function readPods() {
  const key = clean(process.env.RUNPOD_API_KEY);
  if (!key) return { pods: null, error: 'RUNPOD_API_KEY not set' };
  try {
    const r = await fetch('https://api.runpod.io/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: '{ myself { pods { id name desiredStatus costPerHr lastStartedAt gpuCount } } }' }),
      signal: AbortSignal.timeout(30_000),
    });
    const j = await r.json();
    if (!r.ok || j.errors) return { pods: null, error: `RunPod API ${r.status} ${JSON.stringify(j.errors || '').slice(0, 120)}` };
    return { pods: j.data?.myself?.pods || [] };
  } catch (e) { return { pods: null, error: `RunPod API: ${e.message}` }; }
}

/** --week: every Scaleway instance, with list price (€). */
async function readScaleway() {
  const key = clean(process.env.SCALEWAY_SECRET_KEY);
  if (!key) return { error: 'SCALEWAY_SECRET_KEY not set' };
  const zones = (process.env.SCALEWAY_ZONES || 'fr-par-1,fr-par-2,fr-par-3,nl-ams-1,nl-ams-2,nl-ams-3,pl-waw-1,pl-waw-2,pl-waw-3').split(',');
  const get = async (u) => { const r = await fetch(`https://api.scaleway.com${u}`, { headers: { 'X-Auth-Token': key }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };
  const servers = [];
  try {
    for (const z of zones) {
      const list = (await get(`/instance/v1/zones/${z}/servers?per_page=100`)).servers || [];
      if (!list.length) continue;
      const prices = (await get(`/instance/v1/zones/${z}/products/servers?per_page=100`)).servers || {};
      for (const s of list) {
        const p = prices[s.commercial_type];
        servers.push({ provider: 'scaleway', name: s.name, type: s.commercial_type, zone: z, state: s.state, tags: s.tags || [],
          eur_month: s.state === 'running' && p ? r2(p.monthly_price ?? p.hourly_price * 730) : 0 });
      }
    }
    return { servers };
  } catch (e) { return { error: e.message, servers }; }
}

/** --week: Vercel FOCUS charges for the window, by service and project. */
async function readVercel(from, to) {
  const token = clean(process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN);
  if (!token) return { error: 'no VERCEL_API_TOKEN' };
  try {
    const r = await fetch(`https://api.vercel.com/v1/billing/charges?from=${from.toISOString()}&to=${to.toISOString()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(120_000) });
    if (!r.ok) return { error: `Vercel billing API ${r.status}` };
    const byService = {}, byProject = {};
    let total = 0, n = 0;
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim()) continue;
      const c = JSON.parse(line);
      const usd = Number(c.BilledCost || 0);
      total += usd; n++;
      byService[c.ServiceName] = (byService[c.ServiceName] || 0) + usd;
      const p = c.Tags?.ProjectName || '(team)';
      byProject[p] = (byProject[p] || 0) + usd;
    }
    const top = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => ({ k, usd: r2(v) }));
    return { total_usd: r2(total), rows: n, by_service: top(byService), by_project: top(byProject) };
  } catch (e) { return { error: e.message }; }
}

// ─────────────────────────────────────────── email

async function mail(subject, text) {
  if (!process.env.RESEND_API_KEY) return '(no RESEND_API_KEY; not emailed)';
  const { Resend } = await import('resend');
  await new Resend(clean(process.env.RESEND_API_KEY)).emails.send({
    from: 'Source Library <noreply@sourcelibrary.org>',
    to: process.env.ALERT_EMAIL || 'derek@sourcelibrary.org',
    subject: `[SPEND] ${subject}`,
    text,
  });
  return `emailed: ${subject}`;
}

// ─────────────────────────────────────────── main

function render(report) {
  const L = [`═══ ${report.line} ═══`, `day ${report.day} · generated ${report.generated_at.toISOString()}`, ''];
  const names = { ledger: '(a) LEDGER  paid-vs-got', machines: '(b) MACHINES', envelopes: '(c) ENVELOPES', dial: '(d) DIAL vs INVOICE' };
  for (const [k, title] of Object.entries(names)) {
    const c = report.checks[k];
    L.push(`${title} — ${c.status}`);
    for (const l of c.lines) L.push(`  ${l}`);
    L.push('');
  }
  return L.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const WEEK = args.includes('--week');
  const JSON_OUT = args.includes('--json');
  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — could not measure (exit 2)'); process.exit(2); }

  const now = new Date();
  const today0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const D1 = dayStr(today0 - DAY), D2 = dayStr(today0 - 2 * DAY);
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  let exitCode = 0;
  try {
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    const revs = await db.collection('system_config_revisions').find(
      { config_id: 'processing_control', created_at: { $gte: new Date(today0 - 2 * DAY) } },
      { projection: { created_at: 1, 'prior.daily_budget_usd': 1 } }).toArray();

    // (a)
    const pvg = await db.collection('ops_reports').findOne({ _id: `paid-vs-got-${D1}` });
    const ledger = ledgerCheck(pvg, D1);

    // (b)
    const infra = await db.collection('ops_reports').find({ _id: { $in: INFRA_SOURCES.map((s) => `work-board:${s}`) } }).toArray();
    const infraDocs = Object.fromEntries(infra.map((d) => [d.box, d]));
    const { pods, error: podsError } = await readPods();
    const machines = machinesCheck({ infraDocs, pods, podsError, now });

    // (c) + (d): one usage read covering the last 3 days and D-2 entire
    const since = new Date(Math.min(now.getTime() - STORED_DAYS * DAY, today0 - 2 * DAY));
    const usage = await readUsageWindow(db, since, now);
    const pages24 = await pagesWrittenByBook(db, new Date(now.getTime() - DAY));
    const envs = await readEnvelopes(db, control, { usage, pages24, now });
    const envelopes = envelopesCheck(envs, now);

    const union = new Map(); // book id → earliest envelope created_at that covers it
    for (const env of readScopeEnvelopes(control)) {
      for (const id of await envelopeIds(db, env)) {
        const t = ms(env.created_at) || 0;
        if (!union.has(id) || t < union.get(id)) union.set(id, t);
      }
    }
    const billed = await billedByDay(D2, dayStr(today0));
    const days = [D1, D2].map((day, i) => {
      const a = Date.parse(`${day}T00:00:00Z`), b = a + DAY;
      let metered = 0, inEnv = 0;
      for (const r of usage.byTime) {
        const t = ms(r.timestamp);
        if (t < a || t >= b) continue;
        metered += r.cost_usd || 0;
        if (union.has(String(r.book_id)) && t >= union.get(String(r.book_id))) inEnv += r.cost_usd || 0;
      }
      return { day, primary: i === 0, dial_usd: dialDuring(revs, control?.daily_budget_usd, a, b), metered_usd: r2(metered), envelope_usd: r2(inEnv), outside_usd: r2(metered - inEnv),
        billed_usd: billed.byDay ? r2(billed.byDay[day] || 0) : null };
    });
    const dialC = dialCheck({ days, billedUnreadable: billed.error || null });

    const checks = { ledger, machines, envelopes, dial: dialC };
    const status = overall(checks);
    const report = {
      _id: `spend-daily-${D1}`, type: REPORT_TYPE, day: D1, generated_at: now, generated_by: 'scripts/audit/spend-daily.mjs',
      status, line: summaryLine(status, checks), checks,
      fingerprint: [ledger, machines, envelopes, dialC].flatMap((c) => c.lines.filter((l) => l.startsWith('FAIL')).map((l) => l.replace(/\$[\d.,]+|€\d+|\d+(\.\d+)? h/g, ''))).sort().join('|'),
    };
    const text = render(report);

    if (WEEK) {
      const since7 = new Date(today0 - 7 * DAY);
      const [dailies, ledgers, scw, vercel, billed7] = await Promise.all([
        db.collection('ops_reports').find({ type: REPORT_TYPE }).sort({ day: -1 }).limit(7).project({ day: 1, status: 1, line: 1, 'checks.envelopes.envelopes': 1 }).toArray(),
        db.collection('ops_reports').find({ type: PVG_TYPE }).sort({ day: -1 }).limit(7).project({ day: 1, verdict: 1, headline: 1 }).toArray(),
        readScaleway(),
        readVercel(since7, new Date(today0)),
        billedByDay(dayStr(today0 - 7 * DAY), dayStr(today0)),
      ]);
      const week = {
        window: `${dayStr(today0 - 7 * DAY)} .. ${D1}`,
        today: report,
        daily_checks: dailies.map((d) => ({ day: d.day, status: d.status, line: d.line })),
        ledgers: ledgers.map((l) => ({ day: l.day, status: l.verdict?.status, fails: l.verdict?.fails || [],
          paid_usd: r2((l.headline || []).reduce((a, h) => a + (h.paid_usd || 0), 0)),
          waste_usd: r2((l.headline || []).reduce((a, h) => a + (h.waste_usd || 0), 0)),
          pages: (l.headline || []).reduce((a, h) => a + (h.pages_written || 0), 0) })),
        envelopes: envelopes.envelopes.map(({ tag, issue, budget_usd, spent_usd, pages24: p24, paid24_usd, last_spend_at, created_at, level, why, books, lanes, why_opened }) =>
          ({ tag, issue, level, why, budget_usd, spent_usd, unspent_usd: r2(Math.max(0, budget_usd - spent_usd)), ...weekOf(tag, dailies, { pages24: p24, paid24_usd }),
            last_spend_at, created_at, books, lanes, why_opened })),
        machines: { flagged: machines.flags, not_readable: machines.lines.filter((l) => l.startsWith('UNKNOWN')),
          scaleway: scw, runpod: pods ? pods.map((p) => ({ name: p.name, status: p.desiredStatus, usd_hr: p.costPerHr, deadline: podDeadline(p.name) })) : podsError,
          hetzner: infraDocs['infra-hetzner'] ? { flags: infraDocs['infra-hetzner'].flags || [], generated_at: infraDocs['infra-hetzner'].generated_at } : 'not readable (no infra-hetzner flag document; needs #5741 + HCLOUD_TOKEN)' },
        vendors: {
          gemini_billed: billed7.byDay ? { total_usd: r2(Object.values(billed7.byDay).reduce((a, v) => a + v, 0)), by_day: billed7.byDay } : { error: billed7.error },
          vercel,
          atlas: 'not readable — no Atlas API key on this box',
          cloudflare: 'not readable — no Cloudflare API token on this box',
          hetzner: 'not readable — no HCLOUD_TOKEN (see #5741)',
        },
      };
      console.log(JSON_OUT ? JSON.stringify(week, null, 2) : `${text}\n── WEEK ──\n${JSON.stringify({ ...week, today: undefined }, null, 2)}`);
    } else {
      console.log(JSON_OUT ? JSON.stringify(report, null, 2) : text);
      exitCode = status === 'FAIL' ? 1 : status === 'UNKNOWN' ? 2 : 0;
    }

    if (WEEK) {
      // --week only reads.
    } else if (!APPLY) {
      console.error(`(dry run — nothing written. --apply would upsert ops_reports ${report._id}${status === 'FAIL' ? ' and email on FAIL (7-day cooldown per failure set)' : ''}.)`);
    } else {
    await db.collection('ops_reports').replaceOne({ _id: report._id }, report, { upsert: true });
    console.error(`wrote ops_reports ${report._id}`);
    const dir = process.env.SPEND_DAILY_STATE_DIR || path.join(os.homedir(), '.spend-daily');
    fs.mkdirSync(dir, { recursive: true });
    const stateFile = path.join(dir, 'state.json');
    const state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : {};
    if (shouldMail({ status, fingerprint: report.fingerprint, state, now })) {
      try {
        console.error(await mail(report.line.slice(0, 120), `${text}\n\nDetails: https://sourcelibrary.org/admin/work · issue https://github.com/Embassy-of-the-Free-Mind/sourcelibrary-v2/issues/5743\nNothing was stopped or changed. Same failures are not re-mailed for ${MAIL_COOLDOWN_DAYS} days.`));
        fs.writeFileSync(stateFile, JSON.stringify({ fingerprint: report.fingerprint, last_mailed_at: now.toISOString() }, null, 1));
      } catch (e) { console.error(`email failed: ${e.message}`); }
    } else if (status === 'FAIL') console.error('FAIL already mailed with the same failures inside the cooldown — not re-sent');
    }
  } finally {
    await client.close().catch(() => {});
  }
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) main().catch((e) => { console.error(`spend-daily could not run: ${e.message}`); process.exit(2); });
