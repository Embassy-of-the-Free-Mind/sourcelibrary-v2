#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/status-output-drift.mjs — checks five statuses against their OUTPUT, sampled;
 * it never derives the next step and has no flow snapshot (it becomes this audit's `selected_but_done`
 * shape at cutover step 6). scripts/audit/pipeline-hold-drift.mjs — reconciles the hold marker against
 * the status, one cohort. scripts/audit/paid-vs-got.mjs — the shape followed here for the daily
 * ops_reports row, the issue dedupe and the controls; it audits spend, not steps. sync-worker logs a
 * per-run step tally to a log file; nothing persists it, and its denominator is every book (121K), not
 * `pages_count > 0`. scripts/analytics/snapshot-library-dashboard.mjs — writes books/pages per step into
 * system_config.library_dashboard for /admin, but from its own copy of the 2026-10-01 DRAFT rule (no open-job
 * resolution, a regex on `pipeline_auto.error`), not the stored field; it should read this row or the field
 * (its header says so), a follow-up, not this PR. None compares the stored `pipeline_next` with a recompute.
 *
 * pipeline-next-step-audit — the daily full-corpus audit of `books.pipeline_next` (#5478, step 2 of #5469;
 * design: .claude/docs/pipeline-next-step.md, "The audit").
 *
 *   1. RECOMPUTE  one projection scan of every book with `pages_count > 0`; nextStep() over the STORED
 *                 inputs (translation_state, counters, hold, verdict, skips, open job) and compare with the
 *                 stored `pipeline_next` and with `pipeline_auto.status`. Named shapes:
 *                   terminal_but_actionable  status complete/needs_attention/failed/parked/paused/
 *                                            loop_quarantine_hold, step actionable
 *                   selected_but_done        status is a phase's selector input, step = done
 *                   in_flight_without_job    stored in_flight, but `book.job` names no open job
 *                   blocked_without_recheck  stored blocked, no recheck_at
 *                   recheck_overdue          stored blocked, recheck_at in the past (no re-check
 *                                            scheduler until step 3, so this grows; informational)
 *                   translate_selector_empty step translate, but by counters every OCR'd non-blank page is
 *                                            already translated (ocr − blank − translated ≤ 0): the lane's
 *                                            page selector finds nothing (#5325/#5326). Counter proxy.
 *                   step_with_no_lane        not measured until the lane registry (scripts/lib/lanes.mjs,
 *                                            #5480) exists; reported as null, never as 0
 *   2. SNAPSHOT   counts and pages remaining per step and step:reason, live and all, per language, the held
 *                 cohorts, and the status × step table, to ops_reports (`type: 'pipeline_next_daily'`,
 *                 `_id: pipeline-next-<day>`). FIXED denominator: every book with `pages_count > 0`, and the
 *                 row says so. /admin/pipeline reads it; nothing recomputes it on a request.
 *   3. POSITIVE CONTROL every run: one agreeing book's stored step is changed IN MEMORY and the comparator
 *                 must flag it. If it does not, the run is `probe_broken` (exit 2), never PASS.
 *   4. NEGATIVE CONTROL once, recorded in the PR: a wrong step stamped on a hidden test book, `--book <id>`
 *                 goes red, the stamp is restored.
 *
 * FRESHNESS. sync-worker re-stamps every 2 h (and only writes a stamp that changed), so a book whose inputs
 * moved since the last pass legitimately disagrees. A disagreement is FRESH when the book shows a write
 * (updated_at, pipeline_auto.updated_at / last_updated, hold.held_at) after the last stamp pass began (the
 * newest `pipeline_next.computed_at` in the corpus, less SYNC_READ_SLACK); otherwise it is STALE. Only stale
 * disagreements count toward the 1% FAIL.
 *
 * FAIL (exit 1): stale disagreements > 1% of the denominator; any live book in step_with_no_lane (once
 * measured); any stored blocked book without recheck_at; `needs_human` > 100 live books.
 * Exit 2 = could not measure (Mongo unreachable, positive control did not fire, a throw). 0 = ran, clean.
 * Never branch on != 0 (measurement-instruments.md).
 *
 * WRITES. With --apply only: one ops_reports document, and on FAIL one GitHub issue deduped by title (a
 * later FAIL comments on it, a later PASS closes it). READ-ONLY on books and pages, always.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/pipeline-next-step-audit.mjs            # dry run
 *   node --env-file=.env.production.local scripts/audit/pipeline-next-step-audit.mjs --apply    # cron
 *   node --env-file=.env.production.local scripts/audit/pipeline-next-step-audit.mjs --book <id> # one book, no writes
 *   ... --json   the report on stdout
 */
import { execFileSync } from 'node:child_process';
import { MongoClient, ObjectId } from 'mongodb';
import { NEXT_STEP_PROJECTION, nextStep, resolveOpenJobs } from '../lib/pipeline-next-step.mjs';

export const REPORT_TYPE = 'pipeline_next_daily';
export const DENOMINATOR = { pages_count: { $gt: 0 } };
export const DENOMINATOR_RULE = 'books with pages_count > 0';
export const DISAGREE_FAIL_PCT = 1;
export const NEEDS_HUMAN_MAX_LIVE = 100;
const SYNC_READ_SLACK_MS = 45 * 60e3;
const ISSUE_TITLE = 'pipeline-next-step audit: FAIL';
const TOP_LANGUAGES = 20;

export const ACTIONABLE = new Set(['archive', 'ocr', 'translate', 'enrich', 'images']);
/** Statuses no phase selects: a book here with an actionable step is invisible to the line. */
export const TERMINAL_STATUSES = new Set(['complete', 'needs_attention', 'failed', 'parked', 'paused', 'loop_quarantine_hold']);
/** Status → the step of the phase that selects it (pipeline-orchestrator.mjs selectors, 2026-10-02). */
export const SELECTED_STATUS_STEP = {
  queued: 'archive', archiving: 'archive', archive_complete: 'ocr', ocr_complete: 'translate',
  translate_partial: 'translate', translate_complete: 'enrich', summary_indexed: 'enrich', chapters_complete: 'images',
};

const AUDIT_PROJECTION = {
  ...NEXT_STEP_PROJECTION,
  visible: 1, language: 1, pages_blank: 1, updated_at: 1,
  'pipeline_auto.status': 1, 'pipeline_auto.updated_at': 1, 'pipeline_auto.last_updated': 1,
};

const ms = (d) => (d ? new Date(d).getTime() : NaN);
const pct = (n, d) => (d ? Math.round((n / d) * 10000) / 100 : 0);

/** Does the stored stamp say something different from the recompute? Only the decision is compared. */
export function stampDisagrees(stored, fresh) {
  if (!stored) return true;
  return stored.step !== fresh.step || stored.reason !== fresh.reason || !!stored.in_flight !== !!fresh.in_flight;
}

/** Work left on a book, by stored counters. Each is the lane's unit (pages), never negative. */
export function remaining(book) {
  const ts = book.translation_state ?? {};
  const count = book.pages_count ?? 0;
  const whole = ts.whole ?? Math.max(0, count - (book.pages_blank ?? 0));
  const ocr = ts.ocr ?? 0;
  const english = !!ts.english_original;
  return {
    pages: count,
    archive_pages: Math.max(0, count - (book.pages_archived ?? 0)),
    ocr_pages: Math.max(0, whole - ocr),
    // What a reader would still need translated: the ladder's denominator, so a book at `ocr` counts the
    // pages its OCR will produce too. English originals need none.
    translate_pages: english ? 0 : Math.max(0, (ts.translatable ?? whole) - (ts.translated ?? 0)),
  };
}

const zero = () => ({ books: 0, pages: 0, archive_pages: 0, ocr_pages: 0, translate_pages: 0 });
function add(acc, r) { acc.books++; for (const k of ['pages', 'archive_pages', 'ocr_pages', 'translate_pages']) acc[k] += r[k]; }
function bump(map, key, live, r) {
  const e = map.get(key) ?? { all: zero(), live: zero() };
  add(e.all, r); if (live) add(e.live, r);
  map.set(key, e);
}

/**
 * Classify one book. Pure: the caller supplies the open-job lookup and the clock.
 * @returns {{ fresh: object, shapes: string[], disagree: boolean, unstored: boolean }}
 */
export function classify(book, { now, openJob, freshSince }) {
  const fresh = nextStep(book, { now, openJob });
  const stored = book.pipeline_next ?? null;
  const status = book.pipeline_auto?.status ?? null;
  const shapes = [];
  if (TERMINAL_STATUSES.has(status) && ACTIONABLE.has(fresh.step)) shapes.push('terminal_but_actionable');
  if (status && Object.hasOwn(SELECTED_STATUS_STEP, status) && fresh.step === 'done') shapes.push('selected_but_done');
  if (stored?.in_flight && !openJob) shapes.push('in_flight_without_job');
  if (stored?.step === 'blocked' && !stored.recheck_at) shapes.push('blocked_without_recheck');
  if (stored?.step === 'blocked' && stored.recheck_at && ms(stored.recheck_at) < now.getTime()) shapes.push('recheck_overdue');
  if (fresh.step === 'translate') {
    const ts = book.translation_state ?? {};
    if ((ts.ocr ?? 0) - (book.pages_blank ?? 0) - (ts.translated ?? 0) <= 0) shapes.push('translate_selector_empty');
  }
  const disagree = stampDisagrees(stored, fresh);
  const pa = book.pipeline_auto ?? {};
  const lastWrite = Math.max(...[book.updated_at, pa.updated_at, pa.last_updated, pa.hold?.held_at].map(ms).filter(Number.isFinite), -Infinity);
  return { fresh, stored, status, shapes, disagree, unstored: !stored, recent: freshSince != null && lastWrite >= freshSince };
}

/** Positive control: an agreeing book with its stored step moved must be flagged by the comparator. */
export function positiveControl(sample, opts) {
  if (!sample) return { ok: false, detail: 'no agreeing book to perturb' };
  const wrong = sample.pipeline_next.step === 'done' ? 'ocr' : 'done';
  const perturbed = { ...sample, pipeline_next: { ...sample.pipeline_next, step: wrong } };
  const c = classify(perturbed, opts);
  return { ok: c.disagree === true, book_id: sample.id ?? String(sample._id), stored_step: sample.pipeline_next.step, perturbed_to: wrong };
}

export function verdict({ denominator, staleDisagree, noLaneLive, blockedNoRecheck, needsHumanLive, positiveOk }) {
  const fails = [];
  if (pct(staleDisagree, denominator) > DISAGREE_FAIL_PCT) fails.push(`stored step disagrees with the recompute for ${staleDisagree} books (${pct(staleDisagree, denominator)}% > ${DISAGREE_FAIL_PCT}%) outside the freshness bound`);
  if (noLaneLive != null && noLaneLive > 0) fails.push(`${noLaneLive} live books at a step no registered lane serves`);
  if (blockedNoRecheck > 0) fails.push(`${blockedNoRecheck} blocked books have no recheck_at`);
  if (needsHumanLive > NEEDS_HUMAN_MAX_LIVE) fails.push(`needs_human holds ${needsHumanLive} live books (> ${NEEDS_HUMAN_MAX_LIVE})`);
  const status = !positiveOk ? 'probe_broken' : fails.length ? 'FAIL' : 'PASS';
  return { status, fails };
}

/** Fold the scan into the report. Pure over the rows, so it is unit-testable without Mongo. */
export function buildReport(rows, { now, openJobs, scope = 'corpus' }) {
  let lastStampRun = null;
  for (const b of rows) {
    const t = ms(b.pipeline_next?.computed_at);
    if (Number.isFinite(t) && (lastStampRun == null || t > lastStampRun)) lastStampRun = t;
  }
  const freshSince = lastStampRun == null ? null : lastStampRun - SYNC_READ_SLACK_MS;
  const opts = { now, freshSince };

  const byStep = new Map(), byStepReason = new Map(), held = new Map(), statusStep = new Map();
  const byStepLang = new Map();
  const shapeCounts = {};
  const shapeSamples = {};
  const agreement = { compared: 0, disagree: 0, fresh: 0, stale: 0, unstored: 0, transitions: {}, samples: [] };
  let live = 0, needsHumanLive = 0, blockedNoRecheck = 0, sample = null;

  for (const b of rows) {
    const id = b.id ?? String(b._id);
    const isLive = b.visible === true;
    if (isLive) live++;
    const openJob = openJobs.get(id) ?? null;
    const c = classify(b, { ...opts, openJob });
    const r = remaining(b);
    const step = c.fresh.step;
    bump(byStep, step, isLive, r);
    bump(byStepReason, `${step}:${c.fresh.reason}`, isLive, r);
    bump(statusStep, `${c.status ?? '(none)'}→${step}`, isLive, r);
    if (isLive) {
      const lang = String(b.language ?? '(none)').trim() || '(none)';
      if (!byStepLang.has(step)) byStepLang.set(step, new Map());
      bump(byStepLang.get(step), lang, true, r);
    }
    if (step === 'blocked' && c.fresh.reason === 'held') {
      const h = b.pipeline_auto?.hold ?? {};
      bump(held, `${h.reason ?? '(no reason)'}|${h.issue ?? ''}`, isLive, r);
    }
    if (step === 'blocked' && c.fresh.reason === 'needs_human' && isLive) needsHumanLive++;
    for (const s of c.shapes) {
      shapeCounts[s] ??= { all: 0, live: 0 };
      shapeCounts[s].all++; if (isLive) shapeCounts[s].live++;
      shapeSamples[s] ??= [];
      if (shapeSamples[s].length < 5) shapeSamples[s].push(id);
      if (s === 'blocked_without_recheck') blockedNoRecheck++;
    }
    agreement.compared++;
    if (c.unstored) agreement.unstored++;
    if (c.disagree) {
      agreement.disagree++;
      if (c.recent) agreement.fresh++; else agreement.stale++;
      const key = `${c.stored ? `${c.stored.step}:${c.stored.reason}` : '(unstamped)'} → ${step}:${c.fresh.reason}`;
      agreement.transitions[key] = (agreement.transitions[key] ?? 0) + 1;
      if (!c.recent && agreement.samples.length < 20) agreement.samples.push({ id, stored: c.stored ? `${c.stored.step}:${c.stored.reason}` : null, recomputed: `${step}:${c.fresh.reason}` });
    } else if (!sample && c.stored) sample = b;
  }

  const positive = positiveControl(sample, { ...opts, openJob: sample ? (openJobs.get(sample.id ?? String(sample._id)) ?? null) : null });
  const denominator = rows.length;
  const v = verdict({ denominator, staleDisagree: agreement.stale, noLaneLive: null, blockedNoRecheck, needsHumanLive, positiveOk: positive.ok });

  const table = (m) => [...m.entries()].map(([key, e]) => ({ key, ...e })).sort((a, b) => b.all.books - a.all.books);
  const shapes = {};
  for (const s of ['terminal_but_actionable', 'selected_but_done', 'in_flight_without_job', 'blocked_without_recheck', 'recheck_overdue', 'translate_selector_empty']) {
    shapes[s] = { ...(shapeCounts[s] ?? { all: 0, live: 0 }), sample_ids: shapeSamples[s] ?? [] };
  }
  shapes.step_with_no_lane = { all: null, live: null, note: 'not measured: the lane registry (scripts/lib/lanes.mjs) lands in #5480' };
  shapes.needs_human = { live: needsHumanLive, max_live: NEEDS_HUMAN_MAX_LIVE };

  agreement.stale_pct = pct(agreement.stale, denominator);
  agreement.last_stamp_run = lastStampRun == null ? null : new Date(lastStampRun);
  agreement.transitions = Object.entries(agreement.transitions).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ transition: k, books: n }));

  return {
    scope,
    generated_at: now,
    denominator: { rule: DENOMINATOR_RULE, books: denominator, live, live_rule: 'visible: true' },
    verdict: v,
    steps: table(byStep).map(({ key, ...e }) => ({ step: key, ...e })),
    step_reasons: table(byStepReason).map(({ key, ...e }) => { const [step, reason] = key.split(':'); return { step, reason, ...e }; }),
    step_languages_live: Object.fromEntries([...byStepLang.entries()].map(([step, m]) => [step,
      [...m.entries()].map(([language, e]) => ({ language, ...e.live })).sort((a, b) => b.books - a.books).slice(0, TOP_LANGUAGES)])),
    held: table(held).map(({ key, ...e }) => { const [reason, issue] = key.split('|'); return { reason, issue: issue ? Number(issue) : null, ...e }; }),
    status_x_step: table(statusStep).map(({ key, ...e }) => { const [status, step] = key.split('→'); return { status, step, all: e.all.books, live: e.live.books }; }),
    shapes,
    agreement,
    controls: { positive },
  };
}

