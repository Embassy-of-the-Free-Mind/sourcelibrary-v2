// PRIOR ART: scripts/lib/translate-batch-seam.mjs — the Batch API translation lane as shipped
// (#4681): every block of a book in ONE job, unseeded, then a repair job over the seams. It
// cannot chain, because a Batch job takes every request up front; the repair pass is where the
// measured defects came from (#5085: echo, dropped sentence, fabricated bridge) and production
// stayed ahead on fidelity (25–18, PR #5104). This file reuses its planning, request shape,
// adapter contract and meter; it replaces the run lifecycle. scripts/workers/translate-worker.mjs
// — the realtime loop this lane reproduces round by round (translateBatch / translatePageGuarded
// / effectiveBatchSize); it runs main() on import, so its helpers are mirrored here, with the
// prompt builders and guards imported from translate-core where they already live.
/**
 * translate-batch-chained — production's translation loop, one block per round, on the Batch API.
 *
 * WHY. Realtime translation chains: block k is sent with the tail of block k−1's fresh
 * translation, and since #5103 with the OCR of the pages adjacent to it. A single Batch job
 * cannot do that. But a Batch job round-trips in 3–10 minutes (27 runs, 2026-09-24), so the
 * chain can run ACROSS jobs: each round submits, for one book, the next block the realtime
 * worker would send, seeded from Mongo exactly as the worker seeds it (the stored translation
 * of the page before the block). The prompt is built by the same translate-core functions with
 * the same options, so a page translated here is a page translated by production, at the batch
 * price, minus the wall-clock.
 *
 * SHAPE OF A RUN (one book, one document in `translate_batch_runs`, mode: 'chained'):
 *
 *   enrol   queue = the pages the realtime worker would translate (selectPages), in order
 *   round n plan the next requests: every pending single page if the previous round left any (one
 *           request each), else the next block (planBlocks, the worker's partition) — seed + adjacent OCR
 *           from Mongo — the request rides in a Batch job SHARED with every other ready run's
 *           (≤ MAX_REQUESTS_PER_JOB per job, one model per job) — meter a placeholder per run,
 *           keyed `<job>#<runId>` so each book keeps its own meter row
 *   collect parse as the worker parses (parseBlockTranslations: 15% truncation reject,
 *           positional fallback, BLOCK-SHIFT discard; dropDriftedPages), write every page that
 *           came back through translate-core's door (refuseUnhealthy), queue every page that did
 *           not as a single-page request for the next round (the worker's missing-from-batch
 *           path; all of them in one round, each seeded only if its predecessor is stored) —
 *           complete the meter — plan the next round
 *   done    queue exhausted and nothing pending → `complete`; counters synced
 *
 * A HOLD placed after enrol (#5424) parks the run at the next step: before a round is submitted
 * (nothing is sent), and at collect before any page is written (the round's texts stay on the run
 * document, `held_texts`, as a shadow run keeps its drafts; the meter is completed as usual). A
 * hold-parked run is TERMINAL, like any park: after release the book is enrolled afresh (by hand or
 * by the auto-selectors, which do not exclude a run parked for a hold), and the new queue skips
 * whatever the old run already wrote. It is never resumed, because the reason for most holds is
 * that the pages are about to change underneath it.
 *
 * A dead or cancelled job, or a round whose every request errored, is a STRIKE: the same plan is resubmitted
 * next round; MAX_STRIKES in a row parks the run (the worker's MAX_BATCH_FAILURES). A block
 * that parsed nothing is a strike too; a block discarded short, or with a drifted boundary, is
 * not — its pages go single-page, as in production.
 *
 * Pure planning is exported for tests; the round functions take every side effect (Gemini,
 * meter, writes) as an injected dependency, the same `deps` contract as the seam lane.
 */
