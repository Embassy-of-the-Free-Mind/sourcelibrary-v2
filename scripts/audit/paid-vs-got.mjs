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
 *   8. GEMINI      the same guarantee asked from GEMINI's side (#6276): walk batches.list on
 *                  every key; every job Gemini says SUCCEEDED must have a record that was
 *                  collected (or is in flight, < 3 h since Gemini finished it). Section 1 only
 *                  sees NON-terminal rows, so a row wrongly written cancelled/failed is invisible
 *                  to it — this section is what sees it. Classes: succeeded-uncollected,
 *                  unknown-to-DB, DB-terminal-while-Gemini-alive (scripts/lib/gemini-batch-ledger.mjs).
 *                  Daily walks every job Gemini retains. A finding is a FAIL however old, until
 *                  a store says the job was collected or discarded on purpose (discardBatchJob,
 *                  scripts/maintenance/resolve-batch-findings.mjs): it used to drop to WARN at
 *                  48 h, which is how an unfixed loss went quiet (#6333). A SUCCEEDED job whose
 *                  every request failed (Gemini's batchStats) billed nothing and is not a finding.
 *   9. METER GAP   Google's own GenerateContent 2xx count (Cloud Monitoring request_count, per
 *                  project and key, hourly) against the day's non-batch usage rows (#4599). Rows
 *                  carry no key, so per project it reports a LOWER BOUND of unmetered calls (see
 *                  meterGap()). FAIL when that bound is > 25% of a project's calls and > 500.
 *                  Read with the same service account as the bill check (monitoring.read scope).
 *  10. REPEAT ASKS non-batch calls per (endpoint, type, book_id): a once-per-book question asked
 *                  more than 3 times in a day is the "paid call, failed write, asked again" loop
 *                  (#4599, ten days on the soma key before anyone saw it). WARN at any, FAIL at
 *                  ≥ 500 such calls. Proven only forward from 2026-10-11 (#6466 made that caller
 *                  write its row before the write that threw).
 *
 * HOURLY: --collection-only runs sections 1 and 8 only (Gemini window: jobs created in the last
 * 72 h, plus the last run's findings that have left that window, asked about by name), writes
 * ops_reports `paid-vs-got-collection` (with --apply), pages ntfy sourcelibrary-uptime when the set of findings changes, and keeps ONE issue open
 * ("paid-vs-got: batch collection FAIL") while findings stand — closed by a passing run.
 *
 * FAIL (exit 1) when: a batch is open past 40 h; Gemini finished a job that nothing
 * collected or discarded (or is running one the DB calls over); duplicate-submission spend > $1/day;
 * unattributed paid usage > 5% of metered; a project's meter gap (9); or ≥ 500 repeat asks (10).
 * Exit 2 = could not measure (a store unreadable, a Gemini key that cannot be listed, a project
 * Cloud Monitoring will not read, a positive control that did not fire, the bill unreadable on
 * a bill day). 0 = ran, clean (WARNs included). Never branch on != 0 — measurement-instruments.md.
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
 *   node --env-file=.env.production.local scripts/audit/paid-vs-got.mjs --collection-only [--apply]  # hourly
 *   ... --no-gemini   skip section 8 (the run is then not a statement about Gemini's side)
 *   ... --no-meter-gap   skip section 9 (no Cloud Monitoring read)
 *   node scripts/audit/paid-vs-got.mjs --negative-control                                 # no DB
 *   ... --json   machine-readable report on stdout
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { estimateBatchCostUsd } from '../workers/lib/supabase-usage-logger.mjs';
import {
  listAllBatches, readLedgerRecords, classifyLedger, countFindings, ledgerPositiveControl,
  makeSupabaseUsageReader, settleFindings, carryForwardFindings, HOURLY_WINDOW_H, IN_FLIGHT_GRACE_H, LEDGER_CLASSES,
} from '../lib/gemini-batch-ledger.mjs';

const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const WARN_AGE_H = 24;
export const FAIL_AGE_H = 40;
export const DUP_WINDOW_MS = HOUR;
export const DUP_FAIL_USD = 1;
export const UNATTRIBUTED_FAIL_PCT = 5;
const REPEAT_LOOKBACK_DAYS = 7;
const ISSUE_TITLE = 'paid-vs-got: daily ledger FAIL';
export const COLLECTION_ISSUE_TITLE = 'paid-vs-got: batch collection FAIL';
export const REPORT_TYPE = 'paid_vs_got_daily';
export const COLLECTION_REPORT_TYPE = 'paid_vs_got_collection';
const NTFY_TOPIC = process.env.PAID_VS_GOT_NTFY || 'https://ntfy.sh/sourcelibrary-uptime';

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
 * which writes no pages by design. A third: `bookLevel`, the usage ids of book-level batches
 * (the enrich lane meters `<enrichJobId>:<bookId>` and writes book indexes and summaries, never a
 * page stamp) whose book took the output — see bookLevelDelivered(). Before this split the whole
 * enrich lane read as waste: 2026-10-10 showed 24.3% waste, $9.61 of it four enrich jobs that
 * moved 175 books to done.
 */
export function paidForNothing(batchRows, written, superseded = new Set(), bookLevel = new Set()) {
  const nothing = [], supersededRows = [], evalRows = [], bookRows = [];
  for (const r of batchRows) {
    if (PLACEHOLDER.has(r.status) || !((r.cost_usd || 0) > 0) || !r.batch_job_id) continue;
    if (written.has(String(r.batch_job_id))) continue;
    const row = { batch_job_id: r.batch_job_id, lane: laneOf(r.type), usd: r6(r.cost_usd), status: r.status,
      pages: r.page_count || 0, endpoint: r.endpoint || null };
    if (superseded.has(String(r.batch_job_id))) supersededRows.push(row);
    else if (String(r.endpoint || '').startsWith('eval/')) evalRows.push(row);
    else if (bookLevel.has(String(r.batch_job_id))) bookRows.push(row);
    else nothing.push(row);
  }
  const byUsd = (a, b) => b.usd - a.usd;
  return { nothing: nothing.sort(byUsd), superseded: supersededRows.sort(byUsd), eval: evalRows.sort(byUsd), book_level: bookRows.sort(byUsd) };
}

/** An enrich-lane usage id is `<enrichJobId>:<bookId>`, the job id always starting `enrich-`. */
export function parseBookLevelId(batchJobId) {
  const m = /^(enrich-[^:]+):(.+)$/.exec(String(batchJobId || ''));
  return m ? { job: m[1], book: m[2] } : null;
}

/**
 * Did the book take the output it was billed for? The enrich lane's state row says: `failed` and
 * `dropped` mean the response was thrown away, and `<stage>_submitted` means it was never applied.
 * Every other stage (index_collected, indexed, done, ...) is a book past the paid step.
 */
export function bookLevelDelivered(stage) {
  return !!stage && stage !== 'failed' && stage !== 'dropped' && !String(stage).endsWith('_submitted');
}

/** The set of enrich usage ids whose book took the output, read from enrich_batch_books. */
async function readBookLevel(db, batchRows) {
  const ids = new Map();
  for (const r of batchRows) { const p = parseBookLevelId(r.batch_job_id); if (p) ids.set(String(r.batch_job_id), p.book); }
  if (!ids.size) return new Set();
  const states = await db.collection('enrich_batch_books').find({ _id: { $in: [...new Set(ids.values())] } },
    { projection: { stage: 1 } }).toArray();
  const stageOf = new Map(states.map((s) => [String(s._id), s.stage]));
  return new Set([...ids].filter(([, book]) => bookLevelDelivered(stageOf.get(book))).map(([id]) => id));
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

// ─────────────────────────────────────────── 9. meter gap per project and key (pure)

/** Methods that are one realtime generation each. BatchGenerateContent is a batch submit, not a call. */
const GENERATE_METHODS = /\.(GenerateContent|StreamGenerateContent)$/;
/** Usage-row types that are not a GenerateContent call (EmbedContent / BatchEmbedContents). */
const NOT_GENERATE_TYPES = new Set(['embedding']);

/** The meter side: the day's non-batch usage rows bucketed by UTC hour of their call time. */
export function meterByHour(realtimeRows, dayStart) {
  const h = new Array(24).fill(0);
  const t0 = ms(dayStart);
  for (const r of realtimeRows) {
    if (NOT_GENERATE_TYPES.has(r.type)) continue;
    const i = Math.floor((ms(r.timestamp) - t0) / HOUR);
    if (i >= 0 && i < 24) h[i]++;
  }
  return h;
}

/**
 * Google's GenerateContent 2xx count against the meter, per project and per key (#4599).
 *
 * A usage row carries no key, so the meter cannot be split by project. What CAN be said per
 * project is a lower bound: in any hour, the calls a project made beyond EVERY metered call in
 * that hour cannot all have been metered. Summed over hours, that is unmetered calls the project
 * certainly made. It only ever under-reports (rows from projects not read here, failed rows,
 * other keys' rows all count as credit), so a flag is real. Hourly, not daily, because a day sum
 * lets one hour's surplus hide another hour's gap: on 2026-10-02 a 42K-call eval made the day
 * read 22% while the soma loop ran unmetered through every quiet hour.
 *
 * `projects`: [{ id, name, keys: { credential_id: number[24] }, error? }]. `meterHours`: number[24].
 * Flag a project when its lower bound > METER_GAP_PCT of its calls AND > METER_GAP_MIN_CALLS.
 */
export const METER_GAP_PCT = 25;
export const METER_GAP_MIN_CALLS = 500;
export function meterGap({ projects = [], meterHours = new Array(24).fill(0) }) {
  const lb = (hours) => hours.reduce((a, g, i) => a + Math.max(0, g - (meterHours[i] || 0)), 0);
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const flagged = (calls, lower) => lower > METER_GAP_MIN_CALLS && 100 * lower / Math.max(calls, 1) > METER_GAP_PCT;
  const out = [];
  const total = new Array(24).fill(0);
  const unreadable = [];
  for (const p of projects) {
    if (p.error) { unreadable.push({ project: p.name, id: p.id, error: p.error }); continue; }
    const hours = new Array(24).fill(0);
    const keys = [];
    for (const [cred, kh] of Object.entries(p.keys || {})) {
      for (let i = 0; i < 24; i++) { hours[i] += kh[i] || 0; total[i] += kh[i] || 0; }
      const calls = sum(kh), lower = lb(kh);
      keys.push({ key: cred, calls, unmetered_min: lower, pct: calls ? r2(100 * lower / calls) : 0, flag: flagged(calls, lower) });
    }
    keys.sort((a, b) => b.unmetered_min - a.unmetered_min);
    const calls = sum(hours), lower = lb(hours);
    out.push({ project: p.name, id: p.id, calls, unmetered_min: lower, pct: calls ? r2(100 * lower / calls) : 0,
      flag: flagged(calls, lower), keys });
  }
  const gCalls = sum(total), metered = sum(meterHours);
  return {
    projects: out, unreadable, google_calls: gCalls, metered_calls: metered,
    day_gap: gCalls - metered, hourly_unmetered_min: lb(total),
    hourly_pct: gCalls ? r2(100 * lb(total) / gCalls) : 0,
    flagged: out.filter((p) => p.flag).map((p) => p.project),
  };
}

/**
 * Positive control, every run: a fake project making twice the whole meter plus 300 calls every
 * hour must flag — at least half its calls are unmetered whatever the day's meter looks like.
 */
export function meterGapControl(meterHours) {
  const fake = { id: '__control__', name: '__control__', keys: { 'apikey:__control__': meterHours.map((m) => 2 * (m || 0) + 300) } };
  return { ok: meterGap({ projects: [fake], meterHours }).flagged.includes('__control__') };
}

// ─────────────────────────────────────────── 10. repeat asks (pure)

export const REPEAT_ASK_MIN = 4; // "more than 3 calls" for one book on one endpoint in a day
export const REPEAT_ASK_FAIL_CALLS = 500;

/**
 * Non-batch calls grouped by (endpoint, type, book_id) — the shape of "paid call, failed write,
 * asked again" (#4599: Phase 1.6 asked ~40 books every 2 min for ten days). Type is in the key
 * because one worker endpoint runs several once-per-book tasks (worker/hetzner-enrich: quality,
 * summary, index, chapters) on the same book.
 *
 * A pair is BOOK-LEVEL when no row names a page (page_count 0 and no page_ids — Mongo-store rows
 * from scripts carry page_ids, not page_count): the question was about the book, so a
 * book asked more than three times a day is the loop shape. Per-page endpoints (OCR, translate
 * batches) legitimately call hundreds of times per book; they are counted and shown in the top
 * list, never flagged, because a usage row carries no page id to tell a re-ask from the next page.
 *
 * Only proven forward from 2026-10-11: before #6466 the looping caller wrote its row after the
 * write that threw, so the loop left no rows to group.
 */
export function repeatAsks(rows) {
  const pairs = new Map();
  for (const r of rows) {
    if (!r.book_id) continue;
    const k = `${r.endpoint || '(no endpoint)'}\u0000${r.type || '?'}\u0000${r.book_id}`;
    let p = pairs.get(k);
    if (!p) pairs.set(k, p = { endpoint: r.endpoint || '(no endpoint)', type: r.type || null, book_id: String(r.book_id),
      calls: 0, failed: 0, usd: 0, book_level: true });
    p.calls++;
    p.usd += r.cost_usd || 0;
    if (r.status === 'failed') p.failed++;
    if ((r.page_count || 0) > 0 || r.page_ids?.length) p.book_level = false;
  }
  const all = [...pairs.values()].map((p) => ({ ...p, usd: r6(p.usd) })).sort((a, b) => b.calls - a.calls);
  const repeats = all.filter((p) => p.book_level && p.calls >= REPEAT_ASK_MIN);
  const byEndpoint = {};
  for (const p of repeats) {
    const e = byEndpoint[p.endpoint] ||= { books: 0, calls: 0, usd: 0 };
    e.books++; e.calls += p.calls; e.usd = r6(e.usd + p.usd);
  }
  return {
    pairs: all.length,
    repeats: repeats.slice(0, 100), repeat_pairs: repeats.length,
    repeat_calls: repeats.reduce((a, p) => a + p.calls, 0),
    repeat_usd: r6(repeats.reduce((a, p) => a + p.usd, 0)),
    by_endpoint: byEndpoint,
    per_page_over: all.filter((p) => !p.book_level && p.calls >= REPEAT_ASK_MIN).length,
    top: all.slice(0, 10),
  };
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

export function verdict({ collection, dupUsd = 0, unattributedPct = 0, gemini = null, meter = null, repeats = null }) {
  const fails = [];
  const warns = [];
  if (collection.fail) fails.push(`${collection.fail} batch job(s) open at Gemini past ${FAIL_AGE_H} h (expire at 48 h)`);
  if (collection.warn) warns.push(`${collection.warn} open job(s) past ${WARN_AGE_H} h`);
  if (gemini?.counts) {
    const c = gemini.counts;
    const label = { succeeded_uncollected: 'Gemini SUCCEEDED, our record never collected it',
      unknown_to_db: 'Gemini SUCCEEDED, no store records the job',
      terminal_while_alive: 'Gemini still running, every record we hold says it is over' };
    // Every finding is a FAIL however old (#6333): a loss nobody collected or discarded on
    // purpose used to drop to WARN at 48 h and stop paging.
    for (const k of LEDGER_CLASSES) {
      if (c[k].jobs) fails.push(`${c[k].jobs} batch job(s): ${label[k]} (${c[k].pages.toLocaleString('en-US')} pp)`);
    }
  }
  if (dupUsd > DUP_FAIL_USD) fails.push(`duplicate-submission spend $${dupUsd.toFixed(2)} > $${DUP_FAIL_USD}/day`);
  if (unattributedPct > UNATTRIBUTED_FAIL_PCT) fails.push(`unattributed paid usage ${unattributedPct.toFixed(1)}% > ${UNATTRIBUTED_FAIL_PCT}% of metered`);
  for (const p of meter?.projects || []) {
    if (p.flag) fails.push(`meter gap: Google saw ${p.calls.toLocaleString('en-US')} GenerateContent calls on ${p.project}; at least ${p.unmetered_min.toLocaleString('en-US')} (${p.pct}%) wrote no usage row`);
  }
  if (repeats?.repeat_pairs) {
    const msg = `repeat asks: ${repeats.repeat_pairs} book(s) asked the same once-per-book question more than ${REPEAT_ASK_MIN - 1} times (${repeats.repeat_calls.toLocaleString('en-US')} calls, $${repeats.repeat_usd.toFixed(2)})`;
    if (repeats.repeat_calls >= REPEAT_ASK_FAIL_CALLS) fails.push(msg); else warns.push(msg);
  }
  return { status: fails.length ? 'FAIL' : warns.length ? 'WARN' : 'PASS', fails, warns };
}

// ─────────────────────────────────────────── readers

const clean = (v) => (v || '').replace(/\\n/g, '').trim();

/** Row-level read of the Supabase store. Throws (→ exit 2) rather than return a partial day. */
async function supabaseRows(qs) {
  const url = clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — the primary usage store is unreadable');
  const select = 'id,timestamp,type,mode,model,book_id,page_count,input_tokens,output_tokens,cost_usd,status,batch_job_id,endpoint,completed_at';
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
  }, { projection: { _id: 0, timestamp: 1, type: 1, mode: 1, model: 1, book_id: 1, page_count: 1, page_ids: 1, input_tokens: 1, output_tokens: 1,
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

// ─────────────────────────────────────────── 9. meter gap reader (Cloud Monitoring)

/** The projects whose GenerateContent traffic the meter must cover (ids: spend-reconcile PROJECTS). */
const METER_GAP_PROJECTS = ['booksplit', 'soma', 'Sourcelibrary'];

/**
 * GenerateContent 2xx per project, per key (`resource.labels.credential_id`), per UTC hour, from
 * serviceruntime request_count. No crossSeriesReducer (spend-reconcile trap A): the raw series are
 * summed here. A project that answers 403 is UNREADABLE, never zero — the grant is
 * roles/monitoring.viewer on that project for the spend-reconcile service account (a human step).
 */
export async function readGoogleCalls(dayStart, dayEnd) {
  const sr = await import('./spend-reconcile.mjs');
  const projects = sr.PROJECTS.filter((p) => METER_GAP_PROJECTS.includes(p.name));
  const token = await sr.googleToken();
  if (!token) return { unreadable: 'no Google access token (GOOGLE_SERVICE_ACCOUNT_JSON / gcloud)' };
  const out = [];
  for (const p of projects) {
    const q = new URLSearchParams();
    q.set('filter', 'metric.type="serviceruntime.googleapis.com/api/request_count" AND resource.type="consumed_api"'
      + ' AND resource.labels.service="generativelanguage.googleapis.com" AND metric.labels.response_code_class="2xx"');
    q.set('interval.startTime', dayStart.toISOString());
    q.set('interval.endTime', dayEnd.toISOString());
    q.set('aggregation.alignmentPeriod', '3600s');
    q.set('aggregation.perSeriesAligner', 'ALIGN_SUM');
    const keys = {};
    try {
      let pageToken = '';
      do {
        if (pageToken) q.set('pageToken', pageToken);
        const r = await fetch(`https://monitoring.googleapis.com/v3/projects/${p.id}/timeSeries?${q}`,
          { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = j?.error?.message || `HTTP ${r.status}`;
          throw new Error(r.status === 403 ? `${msg} — needs roles/monitoring.viewer on ${p.id} (human grant)` : msg);
        }
        for (const s of j.timeSeries || []) {
          if (!GENERATE_METHODS.test(s.resource?.labels?.method || '')) continue;
          const cred = s.resource?.labels?.credential_id || 'unknown';
          const h = keys[cred] ||= new Array(24).fill(0);
          for (const pt of s.points || []) {
            const i = Math.floor((ms(pt.interval?.startTime) - dayStart.getTime()) / HOUR);
            if (i >= 0 && i < 24) h[i] += Number(pt.value?.int64Value || 0);
          }
        }
        pageToken = j.nextPageToken || '';
      } while (pageToken);
      out.push({ id: p.id, name: p.name, keys });
    } catch (e) {
      out.push({ id: p.id, name: p.name, error: e.message });
    }
  }
  return { projects: out };
}

// ─────────────────────────────────────────── 8. Gemini side (#6276)

/** Every unique Gemini key the pipeline submits with — the collector's list. */
export function geminiKeys(env = process.env) {
  const clean = (v) => (v || '').replace(/\\n/g, '').trim();
  const all = [env.GEMINI_API_KEY, ...Array.from({ length: 9 }, (_, i) => env[`GEMINI_API_KEY_${i + 2}`]), env.GEMINI_API_KEY_TIER3]
    .map(clean).filter(Boolean);
  return [...new Set(all)];
}

/**
 * Section 8. `windowH` null = every job Gemini retains (daily); a number = jobs created in that
 * window (hourly). Returns the section; `unknown` non-empty means it could not be measured.
 */
async function geminiSection(db, { now, windowH, log, prevFindings = [] }) {
  const keys = geminiKeys();
  if (!keys.length) return { unknown: ['no GEMINI_API_KEY* set — Gemini side not measured'] };
  const { GoogleGenAI } = await import('@google/genai');
  const clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));
  const sinceMs = windowH == null ? null : now.getTime() - windowH * HOUR;
  const listing = await listAllBatches(clients, { keys, sinceMs, log });
  const supabaseUsage = makeSupabaseUsageReader({
    url: clean(process.env.SUPABASE_URL) || 'https://ykhxaecbbxaaqlujuzde.supabase.co',
    key: clean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  });
  const unknown = [...listing.unknown];
  // Findings of the last run that have left the window stay findings until resolved.
  const carried = windowH == null ? 0 : await carryForwardFindings(prevFindings, listing.jobs, keys, { now });
  if (!supabaseUsage) unknown.push('SUPABASE_SERVICE_ROLE_KEY not set — usage rows (how one-off scripts record their jobs) unreadable');
  let records = new Map();
  try {
    records = await readLedgerRecords(db, listing.jobs, { supabaseUsage, log });
  } catch (e) {
    unknown.push(`records unreadable: ${e.message}`);
  }
  const res = classifyLedger({ jobs: listing.jobs, records, now });
  const positive = ledgerPositiveControl({ jobs: listing.jobs, records, now });
  const settled = await settleFindings(res, keys);
  return {
    window_h: windowH, listed: res.listed, per_key: listing.perKey, unknown,
    counts: countFindings(res.findings), ok_counts: res.ok_counts, grace_h: IN_FLIGHT_GRACE_H,
    findings: res.findings.slice(0, 200), findings_total: res.findings.length, request_counts_asked: settled.asked,
    carried_forward: carried, empty: settled.empty.slice(0, 50),
    positive,
  };
}

export function renderGemini(G) {
  const L = [];
  if (!G) return '8. GEMINI  not run (--no-gemini).';
  if (!G.counts) { L.push(`8. GEMINI  UNKNOWN — ${G.unknown.join('; ')}`); return L.join('\n'); }
  L.push(`8. GEMINI  ${G.listed.toLocaleString('en-US')} jobs listed (${G.window_h == null ? 'everything Gemini retains' : `created in the last ${G.window_h} h`}); `
    + `ok: ${G.ok_counts.collected} collected, ${G.ok_counts.in_flight} in flight (< ${G.grace_h} h since Gemini finished), ${G.ok_counts.discarded} discarded on purpose, ${G.ok_counts.twin_collected} re-submissions whose twin was collected (paid twice, not lost), ${G.ok_counts.empty || 0} finished with every request cancelled (nothing billed), ${G.ok_counts.alive_tracked} running and tracked`
    + (G.carried_forward ? `; ${G.carried_forward} finding(s) carried forward from the last run (older than the window)` : ''));
  if (G.unknown.length) for (const u of G.unknown) L.push(`  UNKNOWN  ${u}`);
  L.push(`  ${pad('class', 26)}${lpad('jobs', 7)}${lpad('pages', 10)}`);
  for (const k of LEDGER_CLASSES) {
    const c = G.counts[k];
    L.push(`  ${pad(k, 26)}${lpad(int(c.jobs), 7)}${lpad(int(c.pages), 10)}`);
  }
  for (const f of G.findings.slice(0, 15)) {
    L.push(`    ${f.output_gone ? 'GONE' : 'FAIL'}  ${pad(f.class, 22)} ${pad(f.name, 48)} ${pad(f.display_name || '', 34).slice(0, 34)} ${lpad(f.since_end_h == null ? 'running' : f.since_end_h + ' h', 9)} ${lpad(int(f.pages), 6)} pp  ${f.records.join(', ') || '(no record)'}`);
  }
  if (G.findings_total > 15) L.push(`    … ${G.findings_total - 15} more (ops_reports row holds the first 200)`);
  L.push(`  keys: ${G.per_key.map((k) => `${k.key_index}${k.canonical !== k.key_index ? `=${k.canonical}` : ''}:${k.error ? 'ERROR' : `${k.listed}/${k.stop}`}`).join(' ')}`);
  L.push(`  positive control: ${G.positive.ok ? 'PASS' : 'BROKEN'} (uncollected → ${G.positive.succeeded_uncollected}, unknown → ${G.positive.unknown_to_db}, alive → ${G.positive.terminal_while_alive})`);
  return L.join('\n');
}

/** A stable key per finding, so the hourly run pages and comments only when the set changes. */
const findingKeys = (G) => (G?.findings || []).map((f) => `${f.class}:${f.name}`).sort();

async function page(title, body, priority) {
  const res = await fetch(NTFY_TOPIC, { method: 'POST', headers: { Title: title, Priority: priority, Tags: 'moneybag' }, body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
}

// ─────────────────────────────────────────── GitHub issue (dedupe by title)

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}
function openLedgerIssue(title = ISSUE_TITLE) {
  const list = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${title}" in:title`, '--json', 'number,title', '--limit', '20']) || '[]');
  return list.find((i) => i.title.startsWith(title)) || null;
}
function fileOrUpdateIssue(report, text, { title = ISSUE_TITLE, footer = null } = {}) {
  const body = `${report.verdict.fails.map((f) => `- **${f}**`).join('\n')}\n\n\`\`\`\n${text}\n\`\`\`\n\n`
    + (footer || (`Ledger day ${report.day}; full row: ops_reports \`${report._id}\`, and /admin/spend. Filed by `
    + '`scripts/audit/paid-vs-got.mjs --apply` (#5499). It comments here while the FAIL stands and closes this when a run passes.'));
  const open = openLedgerIssue(title);
  if (open) { gh(['issue', 'comment', String(open.number), '--body', body]); return `commented on #${open.number}`; }
  const url = gh(['issue', 'create', '--title', `${title} — ${report.day}`, '--body', body]);
  return `filed ${url}`;
}
function closeIssueIfOpen(report, title = ISSUE_TITLE) {
  const open = openLedgerIssue(title);
  if (!open) return `no open "${title}" issue`;
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
  L.push(`      not counted as waste: ${W.superseded.jobs} superseded by a later paid copy (${$(W.superseded.usd)}, counted on that copy); ${W.eval.jobs} eval/ shadow jobs (${$(W.eval.usd)}, write no pages by design)${W.book_level ? `; ${W.book_level.jobs} book-level enrich requests whose book took the output (${$(W.book_level.usd)})` : ''}`);
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
  if (R.gemini !== undefined) { L.push(''); L.push(renderGemini(R.gemini)); }
  if (R.meter_gap !== undefined) { L.push(''); L.push(renderMeterGap(R.meter_gap)); }
  if (R.repeat_asks) { L.push(''); L.push(renderRepeatAsks(R.repeat_asks)); }
  return L.join('\n');
}

export function renderMeterGap(M) {
  if (!M) return '9. METER GAP  not run (--no-meter-gap).';
  if (M.unreadable_all) return `9. METER GAP  UNREADABLE — ${M.unreadable_all}`;
  const L = [];
  L.push(`9. METER GAP  Google GenerateContent 2xx vs non-batch usage rows; "unmetered ≥" = Σ hours max(0, Google − every metered call that hour) — a lower bound`);
  L.push(`  all three projects: Google ${int(M.google_calls)}, metered ${int(M.metered_calls)}, day gap ${int(M.day_gap)}; hourly unmetered ≥ ${int(M.hourly_unmetered_min)} (${M.hourly_pct}%)`);
  L.push(`  ${pad('project / key', 50)}${lpad('Google', 9)}${lpad('unmetered≥', 12)}${lpad('%', 7)}`);
  for (const p of M.projects) {
    L.push(`  ${p.flag ? 'FAIL ' : '     '}${pad(p.project, 45)}${lpad(int(p.calls), 9)}${lpad(int(p.unmetered_min), 12)}${lpad(p.pct + '%', 7)}`);
    for (const k of p.keys.filter((x) => x.calls > 0).slice(0, 5)) {
      L.push(`         ${pad(k.key, 41)}${lpad(int(k.calls), 9)}${lpad(int(k.unmetered_min), 12)}${lpad(k.pct + '%', 7)}`);
    }
  }
  for (const u of M.unreadable) L.push(`  UNREADABLE  ${u.project} (${u.id}): ${u.error}`);
  L.push(`  flag: unmetered ≥ ${METER_GAP_PCT}% of a project's calls AND > ${METER_GAP_MIN_CALLS} calls. positive control: ${M.control?.ok ? 'PASS' : 'BROKEN'}`);
  return L.join('\n');
}

export function renderRepeatAsks(A) {
  const L = [];
  L.push(`10. REPEAT ASKS  non-batch calls per (endpoint, type, book); a once-per-book question (page_count 0) asked ≥ ${REPEAT_ASK_MIN}× in the day`);
  L.push(`  ${A.repeat_pairs} book(s), ${int(A.repeat_calls)} calls, ${$(A.repeat_usd)}; WARN at any, FAIL at ≥ ${REPEAT_ASK_FAIL_CALLS} calls. ${A.per_page_over} per-page pair(s) ≥ ${REPEAT_ASK_MIN} calls not flagged (no page id on a row).`);
  for (const [e, v] of Object.entries(A.by_endpoint)) L.push(`    ${pad(e, 46)} ${lpad(v.books, 4)} books ${lpad(int(v.calls), 7)} calls ${lpad($(v.usd), 9)}`);
  for (const p of A.repeats.slice(0, 20)) L.push(`      ${pad(p.endpoint, 40)} ${pad(p.type || '', 20)} ${pad(p.book_id, 26)} ${lpad(p.calls, 5)}×${p.failed ? `  (${p.failed} failed)` : ''}`);
  if (A.repeat_pairs > 20) L.push(`      … ${A.repeat_pairs - 20} more`);
  L.push('  top 10 (endpoint, type, book) by calls:');
  for (const p of A.top) L.push(`      ${pad(p.endpoint, 40)} ${pad(p.type || '', 20)} ${pad(p.book_id, 26)} ${lpad(p.calls, 5)}×  ${p.book_level ? 'book-level' : 'per-page'}${p.failed ? `, ${p.failed} failed` : ''}`);
  return L.join('\n');
}

/** The hourly report: section 1 (DB side) and section 8 (Gemini side) only. */
export function renderCollectionText(R) {
  const L = [];
  L.push(`═══ Paid vs got — batch collection, ${R.generated_at.toISOString().slice(0, 16)}Z — ${R.verdict.status} ═══`);
  for (const f of R.verdict.fails) L.push(`  FAIL  ${f}`);
  for (const w of R.verdict.warns) L.push(`  WARN  ${w}`);
  L.push('');
  const C = R.collection;
  L.push(`1. COLLECTION (DB side)  ${C.open} open (${C.at_gemini} at Gemini), oldest ${C.oldest_h} h; ${C.warn} WARN (>${WARN_AGE_H} h), ${C.fail} FAIL (>${FAIL_AGE_H} h)`);
  for (const i of C.flagged.slice(0, 10)) L.push(`    ${pad(i.level, 5)} ${pad(i.kind, 14)} ${pad(i.id, 40)} ${pad(i.state, 18)} ${lpad(i.age_h.toFixed(1) + ' h', 8)}`);
  if (C.flagged.length > 10) L.push(`    … ${C.flagged.length - 10} more`);
  L.push(`  positive control: ${R.controls.positive.ok ? 'PASS' : 'BROKEN'}`);
  L.push('');
  L.push(renderGemini(R.gemini));
  return L.join('\n');
}

// ─────────────────────────────────────────── main

/**
 * The hourly run. Writes (with --apply) one rolling ops_reports row, pages ntfy when the set of
 * actionable findings CHANGES (new ones, or all cleared) — not every hour a finding stands — and
 * keeps one issue: filed on the first FAIL, commented when the set changes, closed on a PASS.
 */
async function collectionOnly(db, { now, collection, positive, gemini, geminiUnknown, geminiForVerdict, APPLY, JSON_OUT }) {
  const v = verdict({ collection, gemini: geminiForVerdict });
  const report = {
    _id: 'paid-vs-got-collection', type: COLLECTION_REPORT_TYPE, day: now.toISOString().slice(0, 13) + 'Z', generated_at: now,
    generated_by: 'scripts/audit/paid-vs-got.mjs --collection-only', verdict: v,
    collection: { ...collection, flagged: collection.flagged.slice(0, 100) }, gemini,
    controls: { positive, gemini: gemini?.positive || null },
    finding_keys: findingKeys(gemini),
  };
  const text = renderCollectionText(report);
  if (JSON_OUT) console.log(JSON.stringify(report, null, 2)); else console.log(text);

  let exitCode = 0;
  if (!positive.ok) { console.error('\nPOSITIVE CONTROL DID NOT FIRE (DB side). Exit 2.'); exitCode = 2; }
  else if (v.status === 'FAIL') exitCode = 1;
  else if (geminiUnknown) { console.error(`\nGemini side UNKNOWN: ${(gemini?.unknown || []).join('; ') || 'positive control did not fire'}. Exit 2 — not clear.`); exitCode = 2; }

  if (!APPLY) {
    console.error(`\n(dry run — nothing written. --apply would replace ops_reports ${report._id}, page ntfy on a changed finding set, and file/comment/close "${COLLECTION_ISSUE_TITLE}".)`);
    return exitCode;
  }
  const prev = await db.collection('ops_reports').findOne({ _id: report._id }, { projection: { paged_keys: 1, verdict: 1 } });
  const prevKeys = prev?.paged_keys || [];
  const fresh = report.finding_keys.filter((k) => !prevKeys.includes(k));
  const cleared = exitCode === 0 && prevKeys.length > 0;
  report.paged_keys = prevKeys;
  if (exitCode === 1 && (fresh.length || (prev?.verdict?.status !== 'FAIL'))) {
    try {
      await page(`Gemini batches not collected: ${v.fails.length} finding(s)`, `${v.fails.join('\n')}\n\nscripts/audit/paid-vs-got.mjs --collection-only (#6276)`, 'high');
      report.paged_keys = report.finding_keys;
    } catch (e) { console.error(`ntfy page failed (${e.message}) — will page again next run`); }
    try { console.error(fileOrUpdateIssue(report, text, { title: COLLECTION_ISSUE_TITLE,
      footer: 'Filed by `scripts/audit/paid-vs-got.mjs --collection-only --apply` (#6276), hourly. It comments here when the set of findings changes and closes this when a run passes. Rolling row: ops_reports `paid-vs-got-collection`.' })); }
    catch (e) { console.error(`GitHub issue step failed: ${String(e.stderr || e.message).split('\n')[0]}`); }
  } else if (exitCode === 0) {
    if (cleared) {
      try { await page('Gemini batch collection clear', 'paid-vs-got --collection-only passed.', 'default'); report.paged_keys = []; }
      catch (e) { console.error(`ntfy page failed (${e.message})`); }
    }
    try { console.error(closeIssueIfOpen(report, COLLECTION_ISSUE_TITLE)); }
    catch (e) { console.error(`GitHub issue step failed: ${String(e.stderr || e.message).split('\n')[0]}`); exitCode = 2; }
  }
  await db.collection('ops_reports').replaceOne({ _id: report._id }, report, { upsert: true });
  console.error(`wrote ops_reports ${report._id}`);
  return exitCode;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (k) => args.find((a) => a.startsWith(`--${k}=`))?.split('=')[1];
  const APPLY = args.includes('--apply');
  const JSON_OUT = args.includes('--json');
  const COLLECTION_ONLY = args.includes('--collection-only');
  const NO_GEMINI = args.includes('--no-gemini');
  const NO_METER_GAP = args.includes('--no-meter-gap');
  const windowArg = arg('gemini-window-h');

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

    // 8. Gemini side — before the long DB reads, so a dead key is known early.
    const glog = (m) => console.error(m);
    // The hourly run's own last report: its findings are carried forward once they leave the window.
    const prevCollection = COLLECTION_ONLY && !NO_GEMINI
      ? await db.collection('ops_reports').findOne({ _id: 'paid-vs-got-collection' }, { projection: { 'gemini.findings': 1 } })
      : null;
    const gemini = NO_GEMINI ? null : await geminiSection(db, {
      now, log: glog, prevFindings: prevCollection?.gemini?.findings || [],
      windowH: windowArg ? Number(windowArg) : COLLECTION_ONLY ? HOURLY_WINDOW_H : null,
    });
    const geminiUnknown = gemini && (gemini.unknown?.length || !gemini.counts || !gemini.positive?.ok);
    const geminiForVerdict = gemini?.counts ? gemini : null;

    if (COLLECTION_ONLY) {
      exitCode = await collectionOnly(db, { now, collection, positive, gemini, geminiUnknown, geminiForVerdict, APPLY, JSON_OUT });
      process.exitCode = exitCode; // `finally` closes Mongo; main() then resolves and the process exits with this
      return;
    }

    // 2–3. got and paid
    const usage = await readUsage(db, dayStart, dayEnd);
    const paid = foldPaid(usage.realtime, usage.batch, usage.inFlight);
    const { got, written } = await readGot(db, dayStart, dayEnd, now);

    // 9–10. meter gap per project/key, and repeat asks (#4599)
    let meter = null;
    if (!NO_METER_GAP) {
      const meterHours = meterByHour(usage.realtime, dayStart);
      const g = await readGoogleCalls(dayStart, dayEnd).catch((e) => ({ unreadable: e.message }));
      meter = g.unreadable ? { unreadable_all: g.unreadable } : { ...meterGap({ projects: g.projects, meterHours }), control: meterGapControl(meterHours) };
    }
    const meterUnknown = meter && (meter.unreadable_all || meter.unreadable.length || !meter.control.ok);
    const repeats = repeatAsks(usage.realtime);

    // 4. waste
    const jobs = await db.collection('batch_jobs').find({
      created_at: { $gte: new Date(dayStart.getTime() - REPEAT_LOOKBACK_DAYS * DAY), $lt: dayEnd },
      status: { $ne: 'submit_failed' },
    }, { projection: JOB_PROJECTION }).toArray();
    const usageByJob = new Map(usage.batch.filter((r) => r.batch_job_id).map((r) => [String(r.batch_job_id), r]));
    const duplicates = duplicateSubmissions(jobs.filter((j) => ms(j.created_at) >= dayStart.getTime() - DUP_WINDOW_MS), { inDay, usageByJob });
    const repeat = pagesPaidTwice(jobs, { inDay, usageByJob });
    const bookLevel = await readBookLevel(db, usage.batch);
    const { nothing, superseded, eval: evalRows, book_level: bookRows } = paidForNothing(usage.batch, written, repeat.superseded, bookLevel);
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
      book_level: { jobs: bookRows.length, usd: r6(bookRows.reduce((a, n) => a + n.usd, 0)) },
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

    const v = verdict({ collection, dupUsd: waste.duplicate_usd, unattributedPct: paid.unattributed_pct, gemini: geminiForVerdict,
      meter: meter?.projects ? meter : null, repeats });
    const report = {
      _id: `paid-vs-got-${dayStr}`, type: REPORT_TYPE, day: dayStr, generated_at: now,
      generated_by: 'scripts/audit/paid-vs-got.mjs', verdict: v,
      headline: headline({ paid, got, waste }),
      collection: { ...collection, flagged: collection.flagged.slice(0, 100) },
      got, paid, waste, bill, usage_rows: usage.rows, gemini, meter_gap: meter, repeat_asks: repeats,
      controls: { positive, gemini: gemini?.positive || null },
    };
    const text = renderText(report);
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2)); else console.log(text);

    if (!positive.ok) {
      console.error('\nPOSITIVE CONTROL DID NOT FIRE — the collection check is broken. Exit 2 (could not measure).');
      exitCode = 2;
    } else if (v.status === 'FAIL') {
      exitCode = 1;
    } else if (geminiUnknown) {
      console.error(`\nGemini side UNKNOWN: ${(gemini.unknown || []).join('; ') || 'positive control did not fire'}. Exit 2 — not clear.`);
      exitCode = 2;
    } else if (meterUnknown) {
      console.error(`\nMeter gap UNKNOWN: ${meter.unreadable_all || meter.unreadable.map((u) => `${u.project}: ${u.error}`).join('; ') || 'positive control did not fire'}. Exit 2 — not clear.`);
      exitCode = 2;
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