function renderText(rep) {
  const L = [];
  const d = rep.denominator;
  L.push(`pipeline-next-step audit — ${rep.generated_at.toISOString()} — ${rep.verdict.status}`);
  L.push(`denominator: ${d.books.toLocaleString()} ${d.rule} (${d.live.toLocaleString()} live, ${d.live_rule})`);
  L.push('');
  L.push('step         all books   live books   live: pages to OCR   live: pages to translate');
  for (const s of rep.steps) L.push(`${s.step.padEnd(12)} ${String(s.all.books).padStart(9)}   ${String(s.live.books).padStart(10)}   ${String(s.live.ocr_pages).padStart(18)}   ${String(s.live.translate_pages).padStart(24)}`);
  L.push('');
  L.push('shape                       all      live');
  for (const [k, v] of Object.entries(rep.shapes)) {
    if (k === 'needs_human') L.push(`${k.padEnd(25)} ${'—'.padStart(6)}  ${String(v.live).padStart(8)}  (max ${v.max_live})`);
    else L.push(`${k.padEnd(25)} ${String(v.all ?? 'n/m').padStart(6)}  ${String(v.live ?? 'n/m').padStart(8)}${v.note ? `  (${v.note})` : ''}`);
  }
  const a = rep.agreement;
  L.push('');
  L.push(`stored vs recompute: ${a.disagree} disagree of ${a.compared} (${a.fresh} fresh, ${a.stale} stale = ${a.stale_pct}%; ${a.unstored} never stamped); last stamp pass ${a.last_stamp_run ? new Date(a.last_stamp_run).toISOString() : 'none'}`);
  for (const t of a.transitions.slice(0, 10)) L.push(`  ${String(t.books).padStart(7)}  ${t.transition}`);
  L.push('');
  L.push('status → step (top 25, all books):');
  for (const r of rep.status_x_step.slice(0, 25)) L.push(`  ${String(r.all).padStart(7)} (${String(r.live).padStart(6)} live)  ${r.status} → ${r.step}`);
  L.push('');
  const p = rep.controls.positive;
  L.push(`positive control: ${p.ok ? 'fired' : 'DID NOT FIRE'}${p.book_id ? ` (book ${p.book_id}: ${p.stored_step} → ${p.perturbed_to})` : ` (${p.detail})`}`);
  for (const f of rep.verdict.fails) L.push(`FAIL: ${f}`);
  return L.join('\n');
}

