/**
 * Submit-time guards against paying twice for the same OCR page (#5498).
 *
 * PRIOR ART: scripts/batch/bulk-reocr-local.mjs targets() — a page-level filter against LIVE jobs
 * for one hand-run script only, with no recently-saved window and no cross-process claim;
 * scripts/lib/ocr-loop-guard.mjs — stops a page re-OCR'd too often AFTER the fact, not a
 * concurrent double submit; scripts/lib/pipeline-hold.mjs — a human hold, not a lease.
 *
 * WHAT HAPPENED. 2026-10-01T01:50:13Z and 01:50:48Z: the same 250 pages, two batch jobs, both
 * `saved`, both paid. Phase 1.5 (preview OCR) runs in TWO processes under DIFFERENT flock locks —
 * the main orchestrator loop (`/tmp/sl-pipeline.lock`, every phase) and the dedicated
 * `pipeline-preview-ocr` worker (`--phase 1.5`, `/tmp/sl-preview-ocr.lock`). Both read the same
 * candidate list, and the pooler's only guard was "does this book have a pending batch_jobs row?"
 * — a row that does not exist until the other process has downloaded ~250 images, uploaded a
 * ~108 MB JSONL and created the batch, which is 30+ seconds. Check-then-act across that window is
 * not a guard.
 *
 * TWO GUARDS, because they close different holes:
 *
 * 1. `claimBookForOcrSubmit` — an atomic per-book lease (`pipeline_auto.ocr_submit_claim`),
 *    taken with ONE conditional updateOne before any page is selected, released after the
 *    batch_jobs row is written. A single-document conditional update is atomic in Mongo, so two
 *    submitters cannot both hold it. This is what stops the race. Leases expire (a crashed
 *    process must not strand a book), and only the holder can release one.
 *
 * 2. `loadOcrPagesInFlight` + `partitionGuardedPages` — refuse a page already in a non-terminal
 *    OCR job, or in one `saved` within the last few hours, unless `force`. This stops the
 *    sequential repeat: a page whose saved job wrote nothing (blank-page refusal, generation
 *    drop) still matches "no ocr.data" on the next run and would be bought again every cycle.
 *
 * Every skip carries a reason and the blocking job id. A guard that drops pages silently reads,
 * downstream, as "the candidate list was smaller" — which is how the 161–530x page loops of
 * September went unexplained.
 */

/** Non-terminal batch_jobs statuses: a page in one of these is already bought. */
export const ACTIVE_OCR_JOB_STATUSES = ['pending', 'processing', 'JOB_STATE_PENDING', 'JOB_STATE_RUNNING'];

/** A non-terminal job older than this is a zombie for the reaper, not a reason to block forever. */
export const OCR_GUARD_ACTIVE_HOURS = 48;

/** A page whose job saved this recently is not re-bought without `force`. */
export const OCR_GUARD_SAVED_HOURS = Number(process.env.OCR_GUARD_SAVED_HOURS) || 6;

/** Lease length. A pool build (download + 100 MB upload + create) takes minutes, not half an hour. */
export const OCR_SUBMIT_CLAIM_TTL_MS = 30 * 60 * 1000;

export const OCR_SUBMIT_CLAIM_FIELD = 'pipeline_auto.ocr_submit_claim';

/**
 * Take the per-book submit lease. Returns `{ ok: true }` or `{ ok: false, reason }`.
 * Re-entrant for the same owner; steals only an EXPIRED lease.
 */
export async function claimBookForOcrSubmit(db, bookId, { owner, now = new Date(), ttlMs = OCR_SUBMIT_CLAIM_TTL_MS } = {}) {
  if (!owner) throw new Error('claimBookForOcrSubmit: owner is required');
  const F = OCR_SUBMIT_CLAIM_FIELD;
  const res = await db.collection('books').updateOne(
    {
      id: bookId,
      $or: [
        { [F]: { $exists: false } },
        { [F]: null },
        { [`${F}.at`]: { $lt: new Date(now.getTime() - ttlMs) } },
        { [`${F}.owner`]: owner },
      ],
    },
    { $set: { [F]: { owner, at: now } } },
  );
  if (res.matchedCount === 1) return { ok: true };
  const held = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, [F]: 1 } });
  const claim = held?.pipeline_auto?.ocr_submit_claim;
  return {
    ok: false,
    reason: claim
      ? `submit lease held by ${claim.owner} since ${new Date(claim.at).toISOString()}`
      : 'book not found',
  };
}

