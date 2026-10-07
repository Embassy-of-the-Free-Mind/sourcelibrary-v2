// PRIOR ART: scripts/lib/finalize-decision.mjs (`decideFinalize`) decides ONE transition with its own
// denominator (pages_ocr / pages_count, done at 50%); scripts/audit/status-output-drift.mjs checks five
// statuses against output, sampled; scripts/lib/reenroll-eligibility.mjs is a hand re-entry for one
// graveyard. None derives the next step for every book from stored fields. Design and rule:
// .claude/docs/pipeline-next-step.md (#5469); this is step 1 of its migration (#5477).
//
// pipeline-next-step — what happens to a book next, or why it is blocked and when that is re-checked.
//
// OBSERVE ONLY (step 1). sync-worker stamps `books.pipeline_next` beside `translation_state`; no phase or
// lane selects on it until that lane's cutover (step 5), and each cutover is a decision to spend.
//
// The rule reads stored fields only — `translation_state` (the ladder, translation-state.md), the
// counters, the hold marker, the archiving watchdog's verdict, the distill/images skip records — so a
// full-corpus pass is one projection scan and no `pages` reads. The one input that is NOT on the book is
// whether `book.job` names a job that is still open: measured 2026-10-01, 4,816 of 4,852 `book.job`
// pointers name a CANCELLED job (the lock is set at dispatch and not always cleared), so the pointer alone
// would mark ~4.8K idle books in flight. The caller resolves it (`openJob`); stampNextStep does so itself.

import { isHeld } from './pipeline-hold.mjs';
import { TRANSLATION_RUNGS } from './page-counts.mjs';

/** Rule version for `books.pipeline_next`. Bump when the rule changes: sync-worker re-stamps every book. */
export const PIPELINE_NEXT_VERSION = 1;

export const STEPS = ['archive', 'ocr', 'translate', 'enrich', 'images', 'done', 'blocked'];

/** A book needs this share of its page images on R2 before OCR (decision 1 in the design doc). */
export const ARCHIVE_MIN = 0.9;

/** `ocr` becomes `blocked: ocr_stalled` after this many consecutive OCR issues that added no pages. */
export const OCR_STALL_ATTEMPTS = 2;

/** `jobs.status` values that mean a job is still running. */
export const OPEN_JOB_STATUSES = ['pending', 'processing'];

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/**
 * Every blocked reason has a re-check interval and an owner (design doc, "Blocked reasons"). The re-check
 * scheduler is step 3; until it exists, sync-worker's 2-hourly recompute is the re-evaluation, and
 * `recheck_at` records when an overdue one becomes the audit's `recheck_overdue` shape.
 */
export const BLOCKED_REASONS = {
  // The hold's own release condition is the exit; pipeline-hold-drift.mjs checks it daily.
  held: { recheck: DAY, owner: 'pipeline-hold' },
  // translation_state is stamped by sync-worker; the next pass stamps it. Never read as done (#5477).
  unstamped: { recheck: 2 * HOUR, owner: 'sync-worker' },
  // 24 h, backing off to 7 d once the re-check scheduler exists (step 3).
  source_unreachable: { recheck: DAY, owner: 'archiving-watchdog' },
  source_dead: { recheck: 30 * DAY, owner: '#5462' },
  source_restricted: { recheck: 90 * DAY, owner: '#5462' },
  // Re-checked when the lane registry changes (step 4); the interval is the fallback.
  ocr_policy: { recheck: 30 * DAY, owner: 'lane-registry' },
  // Re-checked when the OCR engine or prompt changes, else 90 d.
  ocr_stalled: { recheck: 90 * DAY, owner: 'ocr-lane' },
};

const RUNG_INDEX = Object.fromEntries(TRANSLATION_RUNGS.map((r, i) => [r, i]));