// ─────────────────────────────────────────── GitHub issue (dedupe by title)

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 }).trim();
}
function openAuditIssue() {
  const list = JSON.parse(gh(['issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title', '--limit', '20']) || '[]');
  return list.find((i) => i.title.startsWith(ISSUE_TITLE)) || null;
}
function fileOrUpdateIssue(report, text) {
  const body = `${report.verdict.fails.map((f) => `- **${f}**`).join('\n')}\n\n\`\`\`\n${text}\n\`\`\`\n\n`
    + `Snapshot: ops_reports \`${report._id}\`, rendered at /admin/pipeline. Filed by \`scripts/audit/pipeline-next-step-audit.mjs --apply\` `
    + '(#5478; design .claude/docs/pipeline-next-step.md). It comments here while the FAIL stands and closes this when a run passes.';
  const open = openAuditIssue();
  if (open) { gh(['issue', 'comment', String(open.number), '--body', body]); return `commented on #${open.number}`; }
  return `filed ${gh(['issue', 'create', '--title', `${ISSUE_TITLE} — ${report.day}`, '--body', body])}`;
}
function closeIssueIfOpen(report) {
  const open = openAuditIssue();
  if (!open) return 'no open audit issue';
  gh(['issue', 'close', String(open.number), '--comment', `pipeline-next-step audit passed on ${report.day}. Closing.`]);
  return `closed #${open.number}`;
}