/** Release every lease this owner holds on these books. Never touches another owner's lease. */
export async function releaseOcrSubmitClaims(db, bookIds, { owner }) {
  if (!bookIds?.length) return 0;
  const F = OCR_SUBMIT_CLAIM_FIELD;
  const res = await db.collection('books').updateMany(
    { id: { $in: bookIds }, [`${F}.owner`]: owner },
    { $unset: { [F]: '' } },
  );
  return res.modifiedCount;
}

/**
 * pageId -> { job_id, status, created_at } for every page of these books that sits in a
 * non-terminal OCR job, or in one saved within `savedHours`. One query per call: both clauses
 * are bounded by the `{status, created_at}` index.
 */
export async function loadOcrPagesInFlight(db, bookIds, {
  now = new Date(),
  activeHours = OCR_GUARD_ACTIVE_HOURS,
  savedHours = OCR_GUARD_SAVED_HOURS,
} = {}) {
  const inFlight = new Map();
  if (!bookIds?.length) return inFlight;
  const activeCutoff = new Date(now.getTime() - activeHours * 3600e3);
  const savedCutoff = new Date(now.getTime() - savedHours * 3600e3);
  const jobs = await db.collection('batch_jobs').find(
    {
      type: 'ocr',
      $and: [
        { $or: [
          { status: { $in: ACTIVE_OCR_JOB_STATUSES }, created_at: { $gte: activeCutoff } },
          { status: 'saved', created_at: { $gte: savedCutoff } },
        ] },
        { $or: [{ book_id: { $in: bookIds } }, { book_ids: { $in: bookIds } }] },
      ],
    },
    { projection: { _id: 0, id: 1, status: 1, created_at: 1, page_ids: 1 } },
  ).toArray();
  for (const j of jobs) {
    for (const pid of j.page_ids || []) {
      const prev = inFlight.get(pid);
      // An active job outranks a saved one as the reason to report.
      if (!prev || (prev.status === 'saved' && j.status !== 'saved')) {
        inFlight.set(pid, { job_id: j.id, status: j.status, created_at: j.created_at });
      }
    }
  }
  return inFlight;
}

/**
 * Split candidate pages into the ones to submit and the ones refused, each refusal with a reason.
 * `force` submits everything but still REPORTS what it overrode.
 */
export function partitionGuardedPages(pages, inFlight, { force = false, idOf = (p) => p.id } = {}) {
  const keep = [];
  const skipped = [];
  for (const p of pages) {
    const hit = inFlight.get(idOf(p));
    if (!hit) { keep.push(p); continue; }
    const reason = hit.status === 'saved' ? 'saved_recently' : 'in_flight';
    if (force) { keep.push(p); skipped.push({ page_id: idOf(p), reason: `${reason}_forced`, job_id: hit.job_id, status: hit.status }); continue; }
    skipped.push({ page_id: idOf(p), reason, job_id: hit.job_id, status: hit.status });
  }
  return { keep, skipped };
}

/** One log line for a set of refusals: counts by reason and the jobs that blocked them. */
export function describeSkips(skipped) {
  if (!skipped.length) return '';
  const byReason = {};
  const jobs = new Set();
  for (const s of skipped) { byReason[s.reason] = (byReason[s.reason] || 0) + 1; jobs.add(s.job_id); }
  const reasons = Object.entries(byReason).map(([r, n]) => `${n} ${r}`).join(', ');
  const jobList = [...jobs].slice(0, 3).join(', ') + (jobs.size > 3 ? ` +${jobs.size - 3} more` : '');
  return `${skipped.length} pages refused (${reasons}) — already in job(s) ${jobList}`;
}