/** The job type on a `jobs` row (or `book.job.type`) → the step that dispatched it, or null if unknown. */
export function stepForJobType(type) {
  const t = String(type ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('image')) return 'images';
  if (t.includes('ocr')) return 'ocr';
  if (t.includes('translat')) return 'translate';
  if (t.includes('summar') || t.includes('chapter') || t.includes('enrich')) return 'enrich';
  if (t.includes('archiv')) return 'archive';
  return null;
}

/**
 * Projection for a full-corpus scan. `summary` and `chapters` are large, so the scan projects only
 * whether they are present (`_has_summary`, `_chapters_n`, same test as STATUS_OUTPUT_CLAIMS in the
 * orchestrator); nextStep reads either shape. Needs MongoDB ≥ 4.4 (expressions in a find projection).
 */
export const NEXT_STEP_PROJECTION = {
  _id: 1, id: 1, content_type: 1, pages_count: 1, pages_archived: 1, translation_state: 1, job: 1, pipeline_next: 1,
  'pipeline_auto.hold': 1, 'pipeline_auto.archive_verdict': 1, 'pipeline_auto.archive_stall': 1,
  'pipeline_auto.archive_confirm.verdict': 1, 'pipeline_auto.attempts': 1,
  'pipeline_auto.summary_skipped_reason': 1, 'pipeline_auto.chapters_skipped_reason': 1,
  'pipeline_auto.images_done_at': 1, 'pipeline_auto.images_skipped_reason': 1,
  _has_summary: { $and: [{ $ne: [{ $ifNull: ['$summary', ''] }, ''] }, { $ne: ['$summary', false] }] },
  _chapters_n: { $cond: [{ $isArray: '$chapters' }, { $size: '$chapters' }, 0] },
};

const hasSummary = (b) => ('_has_summary' in b ? !!b._has_summary : !!b.summary);
const hasChapters = (b) => ('_chapters_n' in b ? b._chapters_n > 0 : Array.isArray(b.chapters) && b.chapters.length > 0);

function blocked(reason, now, extra = {}) {
  const r = BLOCKED_REASONS[reason];
  return { step: 'blocked', reason, in_flight: false, recheck_at: new Date(now.getTime() + r.recheck), owner: extra.owner ?? r.owner };
}

const open = (step, reason) => ({ step, reason, in_flight: false, recheck_at: null, owner: null });

/** Archived share of the book's pages, by counter. Provisional until #5325 fixes `pages_archived`. */
export function archivedShare(book) {
  const count = book?.pages_count ?? 0;
  return count > 0 ? Math.min(1, (book.pages_archived ?? 0) / count) : 0;
}

/**
 * Rules 4–11: the step for a book that is not a non-text, not held, stamped, and not in flight.
 * Split out so an in-flight book whose job type is unknown can fall back to it.
 */
