#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/spend-reconcile.mjs — billed vs metered as ONE number per window (and
 * the realtime token gap); it never follows a paid batch to the pages it wrote, and never looks
 * at duplicates or failed-but-paid jobs. Its readers are reused here for the weekly bill check
 * (googleToken, bigQuery, BILLING_EXPORT, meteredSupabase, meteredMongo). scripts/audit/
 * gemini-usage-perimeter.mjs — STATIC: does each call site write a usage row at all; it cannot
 * say what a row bought. scripts/audit/true-gemini-spend.mjs — does not exist (spend-reconcile's
 * header still names it). scripts/lib/spend-guard.mjs — today's spend for the dial, as one sum;
 * no lanes, no pages, no waste. scripts/maintenance/reconcile-batch-usage.mjs — repairs batch
 * placeholder rows from batch_jobs; a writer, not a ledger. src/lib/spend-report.ts + /admin/spend
 * — renders the ops repo's invoice document; it has no per-day pages-for-dollars row. None of
 * them answers "of yesterday's spend, how much became pages, and how much was paid twice or for
 * nothing". This script writes no meter: it READS the two gemini_usage stores, batch_jobs,
 * translate_batch_runs and pages, and reuses estimateBatchCostUsd() for the submit estimate.
 *
 * paid-vs-got — the daily ledger (#5499). For one UTC day (default: yesterday):
 *
 *   1. COLLECTION  every batch_jobs / translate_batch_runs job still open at Gemini, with its age.
 *                  WARN past 24 h, FAIL past 40 h (Gemini expires batch jobs at 48 h). A pause
 *                  must never stop collection (#5492).
 *   2. GOT         pages whose OCR / translation was written that day, from the page's own
 *                  provenance (`<field>.engine.run.batch_job_id`, #4613) — not from job status.
 *   3. PAID        that day's spend by lane from COLLECTED usage rows (actual tokens): realtime
 *                  rows by `timestamp`, batch rows by `completed_at`. The submit estimate
 *                  (estimateBatchCostUsd, what the dial saw) is shown beside it.
 *   4. WASTE       duplicate submissions (same page set < 1 h apart, unforced), pages paid more
 *                  than once (unforced, 7-day lookback), collected batches that wrote no page,
 *                  failed jobs real-vs-phantom, and paid usage rows with no call site.
 *   5. BILL        weekly (Mondays, or --bill-check): the invoice (BigQuery export) vs metered vs
 *                  attributed, four trailing weeks — #4599's number made recurring. Other days
 *                  carry the last computed figure forward, labelled with its date.
 *   6. HEADLINE    "$X paid → Y pages written → $Z per 1,000 pages; W% waste", per lane.
 *   7. CONTROLS    a positive control every run (a fake 41 h-old open batch, in memory, must
 *                  FAIL the collection check — else exit 2), and --negative-control (fresh and
 *                  terminal fakes must NOT flag), run once and recorded in the PR.
 *
 * FAIL (exit 1) when: a batch is open past 40 h; duplicate-submission spend > $1/day; or
 * unattributed paid usage > 5% of metered. Exit 2 = could not measure (a store unreadable, the
 * positive control did not fire, the bill unreadable on a bill day). 0 = ran, clean (WARNs
 * included). Never branch on != 0 — measurement-instruments.md.
 *
 * CLOCKS. "Paid" is the collection clock; "got" is the page-write clock (the collector writes
 * both in one pass, so they agree to the minute); duplicates and repeats use the SUBMIT clock.
 * A page re-written after the ledger day loses its stamp to the later write, so "collected,
 * wrote nothing" is an upper bound — read the job ids before acting on a single one.
 *
 * WRITES. With --apply only, and only: one `ops_reports` document `paid-vs-got-<day>`
 * (`type: 'paid_vs_got_daily'`, read by /admin/spend), and on FAIL one GitHub issue, deduped by
 * title (a later FAIL comments on the open one; a later PASS comments and closes it). Default is
 * --dry-run: reads only, prints the ledger.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/paid-vs-got.mjs                 # dry run, yesterday
 *   node --env-file=.env.production.local scripts/audit/paid-vs-got.mjs --date=2026-09-30 --bill-check
 *   node --env-file=.env.production.local scripts/audit/paid-vs-got.mjs --apply          # cron (06:10Z)
 *   node scripts/audit/paid-vs-got.mjs --negative-control                                 # no DB
 *   ... --json   machine-readable report on stdout
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { estimateBatchCostUsd } from '../workers/lib/supabase-usage-logger.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const WARN_AGE_H = 24;
export const FAIL_AGE_H = 40;
export const DUP_WINDOW_MS = HOUR;
export const DUP_FAIL_USD = 1;
export const UNATTRIBUTED_FAIL_PCT = 5;
const REPEAT_LOOKBACK_DAYS = 7;
const ISSUE_TITLE = 'paid-vs-got: daily ledger FAIL';
export const REPORT_TYPE = 'paid_vs_got_daily';

/**
 * batch_jobs statuses that are finished. Anything else — including a status this list has
 * never seen — counts as OPEN: an unknown state must be looked at, not assumed collected.
 */
export const BATCH_TERMINAL = new Set([
  'saved', 'failed', 'submit_failed', 'completed', 'completed_with_errors', 'superseded',
  'cancelled', 'expired', 'collected', 'archived', 'archived_cancelled', 'archived_failed',
]);
/** translate_batch_runs terminal phases: chained (complete/parked/failed) ∪ seam (written/shadow_complete/failed). */
export const RUN_TERMINAL = new Set(['complete', 'parked', 'failed', 'written', 'shadow_complete']);
/** gemini_usage statuses that are a submit-time placeholder, not a collected reading. */
const PLACEHOLDER = new Set(['submitted', 'pending', 'duplicate', 'unknown']);

export const LANES = ['ocr', 'translation', 'images', 'other'];
export function laneOf(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'ocr') return 'ocr';
  if (t === 'translation' || t === 'translate') return 'translation';
  if (t === 'extract_images' || t === 'image_extraction') return 'images';
  return 'other';
}
/** estimateBatchCostUsd() keys its measured rates by these type names. */
const ESTIMATE_TYPE = { ocr: 'ocr', translation: 'translation', images: 'image_extraction' };

const ms = (d) => (d instanceof Date ? d.getTime() : d ? new Date(d).getTime() : NaN);
const r2 = (n) => Math.round(n * 100) / 100;
const r6 = (n) => Math.round(n * 1e6) / 1e6;

// ─────────────────────────────────────────── 1. collection guarantee (pure)

/** When the Gemini job a translate run is waiting on was submitted, or null when nothing is in flight. */
function runInFlightSince(run) {
  if (run.phase === 'round_submitted') return run.round?.job?.submitted_at || run.updated_at;
  if (run.phase === 'translate_submitted') return run.translate_job?.submitted_at || run.updated_at;
  if (run.phase === 'repair_submitted') return run.repair_job?.submitted_at || run.updated_at;
  return null;
}

/**
 * Every open job with its age and level. A job at Gemini (named batch job, or a run with a round
 * in flight) is WARN at 24 h and FAIL at 40 h. A batch_jobs row with no Gemini name never cost
 * anything and cannot expire, and a run idle between rounds has nothing at Gemini: both are
 * WARN past 24 h (a stall to look at), never FAIL.
 */
export function collectionCheck({ jobs = [], runs = [], now = new Date() }) {
  const t = ms(now);
  const items = [];
  const level = (ageH, canExpire) =>
    canExpire && ageH >= FAIL_AGE_H ? 'FAIL' : ageH >= WARN_AGE_H ? 'WARN' : 'ok';
  for (const j of jobs) {
    if (BATCH_TERMINAL.has(j.status)) continue;
    const named = Boolean(j.job_name || j.gemini_job_name);
    const ageH = (t - ms(j.created_at)) / HOUR;
    items.push({ kind: 'batch_job', id: j.id || String(j._id), type: j.type || null, state: j.status,
      age_h: r2(ageH), at_gemini: named, level: level(ageH, named), submitted_by: j.submitted_by || null });
  }
  for (const r of runs) {
    if (RUN_TERMINAL.has(r.phase)) continue;
    const since = runInFlightSince(r);
    const ageH = (t - ms(since || r.updated_at || r.created_at)) / HOUR;
    items.push({ kind: 'translate_run', id: r.id || String(r._id), type: r.mode || 'seam', state: r.phase,
      age_h: r2(ageH), at_gemini: Boolean(since), level: level(ageH, Boolean(since)), book_id: r.book_id || null });
  }
  items.sort((a, b) => b.age_h - a.age_h);
  return {
    open: items.length,
    at_gemini: items.filter((i) => i.at_gemini).length,
    oldest_h: items.length ? items[0].age_h : 0,
    warn: items.filter((i) => i.level === 'WARN').length,
    fail: items.filter((i) => i.level === 'FAIL').length,
    flagged: items.filter((i) => i.level !== 'ok'),
  };
}

/**
 * Positive control, every run: a fake batch job and a fake translate round, 41 h at Gemini,
 * injected in memory into the real lists, must both come back FAIL. If they do not, the check
 * is broken and the run exits 2 rather than report a clean collection.
 */
export function positiveControl({ jobs = [], runs = [], now = new Date() }) {
  const at = new Date(ms(now) - 41 * HOUR);
  const fakeJob = { id: '__positive_control_job__', status: 'pending', job_name: 'batches/__control__', type: 'ocr', created_at: at };
  const fakeRun = { id: '__positive_control_run__', mode: 'chained', phase: 'round_submitted', round: { job: { submitted_at: at } }, updated_at: at };
  const res = collectionCheck({ jobs: [...jobs, fakeJob], runs: [...runs, fakeRun], now });
  const got = (id) => res.flagged.find((i) => i.id === id)?.level || 'ok';
  const ok = got(fakeJob.id) === 'FAIL' && got(fakeRun.id) === 'FAIL';
  return { ok, job: got(fakeJob.id), run: got(fakeRun.id) };
}

/**
 * Negative control (run once, recorded in the PR; also a unit test): things that must NOT flag —
 * a terminal job 50 h old, an open one 23 h old, a finished run 60 h old, a run idle 2 h.
 */
export function negativeControl(now = new Date()) {
  const ago = (h) => new Date(ms(now) - h * HOUR);
  const jobs = [
    { id: 'neg_terminal_50h', status: 'saved', job_name: 'batches/x', created_at: ago(50) },
    { id: 'neg_failed_50h', status: 'failed', job_name: 'batches/y', created_at: ago(50) },
    { id: 'neg_open_23h', status: 'pending', job_name: 'batches/z', created_at: ago(23) },
  ];
  const runs = [
    { id: 'neg_run_complete_60h', mode: 'chained', phase: 'complete', updated_at: ago(60) },
    { id: 'neg_run_idle_2h', mode: 'chained', phase: 'round_ready', updated_at: ago(2) },
    { id: 'neg_run_inflight_5h', mode: 'chained', phase: 'round_submitted', round: { job: { submitted_at: ago(5) } } },
  ];
  const res = collectionCheck({ jobs, runs, now });
  return { ok: res.flagged.length === 0, open: res.open, flagged: res.flagged };
}

// ─────────────────────────────────────────── 4. waste (pure)

/** The page set a job was paid to process: its type plus a hash of its sorted page ids. */
export function pageSetKey(job) {
  const ids = [...(job.page_ids || [])].map(String).sort();
  return `${job.type || 'ocr'}|${createHash('sha1').update(ids.join(',')).digest('hex').slice(0, 16)}`;
}

/** A job that reached Gemini and was not force-resubmitted on purpose. */
const reachedGemini = (j) => j.status !== 'submit_failed' && Boolean(j.job_name || j.gemini_job_name);

/**
 * What a job cost: the collected reading when there is one (usage row, else batch_jobs tokens),
 * the submit estimate otherwise — and says which.
 */
export function jobCost(job, usageByJob = new Map()) {
  const u = usageByJob.get(job.id);
  if (u && !PLACEHOLDER.has(u.status)) return { usd: u.cost_usd || 0, actual: true };
  if ((job.input_tokens || 0) + (job.output_tokens || 0) > 0) return { usd: job.cost_usd || 0, actual: true };
  const est = job.cost_usd ?? estimateBatchCostUsd({ type: job.type || 'ocr', model: job.model, pageCount: job.page_count || job.page_ids?.length || 0 });
  return { usd: est || 0, actual: false };
}

/**
 * Same page set submitted again within DUP_WINDOW_MS of an earlier copy, without `force`
 * (#5498's measure). `inDay(job)` picks the jobs this ledger reports; earlier jobs (the hour
 * before the day) only serve as originals.
 */
export function duplicateSubmissions(jobs, { inDay = () => true, usageByJob = new Map() } = {}) {
  const groups = new Map();
  for (const j of jobs) {
    if (!reachedGemini(j) || j.force || !(j.page_ids?.length)) continue;
    const k = pageSetKey(j);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(j);
  }
  const dups = [];
  for (const g of groups.values()) {
    g.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    for (let i = 1; i < g.length; i++) {
      const gap = ms(g[i].created_at) - ms(g[i - 1].created_at);
      if (gap > DUP_WINDOW_MS || !inDay(g[i])) continue;
      const c = jobCost(g[i], usageByJob);
      dups.push({ id: g[i].id, original_id: g[i - 1].id, type: g[i].type || 'ocr', gap_s: Math.round(gap / 1000),
        pages: g[i].page_ids.length, usd: r6(c.usd), actual: c.actual, status: g[i].status,
        submitted_by: g[i].submitted_by || null });
    }
  }
  return dups.sort((a, b) => b.usd - a.usd);
}

/** A job whose pages were actually paid for: collected with tokens, or saved. */
const paidFor = (j) => reachedGemini(j)
  && (['saved', 'completed', 'completed_with_errors'].includes(j.status) || (j.output_tokens || 0) > 0);

/**
 * Pages in the day's unforced jobs that an EARLIER paid job (same type, within the lookback)
 * already covered. Duplicate submissions are a subset of this. $ is the job's per-page share.
 */
export function pagesPaidTwice(jobs, { inDay = () => true, usageByJob = new Map() } = {}) {
  const sorted = [...jobs].filter(reachedGemini).sort((a, b) => ms(a.created_at) - ms(b.created_at));
  const lastPayer = new Map(); // `${type}|${pageId}` -> id of the latest paid job that covered it
  const superseded = new Set(); // earlier payers whose pages a later paid copy re-wrote
  let pages = 0, usd = 0, jobsHit = 0;
  const byLane = {};
  const top = [];
  for (const j of sorted) {
    const ids = (j.page_ids || []).map(String);
    const key = (p) => `${j.type || 'ocr'}|${p}`;
    if (inDay(j) && !j.force && ids.length) {
      const prior = ids.map((p) => lastPayer.get(key(p))).filter(Boolean);
      if (prior.length) {
        const c = jobCost(j, usageByJob);
        const share = c.usd * (prior.length / ids.length);
        pages += prior.length; usd += share; jobsHit++;
        for (const id of prior) superseded.add(id);
        const lane = laneOf(j.type || 'ocr');
        byLane[lane] = (byLane[lane] || 0) + share;
        top.push({ id: j.id, pages: prior.length, of: ids.length, usd: r6(share), submitted_by: j.submitted_by || null });
      }
    }
    if (paidFor(j)) for (const p of ids) lastPayer.set(key(p), j.id);
  }
  top.sort((a, b) => b.usd - a.usd);
  return { pages, usd: r6(usd), jobs: jobsHit, byLane, top: top.slice(0, 10), superseded };
}

/** The key a page's provenance stamps, matching the usage row's batch_job_id. */
export function stampKeys({ batch_job_id, job_id }) {
  if (!batch_job_id) return [];
  // OCR stamps the batch_jobs id; the chained translate lane stamps the Gemini job name plus the
  // run id, and meters under `${jobName}#${runId}` (translate-batch-chained.mjs meterIdFor).
  return job_id ? [String(batch_job_id), `${batch_job_id}#${job_id}`] : [String(batch_job_id)];
}

/**
 * Collected batch rows, paid (cost > 0), whose job id is stamped on no page written since the
 * day began. `written` is the Set of stampKeys from pages. Two kinds are split out rather than
 * counted as waste: a job whose pages a LATER paid copy re-wrote (`superseded` — that waste is
 * already counted once, on the later copy, under pages-paid-twice), and an `eval/` endpoint,
 * which writes no pages by design.
 */
export function paidForNothing(batchRows, written, superseded = new Set()) {
  const nothing = [], supersededRows = [], evalRows = [];
  for (const r of batchRows) {
    if (PLACEHOLDER.has(r.status) || !((r.cost_usd || 0) > 0) || !r.batch_job_id) continue;
    if (written.has(String(r.batch_job_id))) continue;
    const row = { batch_job_id: r.batch_job_id, lane: laneOf(r.type), usd: r6(r.cost_usd), status: r.status,
      pages: r.page_count || 0, endpoint: r.endpoint || null };
    if (superseded.has(String(r.batch_job_id))) supersededRows.push(row);
    else if (String(r.endpoint || '').startsWith('eval/')) evalRows.push(row);
    else nothing.push(row);
  }
  const byUsd = (a, b) => b.usd - a.usd;
  return { nothing: nothing.sort(byUsd), superseded: supersededRows.sort(byUsd), eval: evalRows.sort(byUsd) };
}

/** Jobs that FAILED on the day and carry a cost: real (Gemini returned tokens) or phantom (submit estimate only). */
export function failedWithCost(jobs, { inDay = () => true } = {}) {
  let real = 0, realUsd = 0, phantom = 0, phantomUsd = 0;
  for (const j of jobs) {
    if (j.status !== 'failed' || !inDay(j) || !((j.cost_usd || 0) > 0)) continue;
    if ((j.output_tokens || 0) > 0) { real++; realUsd += j.cost_usd; } else { phantom++; phantomUsd += j.cost_usd; }
  }
  return { real, real_usd: r6(realUsd), phantom, phantom_usd: r6(phantomUsd) };
}

// ─────────────────────────────────────────── 3. paid (pure)

/**
 * Fold the day's usage rows into per-lane paid. Realtime rows count on their call time; batch
 * rows only once COLLECTED (status no longer a placeholder), on completed_at — the caller
 * selects the rows by those clocks. Placeholders submitted on the day and still open are
 * reported as in-flight commitment, never as paid.
 */
export function foldPaid(realtimeRows, batchRows, inFlightRows = []) {
  const lane = Object.fromEntries(LANES.map((l) => [l, {
    realtime_usd: 0, batch_usd: 0, batch_estimate_usd: 0, batch_jobs: 0, in_tok: 0, out_tok: 0,
    calls: 0, unattributed_usd: 0, in_flight_est_usd: 0,
  }]));
  let metered = 0, unattributed = 0;
  const unattributedByType = {};
  const add = (r, mode) => {
    const L = lane[laneOf(r.type)];
    const usd = r.cost_usd || 0;
    L.calls++; L.in_tok += r.input_tokens || 0; L.out_tok += r.output_tokens || 0;
    if (mode === 'batch') {
      L.batch_usd += usd; L.batch_jobs++;
      const et = ESTIMATE_TYPE[laneOf(r.type)];
      L.batch_estimate_usd += et ? estimateBatchCostUsd({ type: et, model: r.model, pageCount: r.page_count || 0 }) : 0;
    } else {
      L.realtime_usd += usd;
    }
    metered += usd;
    if (usd > 0 && !String(r.endpoint || '').trim()) {
      L.unattributed_usd += usd; unattributed += usd;
      const k = `${r.type || '?'}|${mode}`;
      unattributedByType[k] = (unattributedByType[k] || 0) + usd;
    }
  };
  for (const r of realtimeRows) add(r, 'realtime');
  for (const r of batchRows) if (!PLACEHOLDER.has(r.status)) add(r, 'batch');
  for (const r of inFlightRows) lane[laneOf(r.type)].in_flight_est_usd += r.cost_usd || 0;
  for (const l of LANES) for (const k of Object.keys(lane[l])) if (k.endsWith('usd')) lane[l][k] = r6(lane[l][k]);
  return { lane, metered_usd: r6(metered), unattributed_usd: r6(unattributed),
    unattributed_pct: metered > 0 ? r2(100 * unattributed / metered) : 0, unattributed_by_type: unattributedByType };
}

// ─────────────────────────────────────────── 6. headline + verdict (pure)

export function headline({ paid, got, waste }) {
  return LANES.map((l) => {
    const P = paid.lane[l];
    const paidUsd = (P?.realtime_usd || 0) + (P?.batch_usd || 0);
    const pages = got[l]?.gemini_pages ?? null; // null = this lane writes no pages we count
    const wasteUsd = (waste.repeat_by_lane?.[l] || 0) + (waste.nothing_by_lane?.[l] || 0);
    return {
      lane: l, paid_usd: r2(paidUsd), estimate_usd: r2(P?.batch_estimate_usd || 0), batch_usd: r2(P?.batch_usd || 0),
      pages_written: pages, per_1k_usd: pages ? r2(paidUsd / pages * 1000) : null,
      waste_usd: r2(wasteUsd), waste_pct: paidUsd > 0 ? r2(100 * wasteUsd / paidUsd) : 0,
    };
  });
}

export function verdict({ collection, dupUsd, unattributedPct }) {
  const fails = [];
  const warns = [];
  if (collection.fail) fails.push(`${collection.fail} batch job(s) open at Gemini past ${FAIL_AGE_H} h (expire at 48 h)`);
  if (collection.warn) warns.push(`${collection.warn} open job(s) past ${WARN_AGE_H} h`);
  if (dupUsd > DUP_FAIL_USD) fails.push(`duplicate-submission spend $${dupUsd.toFixed(2)} > $${DUP_FAIL_USD}/day`);
  if (unattributedPct > UNATTRIBUTED_FAIL_PCT) fails.push(`unattributed paid usage ${unattributedPct.toFixed(1)}% > ${UNATTRIBUTED_FAIL_PCT}% of metered`);
  return { status: fails.length ? 'FAIL' : warns.length ? 'WARN' : 'PASS', fails, warns };
}

// ─────────────────────────────────────────── readers

const clean = (v) => (v || '').replace(/\\n/g, '').trim();

/** Row-level read of the Supabase store. Throws (→ exit 2) rather than return a partial day. */
async function supabaseRows(qs) {
  const url = clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — the primary usage store is unreadable');
  const select = 'id,timestamp,type,mode,model,page_count,input_tokens,output_tokens,cost_usd,status,batch_job_id,endpoint,completed_at';
  const out = [];
  for (let from = 0; ; from += 1000) {
    if (from > 300_000) throw new Error('Supabase: >300K usage rows in one day — refusing a truncated sum');
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

/** The day's usage rows from BOTH stores (they are disjoint per row — #3826). */
async function readUsage(db, dayStart, dayEnd) {
  const s = dayStart.toISOString(), e = dayEnd.toISOString();
  const back = new Date(dayStart.getTime() - 3 * DAY).toISOString();
  const [supaByTime, supaBatch] = await Promise.all([
    supabaseRows(`timestamp=gte.${s}&timestamp=lt.${e}`),
    // A batch row is timestamped at submit and completed_at at collect; Gemini expires jobs at 48 h,
    // so anything collected on the day was submitted within the 3 days before it.
    supabaseRows(`mode=eq.batch&timestamp=gte.${back}&completed_at=gte.${s}&completed_at=lt.${e}`),
  ]);
  const mongo = await db.collection('gemini_usage').find({
    _id: { $gte: ObjectId.createFromTime(Math.floor((dayStart.getTime() - 3 * DAY) / 1000)) },
    $or: [{ timestamp: { $gte: dayStart, $lt: dayEnd } }, { mode: 'batch', completed_at: { $gte: dayStart, $lt: dayEnd } }],
  }, { projection: { _id: 0, timestamp: 1, type: 1, mode: 1, model: 1, page_count: 1, input_tokens: 1, output_tokens: 1,
    cost_usd: 1, status: 1, batch_job_id: 1, endpoint: 1, completed_at: 1 } }).toArray();
  const inDay = (v) => { const t = ms(v); return t >= dayStart.getTime() && t < dayEnd.getTime(); };
  const all = [...supaByTime.map((r) => ({ ...r, store: 'supabase' })), ...mongo.map((r) => ({ ...r, store: 'mongo' }))];
  const realtime = all.filter((r) => r.mode !== 'batch' && inDay(r.timestamp));
  const inFlight = all.filter((r) => r.mode === 'batch' && PLACEHOLDER.has(r.status) && inDay(r.timestamp));
  const batch = [...supaBatch.map((r) => ({ ...r, store: 'supabase' })),
    ...mongo.filter((r) => r.mode === 'batch' && inDay(r.completed_at)).map((r) => ({ ...r, store: 'mongo' }))];
  return { realtime, batch, inFlight, rows: { supabase: supaByTime.length + supaBatch.length, mongo: mongo.length } };
}

/** Pages written on the day, by lane and writer, from the page's own provenance. */
async function readGot(db, dayStart, dayEnd, now) {
  const got = {};
  const written = new Set();
  for (const [field, lane] of [['ocr', 'ocr'], ['translation', 'translation']]) {
    const rows = await db.collection('pages').aggregate([
      { $match: { [`${field}.updated_at`]: { $gte: dayStart, $lt: dayEnd } } },
      { $group: { _id: { api: `$${field}.engine.api`, site: `$${field}.engine.call_site`, src: `$${field}.source` },
        pages: { $sum: 1 },
        stamped: { $sum: { $cond: [{ $ifNull: [`$${field}.engine.run.batch_job_id`, false] }, 1, 0] } } } },
    ], { allowDiskUse: true, maxTimeMS: 300_000 }).toArray();
    const L = { gemini_pages: 0, batch_pages: 0, realtime_pages: 0, stamped_pages: 0, other_pages: 0, by_writer: [] };
    for (const r of rows) {
      const api = r._id.api;
      if (api === 'batch') L.batch_pages += r.pages; else if (api === 'realtime') L.realtime_pages += r.pages; else L.other_pages += r.pages;
      if (api === 'batch' || api === 'realtime') L.gemini_pages += r.pages;
      L.stamped_pages += r.stamped;
      L.by_writer.push({ api: api || 'non-gemini', writer: r._id.site || r._id.src || '?', pages: r.pages, stamped: r.stamped });
    }
    L.by_writer.sort((a, b) => b.pages - a.pages);
    got[lane] = L;
    // Stamp keys from the day through NOW, so a job collected at 23:59 whose pages were written
    // a minute later still matches.
    const keys = await db.collection('pages').aggregate([
      { $match: { [`${field}.updated_at`]: { $gte: dayStart, $lt: now }, [`${field}.engine.run.batch_job_id`]: { $exists: true } } },
      { $group: { _id: { b: `$${field}.engine.run.batch_job_id`, j: `$${field}.engine.run.job_id` } } },
    ], { allowDiskUse: true, maxTimeMS: 300_000 }).toArray();
    for (const k of keys) for (const s of stampKeys({ batch_job_id: k._id.b, job_id: k._id.j })) written.add(s);
  }
  got.images = null;
  got.other = null;
  return { got, written };
}

const JOB_PROJECTION = {
  _id: 1, id: 1, type: 1, status: 1, page_ids: 1, page_count: 1, created_at: 1, completed_at: 1, force: 1,
  submitted_by: 1, cost_usd: 1, input_tokens: 1, output_tokens: 1, job_name: 1, gemini_job_name: 1, model: 1,
};

// ─────────────────────────────────────────── 5. bill check (weekly)

/** Four trailing 7-day windows ending at the start of the ledger day (the export lags ~1 day). */
async function billCheck(db, dayStart) {
  const sr = await import('./spend-reconcile.mjs');
  const token = await sr.googleToken();
  if (!token) return { unreadable: 'no Google access token (GOOGLE_SERVICE_ACCOUNT_JSON / gcloud)' };
  const from = new Date(dayStart.getTime() - 28 * DAY);
  const { rows, error } = await sr.bigQuery(token, `
    SELECT DATE(usage_start_time) AS day, SUM(cost) AS cost
    FROM ${sr.BILLING_EXPORT.table}
    WHERE service.description LIKE '%Gemini%'
      AND usage_start_time >= TIMESTAMP('${from.toISOString()}')
      AND usage_start_time < TIMESTAMP('${dayStart.toISOString()}')
    GROUP BY day`);
  if (error) return { unreadable: `BigQuery billing export: ${error}` };
  const billedByDay = Object.fromEntries(rows.map((r) => [String(r.day), Number(r.cost || 0)]));
  const weeks = [];
  for (let w = 3; w >= 0; w--) {
    const start = new Date(dayStart.getTime() - (w + 1) * 7 * DAY);
    const end = new Date(dayStart.getTime() - w * 7 * DAY);
    const [supa, mongo] = [await sr.meteredSupabase({ start, end }), await sr.meteredMongo(db, { start, end })];
    if (supa.error) return { unreadable: `Supabase metered: ${supa.error}` };
    let billed = 0;
    for (let d = start.getTime(); d < end.getTime(); d += DAY) billed += billedByDay[new Date(d).toISOString().slice(0, 10)] || 0;
    const metered = supa.cost + mongo.cost;
    const unlabelled = (supa.byEndpoint['(unlabelled)']?.cost || 0) + (mongo.byEndpoint['(unlabelled)']?.cost || 0);
    const attributed = metered - unlabelled;
    weeks.push({ from: start.toISOString().slice(0, 10), to: new Date(end.getTime() - DAY).toISOString().slice(0, 10),
      billed_usd: r2(billed), metered_usd: r2(metered), attributed_usd: r2(attributed),
      metered_pct: billed > 0 ? r2(100 * metered / billed) : null, attributed_pct: billed > 0 ? r2(100 * attributed / billed) : null });
  }
  if (weeks.every((w) => w.billed_usd === 0)) return { unreadable: 'billing export returned $0 for four weeks — a broken query, not a free month' };
  const first = weeks.find((w) => w.metered_pct != null), last = weeks[weeks.length - 1];
  return { computed_on: dayStart.toISOString().slice(0, 10), weeks,
    trend_pts: first && last.metered_pct != null ? r2(last.metered_pct - first.metered_pct) : null };
}

// ─────────────────────────────────────────── GitHub issue (dedupe by title)

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}
function openLedgerIssue() {
  const list = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title', '--limit', '20']) || '[]');
  return list.find((i) => i.title.startsWith(ISSUE_TITLE)) || null;
}
function fileOrUpdateIssue(report, text) {
  const body = `${report.verdict.fails.map((f) => `- **${f}**`).join('\n')}\n\n\`\`\`\n${text}\n\`\`\`\n\n`
    + `Ledger day ${report.day}; full row: ops_reports \`${report._id}\`, and /admin/spend. Filed by `
    + '`scripts/audit/paid-vs-got.mjs --apply` (#5499). It comments here while the FAIL stands and closes this when a run passes.';
  const open = openLedgerIssue();
  if (open) { gh(['issue', 'comment', String(open.number), '--body', body]); return `commented on #${open.number}`; }
  const url = gh(['issue', 'create', '--title', `${ISSUE_TITLE} — ${report.day}`, '--body', body]);
  return `filed ${url}`;
}
function closeIssueIfOpen(report) {
  const open = openLedgerIssue();
  if (!open) return 'no open ledger issue';
  gh(['issue', 'close', String(open.number), '--comment', `paid-vs-got passed for ${report.day} (${report.verdict.status}). Closing.`]);
  return `closed #${open.number}`;
}

// ─────────────────────────────────────────── text rendering

const $ = (n) => (n == null ? '—' : `$${Number(n).toFixed(2)}`);
const int = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

export function renderText(R) {
  const L = [];
  L.push(`═══ Paid vs got — ${R.day} (UTC) — ${R.verdict.status} ═══`);
  for (const f of R.verdict.fails) L.push(`  FAIL  ${f}`);
  for (const w of R.verdict.warns) L.push(`  WARN  ${w}`);
  L.push('');
  L.push('6. HEADLINE  (paid = collected usage rows, actual tokens; per 1,000 Gemini-written pages)');
  L.push(`  ${pad('lane', 12)}${lpad('paid', 11)}${lpad('batch', 11)}${lpad('submit est', 12)}${lpad('pages', 10)}${lpad('$/1k pp', 10)}${lpad('waste', 10)}${lpad('waste%', 8)}`);
  for (const h of R.headline) {
    L.push(`  ${pad(h.lane, 12)}${lpad($(h.paid_usd), 11)}${lpad($(h.batch_usd), 11)}${lpad($(h.estimate_usd), 12)}${lpad(int(h.pages_written), 10)}${lpad(h.per_1k_usd == null ? '—' : $(h.per_1k_usd), 10)}${lpad($(h.waste_usd), 10)}${lpad(h.waste_pct.toFixed(1) + '%', 8)}`);
  }
  for (const h of R.headline) {
    if (h.pages_written) L.push(`  ${h.lane}: ${$(h.paid_usd)} paid → ${int(h.pages_written)} pages written → ${$(h.per_1k_usd)} per 1,000 pages; ${h.waste_pct.toFixed(1)}% waste`);
  }
  L.push('');
  const C = R.collection;
  L.push(`1. COLLECTION  ${C.open} open (${C.at_gemini} at Gemini), oldest ${C.oldest_h} h; ${C.warn} WARN (>${WARN_AGE_H} h), ${C.fail} FAIL (>${FAIL_AGE_H} h)`);
  for (const i of C.flagged.slice(0, 20)) L.push(`    ${pad(i.level, 5)} ${pad(i.kind, 14)} ${pad(i.id, 40)} ${pad(i.state, 18)} ${lpad(i.age_h.toFixed(1) + ' h', 8)}${i.at_gemini ? '' : '  (nothing at Gemini)'}`);
  if (C.flagged.length > 20) L.push(`    … ${C.flagged.length - 20} more`);
  L.push(`  positive control: ${R.controls.positive.ok ? 'PASS' : 'BROKEN'} (fake 41 h job → ${R.controls.positive.job}, fake 41 h round → ${R.controls.positive.run})`);
  L.push('');
  L.push('2. GOT  pages written on the day, from page provenance');
  for (const lane of ['ocr', 'translation']) {
    const G = R.got[lane];
    L.push(`  ${pad(lane, 12)} gemini ${int(G.gemini_pages)} (batch ${int(G.batch_pages)}, stamped with a job id ${int(G.stamped_pages)}; realtime ${int(G.realtime_pages)}) · non-Gemini ${int(G.other_pages)}`);
    for (const w of G.by_writer.slice(0, 6)) L.push(`      ${pad(w.api, 11)} ${pad(w.writer, 46)} ${lpad(int(w.pages), 8)}`);
  }
  L.push('  images, other: no page count for these lanes (paid is reported; per-1k is not).');
  L.push('');
  L.push('3. PAID  collected usage rows, both stores (realtime by call time, batch by collection time)');
  L.push(`  ${pad('lane', 12)}${lpad('realtime', 11)}${lpad('batch', 11)}${lpad('submit est', 12)}${lpad('in tok', 10)}${lpad('out tok', 10)}${lpad('in flight', 11)}`);
  for (const l of LANES) {
    const P = R.paid.lane[l];
    L.push(`  ${pad(l, 12)}${lpad($(P.realtime_usd), 11)}${lpad($(P.batch_usd), 11)}${lpad($(P.batch_estimate_usd), 12)}${lpad((P.in_tok / 1e6).toFixed(1) + 'M', 10)}${lpad((P.out_tok / 1e6).toFixed(1) + 'M', 10)}${lpad($(P.in_flight_est_usd), 11)}`);
  }
  L.push(`  metered ${$(R.paid.metered_usd)} from ${int(R.usage_rows.supabase)} Supabase + ${int(R.usage_rows.mongo)} Mongo rows; "in flight" = submitted on the day, not yet collected (estimate).`);
  L.push('');
  const W = R.waste;
  L.push('4. WASTE');
  L.push(`  duplicate submissions (same page set < 1 h, unforced): ${W.duplicates.length} jobs, ${int(W.duplicates.reduce((a, d) => a + d.pages, 0))} pages, ${$(W.duplicate_usd)}${W.duplicates.some((d) => !d.actual) ? ' (some at submit estimate)' : ''}`);
  for (const d of W.duplicates.slice(0, 5)) L.push(`      ${d.id} ← ${d.original_id}  ${d.gap_s}s later  ${d.pages} pp  ${$(d.usd)}  ${d.status}  by ${d.submitted_by || '(no submitted_by)'}`);
  L.push(`  pages paid more than once (unforced, ${REPEAT_LOOKBACK_DAYS}-day lookback): ${int(W.repeat.pages)} pages in ${W.repeat.jobs} jobs, ${$(W.repeat.usd)}  (duplicates are a subset)`);
  L.push(`  collected, paid, wrote no page: ${W.nothing_jobs} jobs, ${$(W.nothing_usd)}  (upper bound — a page re-written later loses its stamp)`);
  for (const n of W.nothing.slice(0, 5)) L.push(`      ${n.batch_job_id}  ${n.lane}  ${$(n.usd)}  ${n.status}  ${n.endpoint || ''}`);
  L.push(`      not counted as waste: ${W.superseded.jobs} superseded by a later paid copy (${$(W.superseded.usd)}, counted on that copy); ${W.eval.jobs} eval/ shadow jobs (${$(W.eval.usd)}, write no pages by design)`);
  L.push(`  failed jobs carrying a cost: ${W.failed.real} real (${$(W.failed.real_usd)}, Gemini returned tokens), ${W.failed.phantom} phantom (${$(W.failed.phantom_usd)}, submit estimate only)`);
  L.push(`  unattributed (paid row, no endpoint): ${$(R.paid.unattributed_usd)} = ${R.paid.unattributed_pct.toFixed(1)}% of metered${Object.keys(R.paid.unattributed_by_type).length ? ' — ' + Object.entries(R.paid.unattributed_by_type).map(([k, v]) => `${k} ${$(v)}`).join(', ') : ''}`);
  L.push(`  batch jobs submitted with no submitted_by: ${W.no_submitter.jobs} jobs, ${$(W.no_submitter.usd)}`);
  L.push('');
  const B = R.bill;
  if (!B) L.push('5. BILL  not computed yet (runs Mondays, or --bill-check).');
  else if (B.unreadable) L.push(`5. BILL  UNREADABLE — ${B.unreadable}`);
  else {
    L.push(`5. BILL  invoice (BigQuery export) vs metered vs attributed — computed ${B.computed_on}${B.carried ? ' (carried forward)' : ''}`);
    L.push(`  ${pad('week', 26)}${lpad('billed', 11)}${lpad('metered', 11)}${lpad('attributed', 12)}${lpad('metered%', 10)}${lpad('attrib%', 9)}`);
    for (const w of B.weeks) L.push(`  ${pad(`${w.from} .. ${w.to}`, 26)}${lpad($(w.billed_usd), 11)}${lpad($(w.metered_usd), 11)}${lpad($(w.attributed_usd), 12)}${lpad(w.metered_pct == null ? '—' : w.metered_pct + '%', 10)}${lpad(w.attributed_pct == null ? '—' : w.attributed_pct + '%', 9)}`);
    L.push(`  trend (metered%, last week vs first): ${B.trend_pts == null ? '—' : (B.trend_pts > 0 ? '+' : '') + B.trend_pts + ' pts'}`);
  }
  return L.join('\n');
}

// ─────────────────────────────────────────── main

async function main() {
  const args = process.argv.slice(2);
  const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const APPLY = args.includes('--apply');
  const JSON_OUT = args.includes('--json');

  if (args.includes('--negative-control')) {
    const n = negativeControl(new Date());
    console.log(JSON.stringify(n, null, 2));
    console.log(n.ok ? 'NEGATIVE CONTROL PASS — nothing flagged' : 'NEGATIVE CONTROL FAILED — the check flags jobs it must not');
    process.exit(n.ok ? 0 : 2);
  }

  const now = new Date();
  const dayStr = arg('date') || new Date(now.getTime() - DAY).toISOString().slice(0, 10);
  const dayStart = new Date(`${dayStr}T00:00:00Z`);
  if (Number.isNaN(dayStart.getTime())) { console.error('--date must be YYYY-MM-DD'); process.exit(2); }
  const dayEnd = new Date(dayStart.getTime() + DAY);
  const inDay = (j) => { const t = ms(j.created_at); return t >= dayStart.getTime() && t < dayEnd.getTime(); };
  const BILL_DAY = args.includes('--bill-check') || now.getUTCDay() === 1;

  if (!process.env.MONGODB_URI) { console.error('MONGODB_URI not set — could not measure (exit 2)'); process.exit(2); }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30_000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  let exitCode = 0;
  try {
    // 1. collection
    const [openJobs, openRuns] = await Promise.all([
      db.collection('batch_jobs').find({ status: { $nin: [...BATCH_TERMINAL] } },
        { projection: { id: 1, type: 1, status: 1, created_at: 1, job_name: 1, gemini_job_name: 1, submitted_by: 1 } }).toArray(),
      db.collection('translate_batch_runs').find({ phase: { $nin: [...RUN_TERMINAL] } },
        { projection: { id: 1, mode: 1, phase: 1, book_id: 1, created_at: 1, updated_at: 1, 'round.job.submitted_at': 1,
          'translate_job.submitted_at': 1, 'repair_job.submitted_at': 1 } }).toArray(),
    ]);
    const collection = collectionCheck({ jobs: openJobs, runs: openRuns, now });
    const positive = positiveControl({ jobs: openJobs, runs: openRuns, now });

    // 2–3. got and paid
    const usage = await readUsage(db, dayStart, dayEnd);
    const paid = foldPaid(usage.realtime, usage.batch, usage.inFlight);
    const { got, written } = await readGot(db, dayStart, dayEnd, now);

    // 4. waste
    const jobs = await db.collection('batch_jobs').find({
      created_at: { $gte: new Date(dayStart.getTime() - REPEAT_LOOKBACK_DAYS * DAY), $lt: dayEnd },
      status: { $ne: 'submit_failed' },
    }, { projection: JOB_PROJECTION }).toArray();
    const usageByJob = new Map(usage.batch.filter((r) => r.batch_job_id).map((r) => [String(r.batch_job_id), r]));
    const duplicates = duplicateSubmissions(jobs.filter((j) => ms(j.created_at) >= dayStart.getTime() - DUP_WINDOW_MS), { inDay, usageByJob });
    const repeat = pagesPaidTwice(jobs, { inDay, usageByJob });
    const { nothing, superseded, eval: evalRows } = paidForNothing(usage.batch, written, repeat.superseded);
    const failedJobs = await db.collection('batch_jobs').find({ status: 'failed', completed_at: { $gte: dayStart, $lt: dayEnd } },
      { projection: { status: 1, cost_usd: 1, output_tokens: 1, completed_at: 1 } }).toArray();
    const failed = failedWithCost(failedJobs, { inDay: (j) => ms(j.completed_at) >= dayStart.getTime() && ms(j.completed_at) < dayEnd.getTime() });
    const { superseded: _payers, ...repeatOut } = repeat; // a Set does not belong in the stored row
    const dayJobs = jobs.filter(inDay).filter(reachedGemini);
    const noSub = dayJobs.filter((j) => !j.submitted_by);
    const nothingByLane = {};
    for (const n of nothing) nothingByLane[n.lane] = (nothingByLane[n.lane] || 0) + n.usd;
    const waste = {
      duplicates, duplicate_usd: r6(duplicates.reduce((a, d) => a + d.usd, 0)),
      repeat: repeatOut, repeat_by_lane: repeat.byLane,
      nothing: nothing.slice(0, 50), nothing_jobs: nothing.length, nothing_usd: r6(nothing.reduce((a, n) => a + n.usd, 0)), nothing_by_lane: nothingByLane,
      superseded: { jobs: superseded.length, usd: r6(superseded.reduce((a, n) => a + n.usd, 0)) },
      eval: { jobs: evalRows.length, usd: r6(evalRows.reduce((a, n) => a + n.usd, 0)) },
      failed,
      no_submitter: { jobs: noSub.length, usd: r6(noSub.reduce((a, j) => a + jobCost(j, usageByJob).usd, 0)) },
    };

    // 5. bill (weekly; carried forward otherwise)
    let bill = null;
    if (BILL_DAY) {
      bill = await billCheck(db, dayStart).catch((e) => ({ unreadable: e.message }));
    } else {
      const last = await db.collection('ops_reports').find({ type: REPORT_TYPE, 'bill.weeks': { $exists: true } })
        .sort({ day: -1 }).limit(1).toArray();
      if (last[0]?.bill) bill = { ...last[0].bill, carried: true };
    }

    const v = verdict({ collection, dupUsd: waste.duplicate_usd, unattributedPct: paid.unattributed_pct });
    const report = {
      _id: `paid-vs-got-${dayStr}`, type: REPORT_TYPE, day: dayStr, generated_at: now,
      generated_by: 'scripts/audit/paid-vs-got.mjs', verdict: v,
      headline: headline({ paid, got, waste }),
      collection: { ...collection, flagged: collection.flagged.slice(0, 100) },
      got, paid, waste, bill, usage_rows: usage.rows,
      controls: { positive },
    };
    const text = renderText(report);
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2)); else console.log(text);

    if (!positive.ok) {
      console.error('\nPOSITIVE CONTROL DID NOT FIRE — the collection check is broken. Exit 2 (could not measure).');
      exitCode = 2;
    } else if (v.status === 'FAIL') {
      exitCode = 1;
    } else if (BILL_DAY && bill?.unreadable) {
      console.error(`\nBill check could not run: ${bill.unreadable}. Exit 2.`);
      exitCode = 2;
    }

    if (!APPLY) {
      console.error(`\n(dry run — nothing written. --apply would upsert ops_reports ${report._id}${exitCode === 1 ? ' and file/update the ledger issue' : ''}.)`);
    } else {
      // THE write: one ops_reports document, read by /admin/spend.
      await db.collection('ops_reports').replaceOne({ _id: report._id }, report, { upsert: true });
      console.error(`\nwrote ops_reports ${report._id}`);
      try {
        if (exitCode === 1) console.error(fileOrUpdateIssue(report, text));
        else if (exitCode === 0) console.error(closeIssueIfOpen(report));
      } catch (e) {
        console.error(`GitHub issue step failed: ${String(e.stderr || e.message).split('\n')[0]}`);
        if (exitCode === 0) exitCode = 2;
      }
    }
  } finally {
    await client.close().catch(() => {});
  }
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (invokedDirectly) {
  // An uncaught throw is an instrument failure (2), never a finding (1).
  main().catch((e) => { console.error(`paid-vs-got could not run: ${e.message}`); process.exit(2); });
}
