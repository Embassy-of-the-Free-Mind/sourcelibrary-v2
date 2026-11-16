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
 *       Split (#345): outside-envelope spend in the PIPELINE lanes (OCR, translation, images, by the usage
 *       row's `type`, as paid-vs-got's laneOf) is measured against the dial exactly as above. All other
 *       outside spend (lane `other`: search, the Librarian, embeddings, evals) is not pipeline spend and
 *       is measured against a standing allowance, OUTSIDE_DIAL_ALLOWANCE_USD ($15/day, env
 *       SPEND_OUTSIDE_DIAL_ALLOWANCE_USD), FAIL above max(1.5 x allowance, allowance + $5). The line names the
 *       top three sources (usage `type`) with dollars. "Inside an envelope" is by book, so a non-pipeline
 *       call on an envelope's book counts as envelope spend; envelope books are pipeline books first.
 *   (e) VERCEL    the team's billed cost (Vercel FOCUS charges, as --week reads them) for the newest complete
 *                 billing day (08:00Z to 08:00Z, so not always D-1) vs the
 *                 median of the seven days before it: FAIL when more than 1.5 x the median AND at least $10
 *                 above it (something changed). WARN when the month-to-date pace (spend / days elapsed x
 *                 days in month) is over VERCEL_MONTHLY_BUDGET_USD ($1,200, env SPEND_VERCEL_MONTHLY_BUDGET_USD):
 *                 a standing condition that needs a decision. Names the top two projects. UNKNOWN when the
 *                 token is missing or the API fails.
 *   (f) R2        system_config storage_stats (bucket `sourcelibrary`) vs scripts/lib/r2-storage-ceiling.json:
 *                 FAIL at or over the ceiling; WARN when the room left, at the average daily bytes written over
 *                 the last three days (metrics_history `r2_writes`, one row per day), is under 7 days. UNKNOWN
 *                 when the stats document is missing or older than 36 h. Gives TB stored, TB of room, GB
 *                 written yesterday and the monthly storage cost at list price ($0.015/GB).
 *
 * Design rule: FAIL means something changed yesterday; a standing condition that needs a decision is WARN.
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
 * that can be read ($0 APIs: BigQuery Gemini export, Vercel FOCUS charges, Scaleway consumption; Atlas and Cloudflare have
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
import { ceilingBytes, BUCKET as R2_BUCKET, MAX_AGE_HOURS as R2_MAX_AGE_H } from '../lib/r2-storage-ceiling.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const REPORT_TYPE = 'spend_daily';
export const ENVELOPE_NOISE_USD = 1;
export const NEAR_CAP = 0.9;
export const STORED_DAYS = 3;
export const INFRA_STALE_H = 3;
export const MAIL_COOLDOWN_DAYS = 7;
export const OUTSIDE_DIAL_ALLOWANCE_USD = 15;
export const VERCEL_MONTHLY_BUDGET_USD = 1200;
export const VERCEL_SPIKE_RATIO = 1.5;
export const VERCEL_SPIKE_MIN_USD = 10;
export const R2_MIN_ROOM_DAYS = 7;
const R2_USD_PER_GB_MONTH = 0.015;
const PIPELINE_LANES = new Set(['ocr', 'translation', 'images']);
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

const envNum = (name, dflt) => { const v = Number(process.env[name]); return Number.isFinite(v) && v > 0 ? v : dflt; };
export const outsideAllowanceUsd = () => envNum('SPEND_OUTSIDE_DIAL_ALLOWANCE_USD', OUTSIDE_DIAL_ALLOWANCE_USD);
export const vercelMonthlyBudgetUsd = () => envNum('SPEND_VERCEL_MONTHLY_BUDGET_USD', VERCEL_MONTHLY_BUDGET_USD);
/** The dial's over-limit rule, shared by the allowance: FAIL above max(1.5 x n, n + $5). */
export const overLimit = (x) => Math.max(1.5 * x, x + 5);

/**
 * (d) yesterday (and the day before) against the dial in force that day, the standing allowance for
 * non-pipeline spend, and the invoice. A day row carries `outside_pipeline_usd` / `outside_other_usd` /
 * `other_top` (the split); an older row with only `outside_usd` is judged whole against the dial.
 */
export function dialCheck({ days, billedUnreadable = null, allowance = outsideAllowanceUsd() }) {
  const lines = [], fails = [];
  let allowanceOver = false;
  for (const d of days) {
    const dial = d.dial_usd || 0;
    const limit = dial ? overLimit(dial) : 5;
    const split = d.outside_other_usd != null;
    const pipelineOutside = split ? d.outside_pipeline_usd : d.outside_usd;
    // Non-pipeline spend counts as authorised only as far as it was METERED, capped at the allowance.
    // Adding the whole allowance would let up to $15 a day of unmetered spend hide inside it.
    const authorised = dial + d.envelope_usd + (split ? Math.min(d.outside_other_usd, allowance) : 0);
    const parts = [`${d.day}: metered ${$(d.metered_usd)} (in envelopes ${$(d.envelope_usd)}, outside ${$(d.outside_usd)}${split ? `: pipeline ${$(pipelineOutside)}, other ${$(d.outside_other_usd)}` : ''}) vs dial ${$(dial)} (highest in force that day)`];
    if (d.primary && pipelineOutside > limit) fails.push(`${d.day}: ${$(pipelineOutside)} of pipeline spend (OCR, translation, images) outside every envelope against a ${$(dial)} dial (limit ${$(limit)})`);
    if (d.billed_usd != null) {
      parts.push(`billed ${$(d.billed_usd)} vs authorised ${$(authorised)}`);
      if (d.billed_usd > 1.25 * authorised + 10) fails.push(`${d.day}: billed ${$(d.billed_usd)} > 1.25 x authorised ${$(authorised)} + $10 - spend the dial and envelopes did not see`);
    }
    lines.push(parts.join('; '));
    if (split) {
      const aLimit = overLimit(allowance);
      const top = (d.other_top || []).slice(0, 3).map((t) => `${t.k} ${$(t.usd)}`).join(', ') || 'none';
      lines.push(`${d.day}: non-pipeline spend outside envelopes ${$(d.outside_other_usd)} vs standing allowance ${$(allowance)} (limit ${$(aLimit)}); top sources: ${top}`);
      if (d.primary && d.outside_other_usd > aLimit) { allowanceOver = true; fails.push(`${d.day}: ${$(d.outside_other_usd)} of non-pipeline spend (search, Librarian, embeddings, evals) over the ${$(allowance)}/day allowance (limit ${$(aLimit)}); top: ${top}`); }
    }
  }
  if (billedUnreadable) lines.push(`UNKNOWN invoice not readable: ${billedUnreadable}`);
  for (const f of fails) lines.push(`FAIL ${f}`);
  return { status: fails.length ? 'FAIL' : billedUnreadable ? 'UNKNOWN' : 'PASS', lines, fails, days, allowance_usd: allowance, allowance_over: allowanceOver };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/**
 * (e) Vercel. `charges` = { byDay: { 'YYYY-MM-DD': { total, byProject: {name: usd} } } } or { error }.
 * `day` = the newest complete billing day (Vercel's runs 08:00Z to 08:00Z, labelled by its start). Needs yesterday plus at least 4 of the 7 days before it, else UNKNOWN.
 */
export function vercelCheck({ charges, day, budget = vercelMonthlyBudgetUsd() }) {
  if (!charges || charges.error) return { status: 'UNKNOWN', lines: [`UNKNOWN Vercel charges not readable: ${charges?.error || 'not read'}`] };
  const by = charges.byDay || {};
  const prev = [1, 2, 3, 4, 5, 6, 7].map((i) => dayStr(Date.parse(`${day}T00:00:00Z`) - i * DAY)).filter((d) => by[d]).map((d) => by[d].total);
  if (!by[day] || prev.length < 4) return { status: 'UNKNOWN', lines: [`UNKNOWN Vercel charges cover ${by[day] ? 'yesterday' : 'not yesterday'} and ${prev.length} of the 7 days before it - too few to judge a spike`] };
  const y = by[day].total, med = median(prev);
  const spikeAt = Math.max(VERCEL_SPIKE_RATIO * med, med + VERCEL_SPIKE_MIN_USD);
  const spike = y > VERCEL_SPIKE_RATIO * med && y - med >= VERCEL_SPIKE_MIN_USD;
  const month = day.slice(0, 7), elapsed = Number(day.slice(8, 10));
  const dim = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)), 0)).getUTCDate();
  const mtd = Object.entries(by).filter(([d]) => d.startsWith(month)).reduce((a, [, v]) => a + v.total, 0);
  const pace = mtd / elapsed * dim;
  const over = pace > budget;
  const top = Object.entries(by[day].byProject || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${$(v)}`).join(', ') || 'none';
  const lines = [`${day}: ${$(y)} billed vs median ${$(med)} of the ${prev.length} days before (spike above ${$(spikeAt)}); month to date ${$(mtd)}, pace ${$(pace)} for the month vs budget ${$(budget)}; top projects: ${top}`];
  if (spike) lines.push(`FAIL ${day}: ${$(y)} is more than ${VERCEL_SPIKE_RATIO} x the median ${$(med)} and ${$(y - med)} above it; top projects: ${top}`);
  if (over) lines.push(`WARN month-to-date pace ${$(pace)} is over the ${$(budget)} monthly budget (decide: raise it or cut)`);
  return { status: spike ? 'FAIL' : over ? 'WARN' : 'PASS', lines, yesterday_usd: r2(y), median_usd: r2(med), mtd_usd: r2(mtd), pace_usd: r2(pace), budget_usd: budget, top_projects: top };
}

/**
 * (f) R2. `stats` = system_config storage_stats (or null). `writtenDays` = bytes written per recent day,
 * newest first ([{day, bytes}]; the first three are averaged). `ceiling` bytes from r2-storage-ceiling.json.
 */
export function r2Check({ stats, writtenDays = [], ceiling = ceilingBytes(), now = new Date() }) {
  if (!stats) return { status: 'UNKNOWN', lines: ['UNKNOWN system_config storage_stats is missing - /api/cron/storage-stats has never written'] };
  const at = ms(stats.updatedAt);
  if (!Number.isFinite(at) || now.getTime() - at > R2_MAX_AGE_H * HOUR) {
    return { status: 'UNKNOWN', lines: [`UNKNOWN storage stats are ${Number.isFinite(at) ? `${((now.getTime() - at) / HOUR).toFixed(0)} h old` : 'undated'} (limit ${R2_MAX_AGE_H} h) - the nightly storage-stats cron has stopped`] };
  }
  const row = Array.isArray(stats.r2) ? stats.r2.find((r) => r.bucket === R2_BUCKET) : null;
  if (!row || !Number.isFinite(row.bytes)) return { status: 'UNKNOWN', lines: [`UNKNOWN no reading for bucket ${R2_BUCKET} in storage_stats`] };
  const tb = (n) => `${(n / 1e12).toFixed(2)} TB`, gb = (n) => `${(n / 1e9).toFixed(0)} GB`;
  const room = ceiling - row.bytes;
  const days = writtenDays.filter((d) => Number.isFinite(d.bytes)).slice(0, 3);
  const yesterday = days[0]?.bytes ?? null;
  const avg = days.length ? days.reduce((a, d) => a + d.bytes, 0) / days.length : null;
  const monthly = r2(row.bytes / 1e9 * R2_USD_PER_GB_MONTH);
  const lines = [`${tb(row.bytes)} stored, ${tb(Math.max(0, room))} of room under the ${tb(ceiling)} ceiling, ${yesterday == null ? 'bytes written yesterday unknown' : `${gb(yesterday)} written yesterday`}, storage ${$(monthly)}/month at $${R2_USD_PER_GB_MONTH}/GB`];
  const out = { lines, stored_bytes: row.bytes, ceiling_bytes: ceiling, room_bytes: room, written_bytes: yesterday, written_avg_bytes: avg == null ? null : Math.round(avg), written_days: days.length, monthly_usd: monthly };
  if (room <= 0) { lines.push(`FAIL bucket ${R2_BUCKET} is at or over the ceiling (${tb(row.bytes)} >= ${tb(ceiling)}); raise it with a new approval in scripts/lib/r2-storage-ceiling.json or free space`); return { status: 'FAIL', ...out }; }
  if (avg == null) { lines.push('UNKNOWN write rate not readable (no r2_writes day stored), so days of room cannot be judged'); return { status: 'UNKNOWN', ...out }; }
  const roomDays = avg > 0 ? room / avg : Infinity;
  out.room_days = roomDays === Infinity ? null : r2(roomDays);
  lines.push(`room lasts ${roomDays === Infinity ? 'indefinitely' : `${roomDays.toFixed(1)} days`} at ${gb(avg)}/day (average of ${days.length} day${days.length === 1 ? '' : 's'}${days.length < 3 ? '; fewer than 3 days stored' : ''})`);
  if (roomDays < R2_MIN_ROOM_DAYS) { lines.push(`WARN under ${R2_MIN_ROOM_DAYS} days of room at the current write rate (decide: approve more storage or slow the writers)`); return { status: 'WARN', ...out }; }
  return { status: 'PASS', ...out };
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
  const dialFails = (checks.dial.fails?.length || 0) - (checks.dial.allowance_over ? 1 : 0);
  if (dialFails > 0) bits.push('dial/invoice over');
  if (checks.dial.allowance_over) bits.push('non-pipeline spend over allowance');
  const V = checks.vercel, R = checks.r2;
  if (V && V.status === 'FAIL') bits.push(`Vercel spike ${$(V.yesterday_usd)} vs median ${$(V.median_usd)}`);
  else if (V && V.status === 'WARN') bits.push(`Vercel pace ${$(V.pace_usd)}/mo over budget`);
  if (R && R.status === 'FAIL') bits.push('R2 at ceiling');
  else if (R && R.status === 'WARN') bits.push(`R2 room ${R.room_days} days`);
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
    const meter = env.all_books ? await getScopeSpendUsd(db, { ids: null, since: env.created_at, endpoints: env.meter_endpoints })
      : idList.length ? await getScopeSpendUsd(db, { ids: idList, since: env.created_at, endpoints: env.meter_endpoints }) : { usd: 0, rows: 0, meterError: null };
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

/** --week: every Scaleway instance with its list price (€), and the Scaleway bill. */
export async function readScaleway() {
  const key = clean(process.env.SCALEWAY_SECRET_KEY);
  if (!key) return { error: 'SCALEWAY_SECRET_KEY not set' };
  const zones = (process.env.SCALEWAY_ZONES || 'fr-par-1,fr-par-2,fr-par-3,nl-ams-1,nl-ams-2,nl-ams-3,pl-waw-1,pl-waw-2,pl-waw-3').split(',');
  const get = async (u) => { const r = await fetch(`https://api.scaleway.com${u}`, { headers: { 'X-Auth-Token': key }, signal: AbortSignal.timeout(30_000) }); if (!r.ok) throw new Error(`${u} → ${r.status}`); return r.json(); };
  const servers = [];
  let org = clean(process.env.SCALEWAY_ORGANIZATION_ID) || null;
  try {
    for (const z of zones) {
      const list = (await get(`/instance/v1/zones/${z}/servers?per_page=100`)).servers || [];
      if (!list.length) continue;
      const prices = (await get(`/instance/v1/zones/${z}/products/servers?per_page=100`)).servers || {};
      for (const s of list) {
        const p = prices[s.commercial_type];
        org ||= s.organization;
        servers.push({ provider: 'scaleway', name: s.name, type: s.commercial_type, zone: z, state: s.state, tags: s.tags || [],
          eur_month: s.state === 'running' && p ? r2(p.monthly_price ?? p.hourly_price * 730) : 0 });
      }
    }
    // The bill (consumption by product, € excl. VAT), this month so far and last month. Monthly
    // granularity is all the API gives; read with the same key as the instance list.
    const bill = {};
    if (org) {
      const now = new Date();
      for (const back of [0, 1]) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
        const period = d.toISOString().slice(0, 7);
        try {
          const rows = (await get(`/billing/v2beta1/consumptions?billing_period=${period}&organization_id=${org}&page_size=100`)).consumptions || [];
          const by = {};
          for (const c of rows) by[`${c.product_name} (${c.category_name})`] = (by[`${c.product_name} (${c.category_name})`] || 0) + Number(c.value?.units || 0) + (c.value?.nanos || 0) / 1e9;
          bill[period] = { total_eur: r2(Object.values(by).reduce((a, v) => a + v, 0)), top: Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => ({ k, eur: r2(v) })) };
        } catch (e) { bill[period] = { error: e.message }; }
      }
    }
    return { servers, bill: org ? bill : 'not readable (no organization id)' };
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