function derive(book, rung, { now, ocrPolicyBlocked }) {
  const pa = book.pipeline_auto ?? {};
  const english = !!book.translation_state?.english_original;

  // 4. Images still needed: below ARCHIVE_MIN and the text is not yet in hand. A book that already has
  //    its text does not need its images re-fetched, so a dead source no longer blocks it.
  if (archivedShare(book) < ARCHIVE_MIN && RUNG_INDEX[rung] < RUNG_INDEX.transcribed) {
    const verdict = pa.archive_verdict;
    if (verdict === 'dead') return blocked('source_dead', now);
    // 'escalated' is terminal only when the #4611 confirmation answered "gone" (archive_confirm). An
    // escalation from before that check is a timeout, and a timeout never confirms a death: 709 of 721
    // books parked "likely gone" were alive (#5462).
    if (verdict === 'escalated') return blocked(pa.archive_confirm?.verdict === 'gone' ? 'source_dead' : 'source_unreachable', now);
    if (verdict === 'restricted') return blocked('source_restricted', now);
    if (pa.archive_stall) return blocked('source_unreachable', now);
    return open('archive', 'images_missing');
  }

  // 5. No approved OCR lane for this language/script/source. The allowlist is the lane registry
  //    (step 4); until it exists the caller may pass `ocrPolicyBlocked`, and by default nothing is.
  if (RUNG_INDEX[rung] < RUNG_INDEX.transcribed && ocrPolicyBlocked?.(book)) return blocked('ocr_policy', now);

  // 6. OCR. Bounded: consecutive issues that added no pages end in ocr_stalled, not a loop.
  if (rung === 'no_text' || rung === 'transcribing') {
    if ((pa.attempts?.ocr?.n ?? 0) >= OCR_STALL_ATTEMPTS) return blocked('ocr_stalled', now);
    return open('ocr', rung);
  }

  // 7–8. Translation. An English original is readable at `transcribed`; its rungs above that are
  //      modernization progress, not readability, so it never takes this step.
  if (!english && (rung === 'transcribed' || rung === 'translating')) return open('translate', 'body');
  // The tail counts: in #4685 ~60% of the pages missing from 90–99% books were real text. Ranked after body.
  if (!english && rung === 'readable') return open('translate', 'tail');

  // 9. Distill output: output OR a recorded skip satisfies it (pipeline-status-truth.md).
  const needSummary = !hasSummary(book) && !pa.summary_skipped_reason;
  const needChapters = !hasChapters(book) && !pa.chapters_skipped_reason;
  if (needSummary || needChapters) return open('enrich', needSummary && needChapters ? 'summary_chapters' : needSummary ? 'summary' : 'chapters');

  // 10. Image extraction: the collectors stamp images_done_at, or images_skipped_reason (no candidates).
  if (!pa.images_done_at && !pa.images_skipped_reason) return open('images', 'not_extracted');

  // 11. Finalize is bookkeeping inside `done`, recomputed every pass, so it cannot run ahead of the OCR.
  return open('done', 'finished');
}

/**
 * The next step for one book. First match wins (design doc, "Rule, first match wins").
 *
 * @param {object} book  a `books` document, or a NEXT_STEP_PROJECTION row
 * @param {object} [opts]
 * @param {Date}   [opts.now]
 * @param {null|{ type?: string }} [opts.openJob]  the OPEN job `book.job` names, or null when none is open.
 *        Omitted → the book is treated as not in flight: a bare `book.job` pointer is not evidence (header).
 * @param {(book: object) => boolean} [opts.ocrPolicyBlocked]  lane-registry policy (step 4); default none
 * @returns {{ step: string, reason: string, in_flight: boolean, recheck_at: Date|null, owner: string|null }}
 */
export function nextStep(book, { now = new Date(), openJob = null, ocrPolicyBlocked } = {}) {
  const rung = book?.translation_state?.rung;

  // 1. Not a text.
  if (rung === 'no_pages' || book?.content_type === 'artwork') return open('done', 'not_a_text');

  // 2. Held: the hold's issue and release condition are the exit.
  if (isHeld(book)) {
    const issue = book.pipeline_auto.hold.issue;
    return blocked('held', now, issue ? { owner: `#${issue}` } : {});
  }

  // Unstamped is not done and not failed: the ladder has not been computed for this book yet.
  if (!rung || !(rung in RUNG_INDEX)) return blocked('unstamped', now);

  // 3. In flight: keep the step that dispatched it. No lane may select an in-flight book.
  if (openJob) {
    const base = derive(book, rung, { now, ocrPolicyBlocked });
    const jobStep = stepForJobType(openJob.type ?? book.job?.type);
    if (jobStep && jobStep !== base.step) return { step: jobStep, reason: 'job_open', in_flight: true, recheck_at: null, owner: null };
    return { ...base, in_flight: true, recheck_at: null };
  }

  return derive(book, rung, { now, ocrPolicyBlocked });
}

/** The inputs a stamp was computed from, stored so a wrong step can be traced to the value behind it. */
export function nextStepInputs(book, openJob = null) {
  const pa = book?.pipeline_auto ?? {};
  return {
    rung: book?.translation_state?.rung ?? null,
    archived: Math.round(archivedShare(book) * 1000) / 1000,
    verdict: pa.archive_verdict ?? null,
    hold: pa.hold?.reason ?? null,
    job: openJob ? (book?.job?.job_id ?? book?.job?.name ?? 'open') : null,
  };
}