async function main() {
  const argv = process.argv.slice(2);
  const APPLY = argv.includes('--apply');
  const JSON_OUT = argv.includes('--json');
  const bookArg = argv.includes('--book') ? argv[argv.indexOf('--book') + 1] : null;
  if (APPLY && bookArg) { console.error('--book is a scoped check and never writes; drop --apply.'); process.exit(2); }
  if (!process.env.MONGODB_URI) { console.error('UNKNOWN: MONGODB_URI not set — use --env-file=.env.production.local'); process.exit(2); }

  const client = new MongoClient(process.env.MONGODB_URI);
  let exitCode = 0;
  try {
    await client.connect();
    const db = client.db('bookstore');
    const now = new Date();
    const filter = bookArg ? { ...DENOMINATOR, $or: [{ id: bookArg }, ...(/^[0-9a-f]{24}$/.test(bookArg) ? [{ _id: new ObjectId(bookArg) }] : [])] } : DENOMINATOR;
    const t0 = Date.now();
    const rows = await db.collection('books').find(filter, { projection: AUDIT_PROJECTION }).toArray();
    if (rows.length === 0) throw new Error(bookArg ? `book ${bookArg} not found with pages_count > 0` : 'scan returned 0 books');
    const openJobs = await resolveOpenJobs(db, rows);
    const day = now.toISOString().slice(0, 10);
    const rep = buildReport(rows, { now, openJobs, scope: bookArg ? `book:${bookArg}` : 'corpus' });
    // In a one-book scope the corpus-wide freshness anchor is that book's own stamp, so a stamp written
    // minutes ago reads as "fresh"; the scoped check (the negative control) judges every disagreement.
    if (bookArg) {
      rep.agreement.stale = rep.agreement.disagree; rep.agreement.fresh = 0;
      rep.agreement.stale_pct = pct(rep.agreement.stale, rows.length);
      rep.verdict = verdict({ denominator: rows.length, staleDisagree: rep.agreement.stale, noLaneLive: null,
        blockedNoRecheck: rep.shapes.blocked_without_recheck.all, needsHumanLive: rep.shapes.needs_human.live, positiveOk: true });
    }
    const report = { _id: `pipeline-next-${day}`, type: REPORT_TYPE, day, generated_by: 'scripts/audit/pipeline-next-step-audit.mjs', scan_ms: Date.now() - t0, ...rep };
    const text = renderText(report);
    if (JSON_OUT) console.log(JSON.stringify(report, null, 2)); else console.log(text);

    if (report.verdict.status === 'probe_broken') {
      console.error('\nPOSITIVE CONTROL DID NOT FIRE — the comparator is broken. Exit 2 (could not measure).');
      exitCode = 2;
    } else if (report.verdict.status === 'FAIL') exitCode = 1;

    if (!APPLY) {
      console.error(`\n(dry run — nothing written.${bookArg ? '' : ` --apply would upsert ops_reports ${report._id}${exitCode === 1 ? ' and file/update the audit issue' : ''}.`})`);
    } else {
      // THE write: one ops_reports document, read by /admin/pipeline. Never books, never pages.
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
  main().catch((e) => { console.error(`pipeline-next-step audit could not run: ${e.message}`); process.exit(2); });
}