/**
 * (e): Vercel FOCUS charges by billing day and project, from the earlier of the month start and 9 days
 * back. Vercel's billing day runs 08:00Z to 08:00Z (midnight Pacific) and is labelled by its start date,
 * so only periods already ended count and `latest` is the newest complete one (not always D-1).
 */
async function readVercelDaily(now) {
  const token = clean(process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN);
  if (!token) return { error: 'no VERCEL_API_TOKEN' };
  const d1 = new Date(now.getTime() - DAY);
  const from = Math.min(Date.UTC(d1.getUTCFullYear(), d1.getUTCMonth(), 1), now.getTime() - 9 * DAY);
  try {
    const r = await fetch(`https://api.vercel.com/v1/billing/charges?from=${new Date(from).toISOString()}&to=${now.toISOString()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(180_000) });
    if (!r.ok) return { error: `Vercel billing API ${r.status}` };
    const byDay = {};
    let n = 0, dated = 0;
    for (const line of (await r.text()).split('\n')) {
      if (!line.trim()) continue;
      const c = JSON.parse(line);
      n++;
      const day = String(c.ChargePeriodStart || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      dated++;
      if (ms(c.ChargePeriodEnd) > now.getTime()) continue; // a period still open under-reports
      const usd = Number(c.BilledCost || 0);
      const e = (byDay[day] ||= { total: 0, byProject: {} });
      e.total += usd;
      const p = c.Tags?.ProjectName || '(team)';
      e.byProject[p] = (e.byProject[p] || 0) + usd;
    }
    if (n && !dated) return { error: 'Vercel charges carry no ChargePeriodStart date' };
    return { byDay, latest: Object.keys(byDay).sort().pop() || null };
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
  const names = { ledger: '(a) LEDGER  paid-vs-got', machines: '(b) MACHINES', envelopes: '(c) ENVELOPES', dial: '(d) DIAL, ALLOWANCE, INVOICE', vercel: '(e) VERCEL', r2: '(f) R2' };
  for (const [k, title] of Object.entries(names)) {
    const c = report.checks[k];
    if (!c) continue;
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
      let metered = 0, inEnv = 0, outPipe = 0, outOther = 0;
      const otherBy = {};
      for (const r of usage.byTime) {
        const t = ms(r.timestamp);
        if (t < a || t >= b) continue;
        const usd = r.cost_usd || 0;
        metered += usd;
        if (union.has(String(r.book_id)) && t >= union.get(String(r.book_id))) inEnv += usd;
        else if (PIPELINE_LANES.has(laneOf(r.type))) outPipe += usd;
        else { outOther += usd; const k = r.type || '(untyped)'; otherBy[k] = (otherBy[k] || 0) + usd; }
      }
      const otherTop = Object.entries(otherBy).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([k, usd]) => ({ k, usd: r2(usd) }));
      return { day, primary: i === 0, dial_usd: dialDuring(revs, control?.daily_budget_usd, a, b), metered_usd: r2(metered), envelope_usd: r2(inEnv), outside_usd: r2(metered - inEnv),
        outside_pipeline_usd: r2(outPipe), outside_other_usd: r2(outOther), other_top: otherTop,
        billed_usd: billed.byDay ? r2(billed.byDay[day] || 0) : null };
    });
    const dialC = dialCheck({ days, billedUnreadable: billed.error || null });

    // (e) + (f)
    const vercelCharges = await readVercelDaily(now);
    const vercel = vercelCheck({ charges: vercelCharges, day: vercelCharges.latest || D1 });
    const stats = await db.collection('system_config').findOne({ _id: 'storage_stats' });
    const hist = await db.collection('metrics_history').find({ date: { $in: [D1, dayStr(today0 - 2 * DAY), dayStr(today0 - 3 * DAY)] } }, { projection: { date: 1, r2_writes: 1 } }).toArray();
    const writtenDays = hist.filter((h) => Number.isFinite(h.r2_writes?.total?.bytes)).sort((x, y) => (x.date < y.date ? 1 : -1)).map((h) => ({ day: h.date, bytes: h.r2_writes.total.bytes }));
    if (!writtenDays.length && Number.isFinite(stats?.r2_writes?.families?.total?.bytes)) writtenDays.push({ day: stats.r2_writes.day, bytes: stats.r2_writes.families.total.bytes });
    const r2c = r2Check({ stats, writtenDays, now });

    const checks = { ledger, machines, envelopes, dial: dialC, vercel, r2: r2c };
    const status = overall(checks);
    const report = {
      _id: `spend-daily-${D1}`, type: REPORT_TYPE, day: D1, generated_at: now, generated_by: 'scripts/audit/spend-daily.mjs',
      status, line: summaryLine(status, checks), checks,
      fingerprint: [ledger, machines, envelopes, dialC, vercel, r2c].flatMap((c) => c.lines.filter((l) => l.startsWith('FAIL')).map((l) => l.replace(/\$[\d.,]+|€\d+|\d+(\.\d+)? h/g, ''))).sort().join('|'),
    };
    const text = render(report);

    if (WEEK) {
      const since7 = new Date(today0 - 7 * DAY);
      const [dailies, ledgers, scw, vercel, billed7] = await Promise.all([
        db.collection('ops_reports').find({ type: REPORT_TYPE }).sort({ day: -1 }).limit(7).project({ day: 1, status: 1, line: 1, 'checks.envelopes.envelopes': 1, 'checks.dial.days': 1 }).toArray(),
        db.collection('ops_reports').find({ type: PVG_TYPE }).sort({ day: -1 }).limit(7).project({ day: 1, verdict: 1, headline: 1 }).toArray(),
        readScaleway(),
        readVercel(since7, new Date(today0)),
        billedByDay(dayStr(today0 - 7 * DAY), dayStr(today0)),
      ]);
      const week = {
        window: `${dayStr(today0 - 7 * DAY)} .. ${D1}`,
        today: report,
        daily_checks: dailies.map((d) => ({ day: d.day, status: d.status, line: d.line })),
        // Each daily row's primary day: metered (both stores, call time) vs the invoice. billed − metered = unmetered.
        gemini_days: dailies.map((d) => d.checks?.dial?.days?.find((x) => x.primary)).filter(Boolean)
          .map(({ day, dial_usd, metered_usd, envelope_usd, billed_usd }) => ({ day, dial_usd, metered_usd, envelope_usd, billed_usd,
            unmetered_usd: billed_usd != null ? r2(billed_usd - metered_usd) : null })),
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