/**
 * The stored shape (`books.pipeline_next`). `recheck_at` is kept from the previous stamp while the book
 * stays on the same blocked reason, so a re-stamp does not push its re-check forever into the future.
 */
export function buildPipelineNext(book, opts = {}) {
  const now = opts.now ?? new Date();
  const next = nextStep(book, { ...opts, now });
  const prev = book?.pipeline_next;
  const recheck_at = next.step === 'blocked' && prev?.step === 'blocked' && prev.reason === next.reason && prev.recheck_at
    ? prev.recheck_at
    : next.recheck_at;
  return { ...next, recheck_at, inputs: nextStepInputs(book, opts.openJob), version: PIPELINE_NEXT_VERSION, computed_at: now };
}

/** Does the stored stamp differ from a fresh one? `computed_at` and `recheck_at` are not compared. */
export function pipelineNextChanged(stored, fresh) {
  if (!stored) return true;
  for (const k of ['step', 'reason', 'in_flight', 'owner', 'version']) if (stored[k] !== fresh[k]) return true;
  const a = stored.inputs ?? {};
  return Object.keys(fresh.inputs).some((k) => a[k] !== fresh.inputs[k]);
}

/**
 * Book ids whose `book.job` names a job that is still open, with that job's type. One `jobs` query for a
 * whole batch of books, so sync-worker can resolve in-flight for the corpus without a per-book read.
 *
 * @returns {Promise<Map<string, { type: string|null }>>}  book id (`books.id`) → open job
 */
export async function resolveOpenJobs(db, books) {
  const byJob = new Map();
  for (const b of books) {
    const jobId = b?.job?.job_id;
    if (jobId) byJob.set(jobId, b.id ?? String(b._id));
  }
  const out = new Map();
  if (byJob.size === 0) return out;
  const rows = await db.collection('jobs')
    .find({ id: { $in: [...byJob.keys()] }, status: { $in: OPEN_JOB_STATUSES } }, { projection: { id: 1, type: 1 } })
    .toArray();
  for (const j of rows) out.set(byJob.get(j.id), { type: j.type ?? null });
  return out;
}

/**
 * Stamp `books.pipeline_next` on one book — the writer collectors and dispatchers call at job open/close
 * (step 1b). Same rule and shape as sync-worker's pass. Writes only when the stamp changed.
 *
 * The book is re-read with NEXT_STEP_PROJECTION, so a caller holding a partial document (a collector's
 * `{ id }`) cannot stamp from missing inputs. NOTE: `translation_state` is sync-worker's to write, so a
 * stamp here reads a rung up to 2 h old; that is the field's freshness bound, not a new one.
 *
 * @param {{ _id?: unknown, id?: string }} bookRef
 * @returns {Promise<{ changed: boolean, pipeline_next: object|null }>}  null when the book is not found
 */
export async function stampNextStep(db, bookRef, { now = new Date(), dryRun = false, ocrPolicyBlocked } = {}) {
  const filter = bookRef?._id != null ? { _id: bookRef._id } : { id: bookRef?.id };
  const book = await db.collection('books').findOne(filter, { projection: NEXT_STEP_PROJECTION });
  if (!book) return { changed: false, pipeline_next: null };
  const bookId = book.id ?? String(book._id);
  const openJob = (await resolveOpenJobs(db, [book])).get(bookId) ?? null;
  const fresh = buildPipelineNext(book, { now, openJob, ocrPolicyBlocked });
  const changed = pipelineNextChanged(book.pipeline_next, fresh);
  if (changed && !dryRun) {
    await db.collection('books').updateOne({ _id: book._id }, { $set: { pipeline_next: fresh } });
  }
  return { changed, pipeline_next: fresh };
}