import {
  PAGE_BREAK_SCOPED,
  buildTranslationPrompt,
  buildBlockTranslationPrompt,
  parseBlockTranslations,
  assessTranslationHealth,
  sanitizeTranslationTags,
  isTranslatablePage,
  writePageTranslation,
  syncBookTranslationCounters,
  getTranslateModelForBook,
  contentHash,
  BLOCK_TAGS,
} from './translate-core.mjs';
import { codeVersion, host, NOT_RECORDED } from './write-provenance.mjs';
import { stripMarkupTags } from './strip-markup-tags.mjs';
import { isHeld, NOT_HELD } from './pipeline-hold.mjs';
import { dropDriftedPages } from './block-drift.mjs';
import { sumBatchResponseUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { costOf, BATCH_MULTIPLIER } from './model-pricing.mjs';
import {
  planBlocks, maxOutputTokensFor, batchRequest, responseTextOf, selectPages,
  RUNS_COLLECTION, MAX_PAGES_PER_RUN,
} from './translate-batch-seam.mjs';

export const MODE = 'chained';
export const ENDPOINT = 'hetzner/translate-batch-chained';
export const REVISION_NOTE = 'translate-batch-chained';
export const MAX_STRIKES = 3;                 // translate-worker MAX_BATCH_FAILURES
/**
 * Requests per shared Batch job. One job per book per round made N books N jobs every ~5 minutes
 * against the ~100-jobs-per-key cap; sharing makes it ⌈N/50⌉. A job that dies strikes every run
 * in it, so the cap also bounds how many runs one API cancel sets back.
 */
export const MAX_REQUESTS_PER_JOB = 50;

/**
 * A run's meter key inside a shared job. completeBatchUsage matches its placeholder on this exact
 * string, so each book in a job keeps its own gemini_usage row. Wherever the value is used as a
 * Gemini job name, strip the `#…` (baseJobName).
 */
export const meterIdFor = (jobName, runId) => `${jobName}#${runId}`;
export const baseJobName = (batchJobId) => String(batchJobId || '').split('#')[0];

/** Run phases. Terminal: complete, parked, failed. */
export const PHASE = Object.freeze({
  READY: 'round_ready',          // nothing in flight; the next tick submits a round
  SUBMITTING: 'round_submitting', // claimed by one ticker while it builds and submits the round
  SUBMITTED: 'round_submitted',  // a Batch job is open for this run
  COMPLETE: 'complete',
  PARKED: 'parked',
  FAILED: 'failed',
});
export const TERMINAL_PHASES = [PHASE.COMPLETE, PHASE.PARKED, PHASE.FAILED];

const DONE_STATES = new Set(['JOB_STATE_SUCCEEDED']);
const DEAD_STATES = new Set(['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);

// ── Collapse guard (translate-worker looksCollapsed, ported) ───────────────
// flash-lite occasionally COLLAPSES a substantial single page into its boundary <note> and the
// <summary>/<keywords> wrapper. The worker retries once and keeps the attempt with more prose;
// here the retry is the next round.
const COLLAPSE_OCR_FLOOR = 800;
const COLLAPSE_BODY_CAP = 300;
const wrapperRe = new RegExp(`<(${BLOCK_TAGS.join('|')})\\b[^>]*>[\\s\\S]*?</\\1>`, 'gi');
export function strippedBodyLen(text) {
  if (!text) return 0;
  return stripMarkupTags(String(text).replace(wrapperRe, ' ')).replace(/\s+/g, ' ').trim().length;
}
export function looksCollapsed(ocrData, text) {
  return (ocrData || '').length > COLLAPSE_OCR_FLOOR && strippedBodyLen(text) < COLLAPSE_BODY_CAP;
}

// ── Planning (pure) ────────────────────────────────────────────────────────

const ref = (p) => ({ id: p.id, page_number: p.page_number, ocr_hash: contentHash(p.ocr?.data || '') });

/**
 * What the next round sends, given the run and fresh page docs (Map id → doc):
 *   { kind: 'single'|'block', pages: [docs], dropped: [{id, reason}] } or null when nothing is left.
 * Pages whose OCR changed since enrolment, or that were translated meanwhile (the realtime lane
 * or a human), or that no longer pass isTranslatablePage, are DROPPED from the plan and
 * reported — never sent, never overwritten. Pending single pages come first, ALL of them in one
 * round, one request each: the worker translates fallback pages one after another, each seeded by
 * the previous, but here that cost one ~5-minute round per page (an 8-page discarded block took 8
 * rounds). A page whose predecessor's translation is already stored is still seeded from it; the
 * rest go unseeded, and their provenance says so (context.previous_translation false).
 */
export function planNextRound(run, pageDocs) {
  const dropped = [];
  const live = (r) => {
    const p = pageDocs.get(r.id);
    if (!p) { dropped.push({ id: r.id, reason: 'page-missing' }); return null; }
    if (contentHash(p.ocr?.data || '') !== r.ocr_hash) { dropped.push({ id: r.id, reason: 'ocr_changed' }); return null; }
    if (p.translation?.data) { dropped.push({ id: r.id, reason: 'already_translated' }); return null; }
    const v = isTranslatablePage(p);
    if (!v.ok) { dropped.push({ id: r.id, reason: `not_translatable:${v.reason}` }); return null; }
    return p;
  };
  const pending = (run.pending_single || []).map(live).filter(Boolean);
  if (pending.length) return { kind: 'single', pages: pending, dropped };
  const rest = [];
  for (const r of (run.queue || []).slice(run.cursor || 0)) {
    const p = live(r);
    if (p) rest.push(p);
  }
  if (!rest.length) return dropped.length ? { kind: null, pages: [], dropped } : null;
  const block = planBlocks(rest)[0];
  return { kind: block.length === 1 ? 'single' : 'block', pages: block, dropped };
}

/** Conservative batch-price estimate for the whole queue, seeds included (~1 page of context per block). */
export function estimateChainedUsd({ prompts, book, pages, model }) {
  let inChars = 0, outChars = 0;
  for (const block of planBlocks(pages)) {
    inChars += buildBlockTranslationPrompt({ prompts, book, pages: block }).prompt.length + 2400;
    outChars += block.reduce((n, p) => n + (p.ocr?.data || '').length, 0);
  }
  return +(costOf(model, inChars / 3.5, outChars / 2.5) * BATCH_MULTIPLIER).toFixed(4);
}

function roundEstimateUsd({ model, prompt, pages }) {
  const outChars = pages.reduce((n, p) => n + (p.ocr?.data || '').length, 0);
  return costOf(model, prompt.length / 3.5, outChars / 2.5) * BATCH_MULTIPLIER;
}

// ── Mongo lookups the worker makes (mirrored) ──────────────────────────────

/** translate-worker: the stored translation of the page before the block, if any. */
async function seedFor(db, bookId, firstPageNumber) {
  if (!(firstPageNumber > 1)) return null;
  const prev = await db.collection('pages').findOne(
    { book_id: bookId, page_number: firstPageNumber - 1, 'translation.data': { $exists: true } },
    { projection: { _id: 0, 'translation.data': 1 } });
  return prev?.translation?.data || null;
}

/** translate-worker adjacentOcr: the OCR of the pages either side of the block, by page number. */
async function adjacentOcr(db, bookId, firstPageNumber, lastPageNumber) {
  const wanted = [firstPageNumber - 1, lastPageNumber + 1].filter((n) => n > 0);
  if (!wanted.length) return {};
  const rows = await db.collection('pages')
    .find({ book_id: bookId, page_number: { $in: wanted } }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .toArray();
  const byNum = new Map(rows.map((p) => [p.page_number, p.ocr?.data || null]));
  return { prevOcrText: byNum.get(firstPageNumber - 1) || undefined, nextOcrText: byNum.get(lastPageNumber + 1) || undefined };
}

async function loadPageDocs(db, ids) {
  const docs = await db.collection('pages').find({ id: { $in: ids } },
    { projection: { id: 1, _id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } }).toArray();
  return new Map(docs.map((d) => [d.id, d]));
}

/** The exact request the realtime worker would build for these pages, from the same builders. */
export async function buildRoundRequest(db, { prompts, book, pages, kind }) {
  const first = pages[0].page_number, last = pages[pages.length - 1].page_number;
  const previousTranslation = await seedFor(db, book.id, first);
  const { prevOcrText, nextOcrText } = await adjacentOcr(db, book.id, first, last);
  const built = kind === 'block'
    ? buildBlockTranslationPrompt({ prompts, book, pages, previousTranslation, prevOcrText, nextOcrText, pageBreak: PAGE_BREAK_SCOPED })
    : buildTranslationPrompt({ prompts, book, ocrText: pages[0].ocr.data, previousTranslation, prevOcrText, nextOcrText, pageBreak: PAGE_BREAK_SCOPED });
  const maxOutputTokens = maxOutputTokensFor(pages);
  return {
    prompt: built.prompt, promptRef: built.promptRef, maxOutputTokens,
    context: { previous_translation: !!previousTranslation, prev_ocr: !!prevOcrText, next_ocr: !!nextOcrText, page_break: 'scoped', ...(kind === 'block' ? { block: { pages: pages.length, first_page: first } } : {}) },
  };
}

// ── Meter (placeholder at submit, completed from the response, per round) ──
function meterPlaceholder(deps, db, { run, jobName, pageCount }) {
  return deps.logUsage({
    type: 'translation', mode: 'batch', model: run.model,
    book_id: run.book_id, page_count: pageCount,
    input_tokens: 0, output_tokens: 0, status: 'submitted',
    batch_job_id: jobName, endpoint: ENDPOINT,
    prompt_version: String(run.prompt_ref?.version ?? ''),
    triggered_by: 'manual',
  }, db);
}
function meterComplete(deps, db, { run, jobName, pageCount, responses, status = 'success', error }) {
  const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
  return deps.completeBatchUsage({
    type: 'translation', mode: 'batch', model: run.model,
    book_id: run.book_id, page_count: pageCount,
    input_tokens: inputTokens, output_tokens: outputTokens,
    status, ...(error ? { error_message: error } : {}),
    batch_job_id: jobName, endpoint: ENDPOINT,
    prompt_version: String(run.prompt_ref?.version ?? ''),
    triggered_by: 'manual',
    ...(responses?.length ? {} : { insertIfMissing: false }),
  }, db);
}

// ── Run lifecycle ──────────────────────────────────────────────────────────
// deps = { gemini: { submit, fetch }, logUsage, completeBatchUsage, budgetAllows(db, label),
//          writePage?, syncPage?, log?, now? }  — the seam lane's contract.

const newRunId = () => `tbc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

async function setRun(db, run, set, deps) {
  const now = deps.now ? deps.now() : new Date();
  await db.collection(RUNS_COLLECTION).updateOne({ id: run.id }, { $set: { ...set, updated_at: now } });
  Object.assign(run, set, { updated_at: now });
}

/** A claim older than this was left by a ticker that died mid-submit; the run goes back to READY. */
export const STALE_CLAIM_MS = 15 * 60 * 1000;

/**
 * Park a run because its book is held (#5424). `parked_for_hold` names the hold's reason, so the
 * auto-selectors can tell this park (re-enrolable once the hold is released) from a strike park
 * (re-enrol by hand once the cause is known). Returns the parked_reason.
 */
async function parkForHold(db, run, book, deps, extra = {}) {
  const log = deps.log || console.log;
  const h = book.pipeline_auto.hold;
  const reason = `book-held (${h.reason})`;
  await setRun(db, run, { phase: PHASE.PARKED, round: null, claimed_at: null, parked_reason: reason, parked_for_hold: h.reason, ...extra }, deps);
  log(`[translate-batch-chained] ${run.book_id}: PARKED — ${reason}${h.issue ? ` #${h.issue}` : ''}; nothing further sent or written`);
  return reason;
}

/** READY → SUBMITTING, atomically. False when another ticker holds (or just took) the run. */
async function claimRun(db, run, deps) {
  if (run.phase !== PHASE.READY) return false;
  const now = deps.now ? deps.now() : new Date();
  const res = await db.collection(RUNS_COLLECTION).updateOne({ id: run.id, phase: PHASE.READY }, { $set: { phase: PHASE.SUBMITTING, claimed_at: now, updated_at: now } });
  if (!res.matchedCount) return false;
  Object.assign(run, { phase: PHASE.SUBMITTING, claimed_at: now, updated_at: now });
  return true;
}

/**
 * Enrol one book: the pages the realtime worker would translate become the queue, and the first
 * round is submitted. Refuses (sends nothing) on a held book, a book the realtime lane owns
 * (`translate_submitted`), an open run, nothing to translate, an estimate over `approvedUsd`, or
 * a closed dial. Returns { ok, reason?, run?, estimate? }.
 */
export async function enrolChainedRun(db, bookId, deps, { prompts, approvedUsd, limit = MAX_PAGES_PER_RUN, submit = true, pageIds = null, excludeWithheld = false, dryRun = false } = {}) {
  const log = deps.log || console.log;
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return { ok: false, reason: 'book-not-found' };
  if (isHeld(book)) return { ok: false, reason: `book-held (${book.pipeline_auto.hold.reason})`, book };
  if (book.pipeline_auto?.status === 'translate_submitted') return { ok: false, reason: 'realtime-lane-owns-book (pipeline_auto.status=translate_submitted)', book };
  const open = await db.collection(RUNS_COLLECTION).findOne({ book_id: bookId, phase: { $nin: [...TERMINAL_PHASES, 'written', 'shadow_complete', 'failed'] } });
  if (open) return { ok: false, reason: `open-run ${open.id} (${open.phase})`, book };
  const { pages, excluded } = await selectPages(db, bookId, { limit, pageIds, excludeWithheld });
  if (pages.length === 0) return { ok: false, reason: 'nothing-to-translate', book, excluded };
  const model = getTranslateModelForBook(book);
  const estimate = estimateChainedUsd({ prompts, book, pages, model });
  // dryRun: every refusal above, then stop — the queue and price an enrol would make, nothing written.
  if (dryRun) return { ok: true, dryRun: true, book, model, pages, excluded, estimate };
  if (!(Number(approvedUsd) >= estimate)) return { ok: false, reason: `estimate $${estimate} exceeds approved $${approvedUsd ?? 0}`, book, estimate };

  const now = deps.now ? deps.now() : new Date();
  const run = {
    id: newRunId(), book_id: bookId, model, mode: MODE, shadow: false,
    phase: PHASE.READY, prompt_ref: null,
    queue: pages.map(ref), cursor: 0, pending_single: [],
    round: null, rounds: [], strikes: 0, dropped: [],
    counts: { written: 0, unhealthy: 0, protected: 0, blocked: 0, dropped: 0, single_fallbacks: 0 },
    page_count: pages.length, excluded, estimate, approved_usd: Number(approvedUsd), spent_est_usd: 0,
    code_version: await codeVersion(), host: host(),
    created_at: now, updated_at: now,
  };
  await db.collection(RUNS_COLLECTION).insertOne(run);
  log(`[translate-batch-chained] ${bookId}: run ${run.id} — ${pages.length} pages queued, est $${estimate}`);
  // submit:false leaves the run READY for the next tick, which packs it into a shared job with the rest.
  const sub = submit ? await submitRound(db, run, deps, { prompts }) : { submitted: false, note: 'enrolled; next tick submits' };
  return { ok: true, run, estimate, submitted: sub };
}

/**
 * The requests of one round. A block is ONE request; a round of single pages is one request PER
 * PAGE, all in the same round (the discarded block's pages no longer wait for each other). A
 * round from before this shape carried its one request's fields on the round itself.
 */
export function unitsOf(round) {
  if (round.units) return round.units;
  return [{ key: round.key, pages: round.pages, prompt_sent_hash: round.prompt_sent_hash, prompt_sent_chars: round.prompt_sent_chars, max_output_tokens: round.max_output_tokens, context: round.context, retry: round.retry, first_text: round.first_text }];
}

/** The first text of a page whose single translation looked collapsed, awaiting its one retry. */
function collapseRetryText(run, pageId) {
  const hit = (run.collapse_retries || []).find((c) => c.page_id === pageId);
  if (hit) return hit.first_text;
  return run.collapse_retry?.page_id === pageId ? run.collapse_retry.first_text : undefined;  // pre-units shape
}

/**
 * Plan and build a READY run's next requests, with every refusal that sends nothing: a book held
 * since enrol (the run parks, #5424), a closed dial,
 * or a running estimate past the approval (the run stays READY and the next tick tries again — a
 * closed dial reopens at midnight; an approval is topped up by the operator), or a finished queue
 * (the run completes). Returns { prepared } or { submitted: false, note }.
 */
async function prepareRound(db, run, deps, { prompts }) {
  if (run.phase !== PHASE.READY && run.phase !== PHASE.SUBMITTING) return { submitted: false, note: `phase ${run.phase}` };
  // Re-read the book every round: enrol refused a held book, but a hold placed since then must
  // stop the run here, before anything is planned or sent.
  const book = await db.collection('books').findOne({ id: run.book_id });
  if (isHeld(book)) return { submitted: false, note: `parked: ${await parkForHold(db, run, book, deps)}` };
  const ids = [...(run.pending_single || []).map((r) => r.id), ...(run.queue || []).slice(run.cursor || 0).map((r) => r.id)];
  const pageDocs = await loadPageDocs(db, ids);
  const plan = planNextRound(run, pageDocs);
  if (plan?.dropped?.length) {
    const droppedIds = new Set(plan.dropped.map((d) => d.id));
    await setRun(db, run, {
      dropped: [...(run.dropped || []), ...plan.dropped],
      pending_single: (run.pending_single || []).filter((r) => !droppedIds.has(r.id)),
      queue: (run.queue || []).filter((r, i) => i < (run.cursor || 0) || !droppedIds.has(r.id)),
      'counts.dropped': (run.counts?.dropped || 0) + plan.dropped.length,
    }, deps);
    if (run.counts) run.counts.dropped = (run.counts.dropped || 0) + plan.dropped.length;
  }
  if (!plan || !plan.kind) return finishRun(db, run, deps);

  if (!(await deps.budgetAllows(db, `translate-batch-chained ${run.book_id}`))) return { submitted: false, note: 'spend-dial-closed' };
  const n = (run.rounds || []).length + 1;
  const groups = plan.kind === 'block' ? [plan.pages] : plan.pages.map((p) => [p]);
  const units = [];
  const requests = [];
  let est = 0;
  for (const pages of groups) {
    // Seeded from the STORED translation of the page before, as the worker seeds: a fallback page
    // whose predecessor is in this same round goes unseeded (context.previous_translation false).
    const req = await buildRoundRequest(db, { prompts, book, pages, kind: plan.kind });
    est += roundEstimateUsd({ model: run.model, prompt: req.prompt, pages });
    // The key names the run as well as the round (and the page, for singles): a shared job's
    // responses are told apart by it.
    const key = plan.kind === 'block' ? `${run.id}:r${n}` : `${run.id}:r${n}:p${pages[0].page_number}`;
    const unit = {
      key, pages: pages.map(ref),
      prompt_sent_hash: contentHash(req.prompt), prompt_sent_chars: req.prompt.length, max_output_tokens: req.maxOutputTokens,
      context: req.context, prompt_ref: req.promptRef,
    };
    // A collapsed single page is retried once (worker translatePageGuarded): the first text rides
    // along so the better of the two is kept.
    const first = plan.kind === 'single' ? collapseRetryText(run, pages[0].id) : undefined;
    if (first !== undefined) { unit.retry = true; unit.first_text = first; }
    units.push(unit);
    requests.push(batchRequest({ key, prompt: req.prompt, maxOutputTokens: req.maxOutputTokens }));
  }
  if (run.spent_est_usd + est > run.approved_usd) return { submitted: false, note: `approval exhausted (est $${(run.spent_est_usd + est).toFixed(4)} > $${run.approved_usd})` };
  return { prepared: { run, plan, units, requests, est, n } };
}

/**
 * Split prepared rounds into jobs: one model per job, at most `max` requests each. A run's
 * requests stay in one job (its round has one job); a run with more than `max` rides alone.
 */
export function packJobs(prepared, max = MAX_REQUESTS_PER_JOB) {
  const byModel = new Map();
  for (const p of prepared) byModel.set(p.run.model, [...(byModel.get(p.run.model) || []), p]);
  const jobs = [];
  for (const [model, items] of byModel) {
    let cur = null;
    for (const p of items) {
      const size = p.requests?.length ?? 1;
      if (!cur || cur.size + size > max) { cur = { model, items: [], size: 0 }; jobs.push(cur); }
      cur.items.push(p);
      cur.size += size;
    }
  }
  return jobs.map(({ model, items }) => ({ model, items }));
}

/**
 * Submit the next round of every READY run given, sharing Batch jobs across books. Returns a Map
 * runId → { submitted, note }. A job that fails to submit leaves its runs READY (nothing was
 * recorded), and the next tick tries again.
 */
export async function submitRounds(db, runs, deps, { prompts }) {
  const log = deps.log || console.log;
  const out = new Map();
  const prepared = [];
  const release = async (run) => { if (run.phase === PHASE.SUBMITTING) await setRun(db, run, { phase: PHASE.READY, claimed_at: null }, deps); };
  for (const run of runs) {
    // Claim first. Two tickers that both read a run as READY (a hand-run tick beside the loop,
    // or a long enrol pass whose runs sat READY for minutes) must not both submit it: on
    // 2026-09-30 a second ticker re-submitted ~150 freshly enrolled runs 34 s after the first,
    // orphaning the first job's results — paid for, never collected.
    if (!(await claimRun(db, run, deps))) { out.set(run.id, { submitted: false, note: 'claimed by another ticker' }); continue; }
    try {
      const r = await prepareRound(db, run, deps, { prompts });
      if (r.prepared) prepared.push(r.prepared);
      else { await release(run); out.set(run.id, r); }
    } catch (e) {
      await release(run).catch(() => {});
      out.set(run.id, { submitted: false, note: `ERROR ${e.message?.slice(0, 160)}` });
    }
  }
  for (const { model, items } of packJobs(prepared)) {
    const requests = items.flatMap((p) => p.requests);
    const label = items.length === 1 ? `${items[0].run.book_id}-${items[0].run.id}-r${items[0].n}` : `${items.length}runs-${Date.now().toString(36)}`;
    let job;
    try {
      job = await deps.gemini.submit({ model, requests, displayName: `tbc-${label}` });
    } catch (e) {
      for (const p of items) { await release(p.run); out.set(p.run.id, { submitted: false, note: `submit failed: ${e.message?.slice(0, 160)}` }); }
      continue;
    }
    const now = deps.now ? deps.now() : new Date();
    for (const { run, plan, units, est, n } of items) {
      const meterId = meterIdFor(job.name, run.id);
      const round = {
        n, kind: plan.kind, pages: plan.pages.map(ref), units: units.map(({ prompt_ref, ...u }) => u),
        est_usd: +est.toFixed(5),
        job: { name: job.name, key_index: job.keyIndex, submitted_at: now, requests: requests.length },
        meter_id: meterId,
      };
      await setRun(db, run, { phase: PHASE.SUBMITTED, round, collapse_retry: null, prompt_ref: run.prompt_ref || units[0].prompt_ref, spent_est_usd: +(run.spent_est_usd + est).toFixed(5) }, deps);
      await meterPlaceholder(deps, db, { run, jobName: meterId, pageCount: plan.pages.length });
      const seeded = units.filter((u) => u.context.previous_translation).length;
      const span = `p${plan.pages[0].page_number}${plan.pages.length > 1 ? `–${plan.pages[plan.pages.length - 1].page_number}` : ''}`;
      const seedNote = units.length === 1 ? (seeded ? ' seeded' : ' unseeded') : ` ${units.length} singles, ${seeded} seeded`;
      log(`[translate-batch-chained] ${run.book_id}: round ${n} — ${plan.kind} ${span}${seedNote} → ${job.name}${requests.length > units.length ? ` (shared, ${requests.length} requests)` : ''}`);
      out.set(run.id, { submitted: true, note: `round ${n} ${job.name}` });
    }
  }
  return out;
}

/** Submit the next round for one READY run, in a job of its own. Returns { submitted, note }. */
export async function submitRound(db, run, deps, { prompts }) {
  return (await submitRounds(db, [run], deps, { prompts })).get(run.id);
}

async function finishRun(db, run, deps) {
  const log = deps.log || console.log;
  if (run.counts?.written > 0) await syncBookTranslationCounters(db, run.book_id);
  await setRun(db, run, { phase: PHASE.COMPLETE, completed_at: deps.now ? deps.now() : new Date() }, deps);
  log(`[translate-batch-chained] ${run.book_id}: COMPLETE — ${JSON.stringify(run.counts)} in ${(run.rounds || []).length} rounds`);
  return { submitted: false, note: 'complete' };
}

async function strike(db, run, deps, reason) {
  const log = deps.log || console.log;
  const strikes = (run.strikes || 0) + 1;
  const rounds = [...(run.rounds || []), { n: run.round.n, kind: run.round.kind, pages: run.round.pages.length, outcome: 'strike', reason, job: run.round.job.name }];
  if (strikes >= MAX_STRIKES) {
    await setRun(db, run, { phase: PHASE.PARKED, strikes, rounds, round: null, parked_reason: `${MAX_STRIKES} consecutive strikes — last: ${reason}` }, deps);
    log(`[translate-batch-chained] ${run.book_id}: PARKED after ${strikes} strikes (${reason})`);
    return { advanced: true, note: `parked: ${reason}` };
  }
  // Same plan again next round: nothing moved in the queue or the pending list.
  await setRun(db, run, { phase: PHASE.READY, strikes, rounds, round: null }, deps);
  log(`[translate-batch-chained] ${run.book_id}: strike ${strikes}/${MAX_STRIKES} — ${reason}; resubmitting`);
  return { advanced: true, note: `strike ${strikes}: ${reason}` };
}

/** translate-worker: a RECITATION / SAFETY refusal is stamped on the page so it leaves the queue. */
async function markRefused(db, page, finishReason, deps) {
  const now = deps.now ? deps.now() : new Date();
  const recitation = /RECITATION/i.test(finishReason);
  await db.collection('pages').updateOne({ id: page.id }, [{ $set: { translation: { $cond: { if: { $eq: ['$translation', null] }, then: {}, else: '$translation' } } } }]).catch(() => {});
  await db.collection('pages').updateOne({ id: page.id }, { $set: recitation
    ? { 'translation.recitation_blocked': true, 'translation.recitation_at': now, 'translation.safety_reason': `batch finishReason ${finishReason}`, 'translation.data': '[This page could not be translated due to content recitation restrictions.]', 'translation.language': 'English', 'translation.source': 'skip', 'translation.updated_at': now }
    : { 'translation.safety_blocked': true, 'translation.safety_blocked_at': now, 'translation.safety_reason': `batch finishReason ${finishReason}`, 'translation.data': '[This page could not be translated due to content safety restrictions.]', 'translation.language': 'English', 'translation.source': 'skip', 'translation.updated_at': now } });
}

/** One page through translate-core's door, with the provenance of the request that produced it. */
async function writeRoundPage(db, run, book, page, text, deps, unit) {
  const writePage = deps.writePage || writePageTranslation;
  const r = run.round;
  const res = await writePage(db, {
    page, book, text, promptRef: run.prompt_ref, model: run.model,
    jobId: run.id, note: REVISION_NOTE, refuseUnhealthy: true,
    call: {
      call_site: 'scripts/lib/translate-batch-chained.mjs', api: 'batch', model: run.model,
      prompt_sent_hash: unit.prompt_sent_hash || NOT_RECORDED, prompt_sent_chars: unit.prompt_sent_chars,
      generationConfig: { maxOutputTokens: unit.max_output_tokens, thinkingConfig: { thinkingBudget: 0 } },
      run: { batch_job_id: r.job.name, job_id: run.id, round: r.n, code_version: run.code_version || NOT_RECORDED, host: run.host || NOT_RECORDED },
      context: unit.context,
    },
  });
  if (res.written) {
    run.counts.written++;
    if (deps.syncPage) deps.syncPage(page.id, { translation: { data: res.text, language: 'English', model: run.model, source: 'ai', prompt_version: String(run.prompt_ref?.version ?? ''), prompt_id: run.prompt_ref?.id, prompt_hash: run.prompt_ref?.content_hash, prompt_name: run.prompt_ref?.name, updated_at: new Date() } });
  } else if (res.unhealthy) {
    run.counts.unhealthy++;
    // Same stamp the realtime worker puts on a refused page, so the page leaves the queue.
    await db.collection('pages').updateOne({ id: page.id }, { $set: { 'translation.health_blocked': res.reason, 'translation.health_blocked_at': new Date(), updated_at: new Date() } });
  } else if (res.protected) run.counts.protected++;
  return res;
}

/**
 * Collect a SUBMITTED run's job if it has finished: parse, write, queue fallbacks, plan on.
 * Idempotent while the job is running. Returns { advanced, note }.
 */
export async function collectRound(db, run, deps, { fetched } = {}) {
  const log = deps.log || console.log;
  if (run.phase !== PHASE.SUBMITTED) return { advanced: false, note: `phase ${run.phase}` };
  const round = run.round;
  const units = unitsOf(round);
  // `fetched` is the job fetched once by tickChained for every run in it; alone, fetch it here.
  const { state, responses: all } = fetched || await deps.gemini.fetch(round.job.name);
  // A round submitted before shared jobs (no meter_id) had a job of its own, metered by job name.
  const meterId = round.meter_id || round.job.name;
  // Only this run's responses: a shared job holds other books' answers, and the meter row for
  // this book must sum only this book's tokens. A lone old-shape job may fall back to its only one.
  const texts = (all || []).map(responseTextOf);
  const found = units.map((u) => texts.findIndex((t) => t.key === u.key));
  if (units.length === 1 && found[0] < 0 && !round.meter_id && texts.length === 1) found[0] = 0;
  const responses = found.filter((i) => i >= 0).map((i) => all[i]);
  const answerOf = (i) => (found[i] >= 0 ? texts[found[i]] : null);
  if (DEAD_STATES.has(state)) {
    await meterComplete(deps, db, { run, jobName: meterId, pageCount: round.pages.length, responses, status: 'failed', error: state });
    return strike(db, run, deps, `job ${state}`);
  }
  if (!DONE_STATES.has(state)) return { advanced: false, note: state };

  const answered = units.map((_, i) => answerOf(i)).filter((r) => r && !r.error);
  if (!answered.length) {
    const r = answerOf(0);
    await meterComplete(deps, db, { run, jobName: meterId, pageCount: round.pages.length, responses, status: 'failed', error: r?.error || 'no response' });
    return strike(db, run, deps, r?.error ? `request error: ${r.error}` : 'no response for key');
  }
  await meterComplete(deps, db, { run, jobName: meterId, pageCount: round.pages.length, responses });

  const book = await db.collection('books').findOne({ id: run.book_id });
  if (isHeld(book)) {
    // Held since the round was submitted: the round is paid for (metered above) but no page is
    // written. Its texts stay on the run document, as a shadow run keeps its drafts (#5424).
    const heldTexts = units.map((u, i) => {
      const a = answerOf(i);
      return { key: u.key, page_ids: u.pages.map((p) => p.id), text: a?.text ?? null, finish_reason: a?.finishReason ?? null, error: a?.error ?? null };
    });
    const summary = { n: round.n, kind: round.kind, pages: round.pages.length, job: round.job.name, submitted_at: round.job.submitted_at, collected_at: deps.now ? deps.now() : new Date(), written: 0, outcome: 'held' };
    const reason = await parkForHold(db, run, book, deps, { rounds: [...(run.rounds || []), summary], held_texts: [...(run.held_texts || []), ...heldTexts] });
    return { advanced: true, note: `parked: ${reason}` };
  }
  const pageDocs = await loadPageDocs(db, round.pages.map((p) => p.id));
  const pages = round.pages.map((p) => pageDocs.get(p.id)).filter(Boolean);
  const summary = { n: round.n, kind: round.kind, pages: round.pages.length, job: round.job.name, submitted_at: round.job.submitted_at, collected_at: deps.now ? deps.now() : new Date(), written: 0, fallback: 0 };
  const guardsOk = (p) => contentHash(p.ocr?.data || '') === round.pages.find((x) => x.id === p.id)?.ocr_hash && !p.translation?.data && isTranslatablePage(p).ok;

  if (round.kind === 'block') {
    const r = answerOf(0);
    summary.finish_reason = r.finishReason;
    const parsed = parseBlockTranslations(r.text, pages);
    const { translations } = parsed;
    // Echo-shift guard (#4681 by-eye, 2026-10-01): a block in which the model handed one page's
    // SOURCE back as its "translation" is a block whose other entries are one slot off. Seen on
    // book 69b6307b…, block p16–23: p16 came back as its own Latin, and p17–23 each carried the
    // English of the page BEFORE it. The per-page health gate refused the echo and wrote the seven
    // shifted pages as labelled (each a faithful translation of the wrong page — the defect class
    // a text-only judge rates fidelity 1). The count matched, so the short-block guard could not
    // fire. Labels in such a block cannot be trusted: discard it whole, every page goes single-page.
    const echoed = pages.filter((p) => {
      const t = translations.get(p.page_number);
      return t && assessTranslationHealth(p.ocr?.data || '', t, { lang: book?.language }).reason === 'echo';
    });
    if (echoed.length) {
      translations.clear();
      summary.discarded = 'echo-shift';
      summary.echoed = echoed.map((p) => p.page_number);
    }
    const { drifted } = dropDriftedPages(pages, translations);
    if (parsed.discarded) summary.discarded = parsed.discarded;
    if (drifted.length) summary.drifted = drifted.map((d) => `${d.prev}→${d.next}`);
    summary.returned = parsed.returned;
    if (parsed.returned === 0 && !r.finishReason?.match(/RECITATION|SAFETY|PROHIBITED/i)) {
      // Nothing parsed at all: the worker's consecutiveBatchFailures. Pages are NOT sent single-page
      // yet — the block is resubmitted first (a cancelled/garbled response), parked after MAX_STRIKES.
      return strike(db, run, deps, `block parsed 0/${pages.length} (finish ${r.finishReason})`);
    }
    const pending = [];
    for (const p of pages) {
      const text = translations.get(p.page_number);
      if (text && guardsOk(p)) { const res = await writeRoundPage(db, run, book, p, text, deps, units[0]); if (res.written) summary.written++; }
      else if (!text) { pending.push(ref(p)); summary.fallback++; }
      else run.dropped.push({ id: p.id, reason: 'guard-at-collect' });
    }
    run.counts.single_fallbacks += pending.length;
    await setRun(db, run, {
      phase: PHASE.READY, strikes: 0, round: null, rounds: [...run.rounds, summary],
      cursor: (run.cursor || 0) + round.pages.length, pending_single: [...(run.pending_single || []), ...pending],
      counts: run.counts, dropped: run.dropped,
    }, deps);
    const refused = pages.length - summary.written - pending.length;
    log(`[translate-batch-chained] ${run.book_id}: round ${round.n} block p${pages[0]?.page_number}–${pages[pages.length - 1]?.page_number}: wrote ${summary.written}/${pages.length}${pending.length ? `, ${pending.length} → single-page` : ''}${refused > 0 ? `, ${refused} refused at the write (health gate or guard)` : ''}${parsed.discarded ? ` (${parsed.discarded})` : ''}${drifted.length ? ` (drift ${summary.drifted.join(',')})` : ''}`);
    return { advanced: true, note: `block wrote ${summary.written}/${pages.length}` };
  }

  // Single pages, one request each. A page leaves the plan when it is written, refused, or fails a
  // guard; it stays for the next round when its request errored, came back empty, or collapsed
  // (retried once). A round in which no page left and none began its collapse retry is a strike.
  const resolved = new Set();
  const retries = (run.collapse_retries || []).filter((c) => !units.some((u) => u.pages[0].id === c.page_id));
  const outcomes = [];
  for (let i = 0; i < units.length; i++) {
    const unit = units[i];
    const page = pageDocs.get(unit.pages[0].id);
    const r = answerOf(i);
    if (!r || r.error) { outcomes.push('error'); continue; }
    let text = sanitizeTranslationTags(String(r.text || '').trim());
    const finish = r.finishReason || '';
    if (!text && /RECITATION|SAFETY|PROHIBITED/i.test(finish)) {
      if (page) await markRefused(db, page, finish, deps);
      run.counts.blocked++;
      resolved.add(unit.pages[0].id);
      outcomes.push(`refused ${finish}`);
      log(`[translate-batch-chained] ${run.book_id}: p${page?.page_number} refused (${finish}) — marked`);
      continue;
    }
    if (!text) { outcomes.push(`empty ${finish}`); continue; }
    if (page && looksCollapsed(page.ocr?.data, text) && !unit.retry) {
      // Retry once, next round; keep this text to compare.
      retries.push({ page_id: page.id, first_text: text });
      outcomes.push('collapsed-retry');
      log(`[translate-batch-chained] ${run.book_id}: p${page.page_number} looks collapsed (${strippedBodyLen(text)} body chars) — retrying once`);
      continue;
    }
    if (unit.retry && unit.first_text && strippedBodyLen(unit.first_text) > strippedBodyLen(text)) text = unit.first_text;
    if (page && guardsOk(page)) { const res = await writeRoundPage(db, run, book, page, text, deps, unit); if (res.written) summary.written++; }
    else run.dropped.push({ id: unit.pages[0].id, reason: 'guard-at-collect' });
    resolved.add(unit.pages[0].id);
    outcomes.push('done');
  }
  const moved = resolved.size + outcomes.filter((o) => o === 'collapsed-retry').length;
  if (!moved) return strike(db, run, deps, `singles: ${[...new Set(outcomes)].join(', ')}`);
  summary.outcomes = outcomes;
  await setRun(db, run, {
    phase: PHASE.READY, strikes: 0, round: null, rounds: [...run.rounds, summary],
    pending_single: (run.pending_single || []).filter((x) => !resolved.has(x.id)),
    cursor: [...resolved].reduce((c, id) => advanceCursorPast({ ...run, cursor: c }, id), run.cursor || 0),
    counts: run.counts, dropped: run.dropped, collapse_retries: retries, collapse_retry: null,
  }, deps);
  const left = units.length - resolved.size;
  log(`[translate-batch-chained] ${run.book_id}: round ${round.n} ${units.length} single(s): wrote ${summary.written}${left ? `, ${left} carried to the next round` : ''}`);
  return { advanced: true, note: `singles wrote ${summary.written}/${units.length}` };
}

/** A single page that came from the queue head (not from pending) moves the cursor past itself. */
function advanceCursorPast(run, pageId) {
  const cursor = run.cursor || 0;
  const wasPending = (run.pending_single || []).some((x) => x.id === pageId);
  if (wasPending) return cursor;
  const at = (run.queue || []).findIndex((x, i) => i >= cursor && x.id === pageId);
  return at >= 0 ? at + 1 : cursor;
}

/**
 * One scheduler pass over every open chained run: collect what finished, then submit every ready
 * run's next round in shared jobs. Each job is fetched ONCE for all the runs in it. Returns
 * per-run notes. Safe to call every few minutes from cron; each run moves at most one step per
 * call (collect, then submit).
 */
export async function tickChained(db, deps, { prompts, filter = {} } = {}) {
  const runs = await db.collection(RUNS_COLLECTION).find({ mode: MODE, phase: { $nin: TERMINAL_PHASES }, ...filter }).toArray();
  const notes = new Map(runs.map((run) => [run.id, '']));
  const add = (run, note) => notes.set(run.id, (notes.get(run.id) ? `${notes.get(run.id)}; ` : '') + note);

  const byJob = new Map();
  for (const run of runs) if (run.phase === PHASE.SUBMITTED && run.round?.job?.name) byJob.set(run.round.job.name, [...(byJob.get(run.round.job.name) || []), run]);
  for (const [jobName, inJob] of byJob) {
    let fetched;
    try { fetched = await deps.gemini.fetch(jobName); } catch (e) { for (const run of inJob) add(run, `ERROR fetch ${e.message?.slice(0, 160)}`); continue; }
    for (const run of inJob) {
      try { add(run, (await collectRound(db, run, deps, { fetched })).note); } catch (e) { add(run, `ERROR ${e.message?.slice(0, 160)}`); }
    }
  }

  // A claim nobody finished (the ticker died between claim and submit) is released for this tick.
  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  for (const run of runs) {
    if (run.phase === PHASE.SUBMITTING && nowMs - new Date(run.claimed_at || 0).getTime() > STALE_CLAIM_MS) {
      const res = await db.collection(RUNS_COLLECTION).updateOne({ id: run.id, phase: PHASE.SUBMITTING, claimed_at: run.claimed_at }, { $set: { phase: PHASE.READY, claimed_at: null } });
      if (res.matchedCount) { run.phase = PHASE.READY; add(run, 'stale claim released'); }
    }
  }
  const ready = runs.filter((run) => run.phase === PHASE.READY);
  const submitted = await submitRounds(db, ready, deps, { prompts });
  for (const run of ready) if (submitted.has(run.id)) add(run, submitted.get(run.id).note);

  return runs.map((run) => ({ run: run.id, book_id: run.book_id, phase: run.phase, note: notes.get(run.id) }));
}

// ── Auto-enrolment (the scheduler's selector) ───────────────────────────────
/**
 * Statuses a book may sit at and still be owed translation. The orchestrator's gap-fill selects
 * the first four only; 68 of the 105 stalled books measured on 2026-09-29 sat at the next four,
 * which no phase ever selects for translation, and `ocr_complete` is Phase 4's own input.
 * `translate_submitted` is absent on purpose: the realtime lane owns that book.
 */
export const AUTO_STATUSES = Object.freeze([
  'translate_partial', 'translate_complete', 'chapters_complete', 'complete',
  'images_complete', 'needs_attention', 'failed', 'archive_complete',
  'ocr_complete',
]);
/** Approval per page for an auto-enrolled book: 2× the measured $0.00056/pg (#4681, 2026-09-29), rounded up. */
export const AUTO_APPROVAL_USD_PER_PAGE = 0.0012;
/** Reader requests (processing_priority ≥ this) stay on the realtime lane, where they finish in minutes. */
export const REALTIME_PRIORITY_FLOOR = 90;
/**
 * The realtime line's measured cost per page ($0.00241, 2026-09-04). Phase 4 approves a chained run
 * up to this, because above it the batch lane saves nothing and the book is sent realtime instead.
 */
export const REALTIME_USD_PER_PAGE = 0.0024;
/** Open chained runs the orchestrator may hold, shared with --enrol-auto's --max-open (cron: 60). */
export const PHASE4_MAX_OPEN = 60;

/**
 * Which lane Phase 4 dispatches a book to (#4681, decided 2026-09-30). Reader requests
 * (processing_priority ≥ REALTIME_PRIORITY_FLOOR) finish in minutes on the realtime lane; every
 * other book goes to the chained Batch lane at about a quarter of the price.
 * PHASE4_TRANSLATE_LANE=realtime in the orchestrator's environment sends everything realtime again.
 */
export function phase4Lane(book, env = process.env) {
  if (String(env.PHASE4_TRANSLATE_LANE || '').toLowerCase() === 'realtime') return 'realtime';
  return Number(book?.processing_priority) >= REALTIME_PRIORITY_FLOOR ? 'realtime' : 'chained';
}

/**
 * Books Phase 4 must not select for the chained lane this tick: an open run of any lane (the
 * pages are already on their way); a run this lane PARKED (re-enrol by hand once the cause is
 * known) — except one parked for a hold, whose book the hold itself keeps out until release; and a chained run that ended in the last day WITHOUT writing its whole queue — what it
 * refused (unhealthy, recitation) must not come back every tick. A run that wrote everything does
 * not exclude its book: Phase 4 then finds nothing left and advances it to translate_complete, or
 * enrols the next MAX_PAGES_PER_RUN slice of a longer book.
 */
export async function phase4ExcludedBookIds(db, { now = new Date() } = {}) {
  const since = new Date(now.getTime() - 24 * 3600 * 1000);
  return db.collection(RUNS_COLLECTION).distinct('book_id', { $or: [
    { phase: { $nin: [...TERMINAL_PHASES, 'written', 'shadow_complete', 'failed'] } },
    { mode: MODE, phase: PHASE.PARKED, parked_for_hold: { $exists: false } },
    { mode: MODE, updated_at: { $gte: since }, $expr: { $lt: [{ $ifNull: ['$counts.written', 0] }, { $ifNull: ['$page_count', 0] }] } },
  ] });
}

/**
 * Phase 4's chained dispatch of one book: enrol it (submit:false — the 5-minute tick packs it into
 * a shared job), approved at pages × AUTO_APPROVAL_USD_PER_PAGE, or, when the lane's own estimate
 * is higher (it runs ~2× high on dense books), at that estimate as long as it stays under
 * REALTIME_USD_PER_PAGE. Returns { lane: 'chained', run } on enrolment, { lane: 'skip', reason } for
 * a book neither lane should take now (held, open run), and { lane: 'realtime', reason } when the
 * realtime lane should take it instead (estimate above the realtime price, nothing the batch
 * selector would send). Spends nothing: every round is still gated at submit.
 */
export async function enrolForPhase4(db, book, { prompts, pageCount, deps = {} } = {}) {
  const owed = Math.max(1, Math.min(MAX_PAGES_PER_RUN, pageCount || 0));
  const first = await enrolChainedRun(db, book.id, deps, { prompts, approvedUsd: +(owed * AUTO_APPROVAL_USD_PER_PAGE).toFixed(4), submit: false });
  if (first.ok) return { lane: 'chained', run: first.run };
  if (/^(book-held|open-run|realtime-lane-owns-book)/.test(first.reason)) return { lane: 'skip', reason: first.reason };
  const ceiling = +(owed * REALTIME_USD_PER_PAGE).toFixed(4);
  if (first.estimate != null && first.estimate <= ceiling) {
    const second = await enrolChainedRun(db, book.id, deps, { prompts, approvedUsd: first.estimate, submit: false });
    if (second.ok) return { lane: 'chained', run: second.run };
    return { lane: 'realtime', reason: second.reason };
  }
  return { lane: 'realtime', reason: first.reason };
}

const ENGLISH = /^(english|eng|en)$/i;        // orchestrator ENGLISH_VARIANTS_P4: modernisation is reader-triggered (#4958)
const CHINESE = /chinese|^zh(-|$)/i;

/**
 * Books the chained lane should pick up next, most wanted first. Mongo does the coarse cut; the
 * per-book checks that counters cannot answer (`zeroOnly`: no page translated, counted on PAGES)
 * run after. Every book returned carries its approval, pages × AUTO_APPROVAL_USD_PER_PAGE — the
 * enrol refuses a book whose own estimate is higher.
 *
 * Skips: held books, books with any open translate_batch_runs run, English, reader requests,
 * previews whose OCR is under 90% of the book (Chinese previews are the common case), unsplit
 * spreads, and, with `visibleOnly` (default), hidden books.
 *
 * `statuses` narrows AUTO_STATUSES. Under a scope ENVELOPE pass the terminal ones only
 * (`complete`, `images_complete`): an envelope is a permission on a set of BOOKS, and every worker
 * that asks the scoped gate may spend it on them — the first chained cohort's envelope paid
 * image extraction more than translation on its non-terminal books (2026-09-30).
 */
export async function selectAutoCandidates(db, { limit = 40, zeroOnly = false, minPages = 0, visibleOnly = true, excludeChinese = false, statuses = AUTO_STATUSES } = {}) {
  // Not picked: a book with an open run of any lane; one this lane PARKED (re-enrol by hand,
  // --chained --enrol, once the cause is known) other than for a hold (NOT_HELD below covers that); and one whose chained run ended in the last day —
  // a run takes at most MAX_PAGES_PER_RUN pages, so a longer book comes back for its next slice,
  // but what a run refused (unhealthy, recitation) must not take a slot every hour.
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const excludedBookIds = await db.collection(RUNS_COLLECTION).distinct('book_id', { $or: [
    { phase: { $nin: [...TERMINAL_PHASES, 'written', 'shadow_complete', 'failed'] } },
    { mode: MODE, phase: PHASE.PARKED, parked_for_hold: { $exists: false } },
    { mode: MODE, updated_at: { $gte: since } },
  ] });
  const match = {
    'pipeline_auto.status': { $in: statuses.filter((s) => AUTO_STATUSES.includes(s)) },
    ...NOT_HELD,
    id: { $nin: excludedBookIds },
    pages_ocr: { $gt: 0 },
    language: { $not: ENGLISH },
    processing_priority: { $not: { $gte: REALTIME_PRIORITY_FLOOR } },
    $or: [{ needs_splitting: { $ne: true } }, { split_completed: true }],
    ...(visibleOnly ? { visible: true } : {}),
    ...(minPages ? { pages_count: { $gt: minPages } } : {}),
  };
  if (excludeChinese) match.$and = [{ language: { $not: CHINESE } }];
  const rows = await db.collection('books').aggregate([
    { $match: match },
    { $addFields: { _denominator: { $subtract: [{ $ifNull: ['$pages_ocr', 0] }, { $ifNull: ['$pages_blank', 0] }] } } },
    { $match: {
      _denominator: { $gt: 0 },
      $expr: { $and: [
        { $lt: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, '$_denominator'] }, 0.9] },
        { $gte: ['$pages_ocr', { $multiply: [0.9, { $ifNull: ['$pages_count', 0] }] }] },
      ] },
    } },
    { $project: { id: 1, title: 1, language: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, processing_priority: 1, created_at: 1, 'pipeline_auto.status': 1 } },
    // Reader-wanted first, then books already under way (finishing one beats starting another).
    { $sort: { processing_priority: -1, pages_translated: -1, created_at: -1 } },
    { $limit: Math.max(limit * 4, limit + 20) },
  ]).toArray();

  const out = [];
  for (const b of rows) {
    if (out.length >= limit) break;
    if (zeroOnly) {
      const translated = await db.collection('pages').countDocuments({ book_id: b.id, 'translation.data': { $exists: true, $nin: [null, ''] } }, { limit: 1 });
      if (translated > 0) continue;
    }
    const owed = Math.max(1, Math.min(MAX_PAGES_PER_RUN, b.pages_ocr || 0));
    out.push({ ...b, approvedUsd: +(owed * AUTO_APPROVAL_USD_PER_PAGE).toFixed(4) });
  }
  return out;
}
