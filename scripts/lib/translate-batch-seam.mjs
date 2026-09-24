// PRIOR ART: scripts/eval/translation-batch-continuity-ab.mjs — arm Et (#4912/#4973) is the
// design this ships; its repair prompt and tail seed are PORTED here byte for byte (the eval
// file reads its arm from argv at import time and runs a CLI, so it cannot be imported by a
// worker). scripts/workers/translate-worker.mjs — the block partition, the block prompt and
// the response parse mirror its effectiveBatchSize / translateBatch (it runs main() on
// import, so it cannot be imported either). scripts/batch/retranslate-stale.mjs and
// scripts/workers/pipeline-orchestrator.mjs — the Batch API submit with key rotation on
// quota / FAILED_PRECONDITION; scripts/workers/batch-collector.mjs — the result shape
// (metadata.key, candidates[0].content.parts). None of them does a SECOND pass that reads the
// first pass's output, which is the whole point here. Writes go through translate-core's
// writePageTranslation (the one door, #3725); metering through supabase-usage-logger's
// placeholder + completeBatchUsage pair (#3452).
/**
 * translate-batch-seam — translation on the Gemini Batch API, with a seam-repair pass.
 *
 * WHY. Realtime translation chains: each block of 8 pages is sent with the end of the
 * previous block's fresh translation, so a sentence carried over the page break is picked up
 * correctly. The Batch API takes every request up front, so no request can contain another's
 * output. Measured in #4912 / #4973 (arm Et): translating every block unseeded and then
 * repairing ONLY the first page of each block against the previous block's last page
 * translation TIES chained production on a blind judge, at ≈58% of its cost. It is a tie, not
 * an improvement; against plain batch it is a clear improvement at the seam.
 *
 * SHAPE OF A RUN (one book, one document in `translate_batch_runs`):
 *
 *   plan ─► translate job (Batch API, one request per block, NO continuity seed)
 *        ─► repair job   (Batch API, one request per block boundary: page N's draft
 *                         translation + page N+1's source + page N+1's draft → revised N+1)
 *        ─► write        (every page through writePageTranslation; the seam page gets the
 *                         repaired text when it passes the health gate, else its draft)
 *
 * The repair rewrites page N+1 only — page N is context, exactly as measured. Both pages of a
 * pair are still written, through the same door, as ordinary members of their blocks.
 *
 * WHY NOT `batch_jobs`. The batch collector (scripts/workers/batch-collector.mjs) collects
 * EVERY pending `batch_jobs` row, whatever its type, and writes the pages itself. A translate
 * job parked there would be written unrepaired before this lane saw it. So runs live in their
 * own collection and nothing else reads it.
 *
 * Pure helpers are exported for tests; the run functions take every side effect (Gemini,
 * meter, writes) as an injected dependency so the unit tests can drive a whole run with no
 * network and no spend.
 */
import {
  translationPromptHeader,
  buildTranslationPrompt,
  sanitizeTranslationTags,
  assessTranslationHealth,
  isTranslatablePage,
  translatablePageFilter,
  writePageTranslation,
  syncBookTranslationCounters,
  getTranslateModelForBook,
  contentHash,
  SAFETY_SETTINGS,
} from './translate-core.mjs';
import { isHeld } from './pipeline-hold.mjs';
import { dropDriftedPages } from './block-drift.mjs';
import { sumBatchResponseUsage } from '../workers/lib/supabase-usage-logger.mjs';
import { costOf, BATCH_MULTIPLIER } from './model-pricing.mjs';

// ── Constants (mirrors of production where noted) ──────────────────────────
export const BLOCK_SIZE = 8;                  // translate-worker BATCH_SIZE
export const MAX_BLOCK_OCR_CHARS = 20000;     // translate-worker MAX_BATCH_OCR_CHARS
export const MIN_OCR_CHARS_FOR_BLOCK = 200;   // translate-worker MIN_OCR_CHARS_FOR_BATCH
export const SEAM_SEED_CHARS = 2000;          // the repair prompt's previous-page window (arm Et)
export const MAX_PAGES_PER_RUN = 300;         // retranslate-stale MAX_PAGES_PER_BATCH; keeps the run doc small
export const RUNS_COLLECTION = 'translate_batch_runs';
export const ENDPOINT = 'hetzner/translate-batch-seam';
export const REPAIR_PROMPT_VERSION = 'seam-repair-e2-tail'; // the label arm Et was metered under
export const REVISION_NOTE = 'translate-batch-seam';

/** Run phases. Terminal: written, shadow_complete, failed. */
export const PHASE = Object.freeze({
  TRANSLATE_SUBMITTED: 'translate_submitted',
  REPAIR_SUBMITTED: 'repair_submitted',
  READY_TO_WRITE: 'ready_to_write',
  WRITTEN: 'written',
  SHADOW_COMPLETE: 'shadow_complete',
  FAILED: 'failed',
});
export const TERMINAL_PHASES = [PHASE.WRITTEN, PHASE.SHADOW_COMPLETE, PHASE.FAILED];

const DONE_STATES = new Set(['JOB_STATE_SUCCEEDED']);
const DEAD_STATES = new Set(['JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED']);

// ── Planning ───────────────────────────────────────────────────────────────

/**
 * Partition pages (already in page order) into blocks exactly as the realtime worker
 * does: up to BLOCK_SIZE pages, ended early by a page under MIN_OCR_CHARS_FOR_BLOCK or by
 * the block passing MAX_BLOCK_OCR_CHARS; a short first page is a block of one.
 */
export function planBlocks(pages, { blockSize = BLOCK_SIZE } = {}) {
  const blocks = [];
  let i = 0;
  while (i < pages.length) {
    const rest = pages.slice(i);
    let size = 0;
    if (blockSize > 1 && (rest[0].ocr?.data || '').length >= MIN_OCR_CHARS_FOR_BLOCK) {
      let chars = 0;
      for (let j = 0; j < Math.min(rest.length, blockSize); j++) {
        const len = (rest[j].ocr?.data || '').length;
        if (len < MIN_OCR_CHARS_FOR_BLOCK) break;
        chars += len;
        if (chars > MAX_BLOCK_OCR_CHARS) break;
        size++;
      }
    }
    size = Math.max(1, size);
    blocks.push(rest.slice(0, size));
    i += size;
  }
  return blocks;
}

/** translate-worker maxOutputTokensFor (#3826): cap generation so a loop stops billing early. */
export function maxOutputTokensFor(pages) {
  const ocrChars = pages.reduce((n, p) => n + (p.ocr?.data || '').length, 0);
  return Math.min(32768, Math.max(4096, Math.ceil(ocrChars) + 1200 * pages.length));
}

/**
 * The block prompt with NO continuity seed. A block of one uses the single-page prompt
 * (buildTranslationPrompt without a previous translation), as the realtime worker does; a
 * longer block uses the worker's multi-page wording byte for byte.
 */
export function blockPrompt({ prompts, book, pages }) {
  if (pages.length === 1) {
    const { prompt, promptRef, isEnglish } = buildTranslationPrompt({ prompts, book, ocrText: pages[0].ocr.data });
    return { prompt, promptRef, isEnglish };
  }
  const { prompt: header, promptRef, isEnglish } = translationPromptHeader({ prompts, book });
  let prompt = header;
  const verb = isEnglish ? 'modernize' : 'translate';
  prompt += `\n\n**IMPORTANT: You will receive ${pages.length} consecutive pages. ${isEnglish ? 'Modernize' : 'Translate'} each one separately. Wrap each translation in XML tags with the page number:**\n`;
  prompt += `\`\`\`\n${pages.map(p => `<translation page="${p.page_number}">...${verb}d text...</translation>`).join('\n')}\n\`\`\`\n`;
  prompt += `\n**Pages to ${verb}:**\n`;
  for (const p of pages) prompt += `\n--- Page ${p.page_number} ---\n${p.ocr.data}\n`;
  return { prompt, promptRef, isEnglish };
}

/**
 * Parse one block's response into Map<page_number, text>. Mirrors translate-worker
 * translateBatch: the 15%-of-OCR reject for a misparsed/truncated page and the positional
 * fallback when the model renumbers pages, and the #5021 drift reject (block-drift.mjs): a
 * boundary whose opening clause landed on the previous page drops both its pages. A block of
 * one takes the whole response.
 */
export function parseBlockResponse(responseText, pages, { onDrift } = {}) {
  const out = new Map();
  if (!responseText) return out;
  if (pages.length === 1) {
    const text = sanitizeTranslationTags(String(responseText).trim());
    if (text) out.set(pages[0].page_number, text);
    return out;
  }
  const tooShort = (p, text) => !!p && (p.ocr?.data || '').length > 100 && text.length < (p.ocr?.data || '').length * 0.15;
  const re = /<translation\s+page="(\d+)">([\s\S]*?)<\/translation>/g;
  const entries = [];
  let m;
  while ((m = re.exec(responseText)) !== null) {
    const n = parseInt(m[1], 10);
    const text = sanitizeTranslationTags(m[2].trim());
    if (tooShort(pages.find(p => p.page_number === n), text)) continue;
    out.set(n, text);
    entries.push(text);
  }
  if (entries.length === pages.length && entries.length > 0
      && pages.filter(p => out.has(p.page_number)).length < pages.length) {
    out.clear();
    pages.forEach((p, i) => { if (!tooShort(p, entries[i])) out.set(p.page_number, entries[i]); });
  }
  // A clause moved across an in-block page break (#5021): both pages of the boundary are left
  // undrafted, so they are not written from this block and go back to the queue.
  const { drifted } = dropDriftedPages(pages, out);
  if (drifted.length && onDrift) onDrift(drifted);
  return out;
}

// ── The seam repair (arm Et, #4973) ────────────────────────────────────────

/** The END of the previous page's translation, editorial blocks stripped, '...' in front. */
export function seamSeed(prevTranslation) {
  const body = String(prevTranslation || '').replace(/<(meta|summary|keywords|vocab|warning)(?:\s[^>]*)?>[\s\S]*?<\/\1>/gi, '').trim();
  return body.length > SEAM_SEED_CHARS ? `...${body.slice(-SEAM_SEED_CHARS)}` : body;
}

/**
 * Arm Et's prompt, byte for byte (seamRepairPrompt with --tail in the eval harness). Changing
 * a word here changes the thing that was judged — re-run the #4912 judge if you do.
 */
export function seamRepairPrompt({ book, prevTranslation, ocr, draft }) {
  return `You are revising one page of an English translation of a ${book.language || 'Latin'} book so that it continues seamlessly from the page before it. The page was translated without sight of the previous page.

Change ONLY what continuity requires: a sentence carried over the page break that was picked up wrongly, a name or technical term rendered differently from the previous page, a formatting convention (headers, notes, markup) that differs from the previous page. Change NOTHING else. Do not improve, shorten or expand the translation. Do not add anything that is not in the source text. Keep all markup tags exactly as they are. If nothing needs changing, return the page unchanged.

Return the full revised page and nothing else.

**Previous page translation (its end):**
${seamSeed(prevTranslation)}

**Source text of this page:**
${ocr}

**Translation of this page, to revise:**
${draft}`;
}

/** The repair response as the eval kept it: code fences off, tags closed. */
export function cleanRepairResponse(text) {
  if (!text) return '';
  return sanitizeTranslationTags(String(text).replace(/^```[a-z]*\n?|```\s*$/g, '').trim());
}

/**
 * The block boundaries to repair: (last page of block k-1, first page of block k) for every
 * k ≥ 1 where BOTH drafts came back. A boundary with a missing draft has nothing to repair
 * against (or nothing to repair) and is left to its draft — recorded, not dropped.
 */
export function seamPairs(blocks, drafts) {
  const pairs = [];
  const skipped = [];
  for (let k = 1; k < blocks.length; k++) {
    const prev = blocks[k - 1][blocks[k - 1].length - 1];
    const seam = blocks[k][0];
    if (drafts.has(prev.id) && drafts.has(seam.id)) pairs.push({ prevId: prev.id, seamId: seam.id });
    else skipped.push({ prevId: prev.id, seamId: seam.id, reason: drafts.has(seam.id) ? 'prev-draft-missing' : 'seam-draft-missing' });
  }
  return { pairs, skipped };
}

/**
 * What goes on the seam page: the repair when there is one and it passes the same health
 * gate the write door applies, otherwise the draft. A bad repair never costs the page its
 * translation.
 */
export function chooseSeamText({ ocr, draft, repaired }) {
  if (!repaired) return { text: draft, source: 'draft', reason: 'repair-missing' };
  const health = assessTranslationHealth(ocr, repaired);
  if (!health.healthy) return { text: draft, source: 'draft', reason: `repair-${health.reason}` };
  return { text: repaired, source: 'repair', reason: repaired === draft ? 'repair-unchanged' : 'repair-changed' };
}

// ── Batch API response helpers ─────────────────────────────────────────────

/**
 * Text of one batch response (all parts joined), plus its finish reason — and its per-request
 * ERROR. A Batch job can reach JOB_STATE_SUCCEEDED with every request inside it failed
 * (`{ metadata, error: { code, message } }` in place of `response`): the first live run
 * (2026-09-24, #4681) got 3 jobs × "The operation was cancelled." that way, and a reader of
 * `response` alone saw empty text, parsed nothing, and called the run complete.
 */
export function responseTextOf(r) {
  const cand = r?.response?.candidates?.[0];
  const text = (cand?.content?.parts || []).map(p => p?.text || '').join('');
  const error = r?.error ? `${r.error.code ?? ''} ${r.error.message ?? JSON.stringify(r.error)}`.trim() : null;
  return { key: r?.metadata?.key ?? r?.key ?? null, text, finishReason: cand?.finishReason || null, error };
}

/** One line for a run's failure record: how many requests errored and the commonest message. */
export function summarizeResponseErrors(responses) {
  const errors = (responses || []).map(responseTextOf).filter(t => t.error);
  if (!errors.length) return null;
  const counts = new Map();
  for (const e of errors) counts.set(e.error, (counts.get(e.error) || 0) + 1);
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return { errored: errors.length, of: (responses || []).length, top: `${top} (×${n})` };
}

/** One Batch API request in the SDK's inline shape. thinkingBudget: 0 is mandatory (#4581) — never remove it. */
export function batchRequest({ key, prompt, maxOutputTokens }) {
  return {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      safetySettings: SAFETY_SETTINGS,
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
    metadata: { key },
  };
}

/**
 * The same request as one line of a Batch API input FILE (JSONL, REST shape): `config` becomes
 * `generationConfig` with `safetySettings` beside it, `metadata.key` stays where the result line
 * will echo it. File-based input is how the OCR orchestrator submits to the Lite model — its
 * comment records 300 inline Lite jobs stuck against 1,995 file-based successes — and on
 * 2026-09-24 this lane's inline Lite jobs were cancelled about every second job while the
 * file-based OCR lane had a normal day.
 */
export function batchRequestToJsonlLine(req) {
  const { safetySettings, ...generationConfig } = req.config || {};
  return {
    request: {
      contents: req.contents,
      ...(safetySettings ? { safetySettings } : {}),
      generationConfig,
    },
    metadata: req.metadata,
  };
}

// ── Cost estimate (printed before any submit; the operator approves a ceiling) ──

/**
 * Conservative batch-price estimate for a planned run: input ≈ prompt chars / 3.5 tokens,
 * output ≈ OCR chars / 2.5 tokens (translations run longer than their source once notes are
 * added), repair pass priced from its real shape (previous-page seed + seam source + seam
 * draft ≈ 3 pages of text in, one page out, per boundary).
 */
export function estimateRunUsd({ prompts, book, blocks, model }) {
  let inChars = 0, outChars = 0, repairIn = 0, repairOut = 0;
  blocks.forEach((pages, k) => {
    inChars += blockPrompt({ prompts, book, pages }).prompt.length;
    outChars += pages.reduce((n, p) => n + (p.ocr?.data || '').length, 0);
    if (k > 0) {
      const seamLen = (pages[0].ocr?.data || '').length;
      repairIn += 1500 + SEAM_SEED_CHARS + 2 * seamLen;
      repairOut += seamLen;
    }
  });
  const translate = costOf(model, inChars / 3.5, outChars / 2.5) * BATCH_MULTIPLIER;
  const repair = costOf(model, repairIn / 3.5, repairOut / 2.5) * BATCH_MULTIPLIER;
  return { translate_usd: +translate.toFixed(4), repair_usd: +repair.toFixed(4), total_usd: +(translate + repair).toFixed(4) };
}

// ── Page selection ─────────────────────────────────────────────────────────

/**
 * The pages the realtime worker would translate for this book, in order: the canonical
 * translatable filter, no translation yet, not health-blocked, and every page re-checked
 * with isTranslatablePage (blank-from-OCR, empty body, looping source #4850).
 */
export async function selectPages(db, bookId, { limit = MAX_PAGES_PER_RUN } = {}) {
  const docs = await db.collection('pages').find({
    book_id: bookId,
    ...translatablePageFilter(),
    'translation.health_blocked': { $exists: false },
    $or: [
      { 'translation.data': { $exists: false } },
      { 'translation.data': null },
      { 'translation.data': '' },
    ],
  }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } })
    .sort({ page_number: 1 }).toArray();
  const pages = [];
  const excluded = {};
  for (const p of docs) {
    const v = isTranslatablePage(p);
    if (!v.ok) { excluded[v.reason] = (excluded[v.reason] || 0) + 1; continue; }
    pages.push(p);
    if (pages.length >= limit) break;
  }
  return { pages, excluded };
}

// ── Run lifecycle ──────────────────────────────────────────────────────────
//
// deps = {
//   gemini:  { submit({ model, requests, displayName }) → { name, keyIndex },
//              fetch(name) → { state, responses } },
//   logUsage(params, db), completeBatchUsage(params, db),   // supabase-usage-logger
//   budgetAllows(db, label) → boolean,                     // spend-guard (see gateAllowsBook)
//   writePage?  (defaults to translate-core writePageTranslation),
//   syncPage?   (Supabase dual-write, optional),
//   log?        (defaults to console.log),
//   now?        () → Date
// }

/**
 * Does a scoped spend-guard verdict (`budgetAllowsDispatchScoped`) let THIS book run?
 * Same rule the realtime translate-worker applies to its candidates: the global dial open
 * covers every book; the global dial closed covers only the books inside an OPEN scope
 * envelope (#4540). A boolean gate (`budgetAllowsDispatch`) cannot see envelopes, which is
 * why the first shadow runs (2026-09-24) were refused on a day the realtime lane was
 * dispatching envelope work.
 */
export function gateAllowsBook(gate, bookId) {
  if (!gate?.allowed) return false;
  if (gate.envelopeIds == null) return true;
  return gate.envelopeIds.has(bookId);
}

const newRunId = () => `tbs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function meterPlaceholder(deps, db, { run, jobName, pageCount, kind }) {
  return deps.logUsage({
    type: 'translation', mode: 'batch', model: run.model,
    book_id: run.book_id, page_count: pageCount,
    input_tokens: 0, output_tokens: 0, status: 'submitted',
    batch_job_id: jobName, endpoint: `${ENDPOINT}/${kind}`,
    prompt_version: kind === 'repair' ? REPAIR_PROMPT_VERSION : String(run.prompt_ref?.version ?? ''),
    triggered_by: 'manual',
  }, db);
}

function meterComplete(deps, db, { run, jobName, pageCount, kind, responses, status = 'success', error }) {
  // Per RESPONSE, thinking included (#3452, #4581): a discarded response was billed too.
  const { inputTokens, outputTokens } = sumBatchResponseUsage(responses);
  return deps.completeBatchUsage({
    type: 'translation', mode: 'batch', model: run.model,
    book_id: run.book_id, page_count: pageCount,
    input_tokens: inputTokens, output_tokens: outputTokens,
    status, ...(error ? { error_message: error } : {}),
    batch_job_id: jobName, endpoint: `${ENDPOINT}/${kind}`,
    prompt_version: kind === 'repair' ? REPAIR_PROMPT_VERSION : String(run.prompt_ref?.version ?? ''),
    triggered_by: 'manual',
    // A job that died with no responses billed nothing; do not invent a $0 row.
    ...(responses?.length ? {} : { insertIfMissing: false }),
  }, db);
}

/**
 * Plan a run for one book without touching Gemini: the blocks, the seams, the refusals.
 * Returns { ok, reason?, book, pages, blocks, excluded, model }.
 */
export async function planRun(db, bookId, { limit = MAX_PAGES_PER_RUN } = {}) {
  const book = await db.collection('books').findOne({ id: bookId });
  if (!book) return { ok: false, reason: 'book-not-found' };
  if (isHeld(book)) return { ok: false, reason: `book-held (${book.pipeline_auto.hold.reason})`, book };
  // The realtime lane owns a book in translate_submitted; running both would pay twice.
  if (book.pipeline_auto?.status === 'translate_submitted') return { ok: false, reason: 'realtime-lane-owns-book (pipeline_auto.status=translate_submitted)', book };
  const open = await db.collection(RUNS_COLLECTION).findOne({ book_id: bookId, phase: { $nin: TERMINAL_PHASES } });
  if (open) return { ok: false, reason: `open-run ${open.id} (${open.phase})`, book };
  const { pages, excluded } = await selectPages(db, bookId, { limit });
  if (pages.length === 0) return { ok: false, reason: 'nothing-to-translate', book, excluded };
  const blocks = planBlocks(pages);
  return { ok: true, book, pages, blocks, excluded, model: getTranslateModelForBook(book) };
}

/**
 * Submit the translate job for one book and record the run. Refuses (returns { ok:false }),
 * sending nothing to Gemini, on any planRun refusal, when the estimate exceeds the operator's
 * `approvedUsd`, or when the spend dial is closed.
 */
export async function startRun(db, bookId, deps, { prompts, approvedUsd, shadow = false, limit } = {}) {
  const log = deps.log || console.log;
  const plan = await planRun(db, bookId, { limit });
  if (!plan.ok) return plan;
  const { book, blocks, model } = plan;
  const estimate = estimateRunUsd({ prompts, book, blocks, model });
  if (!(Number(approvedUsd) >= estimate.total_usd)) {
    return { ok: false, reason: `estimate $${estimate.total_usd} exceeds approved $${approvedUsd ?? 0}`, book, estimate };
  }
  if (!(await deps.budgetAllows(db, `translate-batch-seam ${bookId}`))) return { ok: false, reason: 'spend-dial-closed', book, estimate };

  let promptRef = null;
  const requests = blocks.map((pages, k) => {
    const built = blockPrompt({ prompts, book, pages });
    promptRef = built.promptRef;
    return batchRequest({ key: `b${k}`, prompt: built.prompt, maxOutputTokens: maxOutputTokensFor(pages) });
  });
  const runId = newRunId();
  const job = await deps.gemini.submit({ model, requests, displayName: `tbs-translate-${bookId}-${runId}` });
  const now = deps.now ? deps.now() : new Date();
  const run = {
    id: runId,
    book_id: bookId,
    model,
    shadow: !!shadow,
    phase: PHASE.TRANSLATE_SUBMITTED,
    prompt_ref: promptRef,
    blocks: blocks.map((pages, k) => ({
      key: `b${k}`,
      pages: pages.map(p => ({ id: p.id, page_number: p.page_number, ocr_hash: contentHash(p.ocr.data) })),
    })),
    page_count: plan.pages.length,
    excluded: plan.excluded,
    estimate,
    approved_usd: Number(approvedUsd),
    translate_job: { name: job.name, key_index: job.keyIndex, submitted_at: now },
    created_at: now,
    updated_at: now,
  };
  await db.collection(RUNS_COLLECTION).insertOne(run);
  await meterPlaceholder(deps, db, { run, jobName: job.name, pageCount: plan.pages.length, kind: 'translate' });
  log(`[translate-batch-seam] ${bookId}: run ${runId} — ${plan.pages.length} pages in ${blocks.length} blocks → ${job.name}${shadow ? ' (SHADOW: pages will not be written)' : ''}`);
  return { ok: true, run };
}

async function setPhase(db, run, phase, set = {}, deps) {
  const now = deps.now ? deps.now() : new Date();
  await db.collection(RUNS_COLLECTION).updateOne({ id: run.id }, { $set: { phase, ...set, updated_at: now } });
  Object.assign(run, { phase, ...set, updated_at: now });
}

/** Load page docs for the run's pages, keyed by id, with the fields the prompts and guards need. */
async function loadPages(db, run) {
  const ids = run.blocks.flatMap(b => b.pages.map(p => p.id));
  const docs = await db.collection('pages').find({ id: { $in: ids } },
    { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, translation: 1 } }).toArray();
  return new Map(docs.map(d => [d.id, d]));
}

/**
 * Move a run one step forward if its current Batch job has finished. Idempotent: calling it
 * on a run whose job is still running does nothing and says so.
 * Returns { phase, advanced, note }.
 */
export async function advanceRun(db, run, deps) {
  const log = deps.log || console.log;

  if (run.phase === PHASE.TRANSLATE_SUBMITTED) {
    const { state, responses } = await deps.gemini.fetch(run.translate_job.name);
    if (DEAD_STATES.has(state)) {
      await meterComplete(deps, db, { run, jobName: run.translate_job.name, pageCount: run.page_count, kind: 'translate', responses, status: 'failed', error: state });
      await setPhase(db, run, PHASE.FAILED, { failure: `translate job ${state}` }, deps);
      return { phase: run.phase, advanced: true, note: state };
    }
    if (!DONE_STATES.has(state)) return { phase: run.phase, advanced: false, note: state };

    const pageDocs = await loadPages(db, run);
    const byKey = new Map((responses || []).map(r => { const t = responseTextOf(r); return [t.key, t]; }));
    const drafts = new Map();
    const blockNotes = [];
    for (const b of run.blocks) {
      const pages = b.pages.map(p => pageDocs.get(p.id)).filter(Boolean);
      const r = byKey.get(b.key);
      let drifted = null;
      const parsed = r?.error ? new Map() : parseBlockResponse(r?.text, pages, { onDrift: (d) => { drifted = d; } });
      for (const p of pages) if (parsed.has(p.page_number)) drafts.set(p.id, parsed.get(p.page_number));
      if (!r) blockNotes.push({ key: b.key, note: 'no-response' });
      else if (r.error) blockNotes.push({ key: b.key, note: 'request-error', error: r.error });
      else if (parsed.size < pages.length) blockNotes.push({ key: b.key, note: `parsed ${parsed.size}/${pages.length}`, finish_reason: r.finishReason, ...(drifted ? { drifted } : {}) });
    }
    // A SUCCEEDED job is a statement about the job, not about its requests. Every request can
    // come back as an error (2026-09-24: 3 jobs × "The operation was cancelled."), and a run
    // that then marks itself ready/complete with zero drafts reports success for a lane that
    // produced nothing. No draft at all is a FAILED run with the reason on it; some drafts
    // missing is a partial run, recorded per block and on the meter row.
    const responseErrors = summarizeResponseErrors(responses);
    const errorNote = responseErrors ? `${responseErrors.errored}/${responseErrors.of} requests errored — ${responseErrors.top}` : null;
    if (drafts.size === 0) {
      const failure = `translate job returned no drafts: ${errorNote || `${(responses || []).length} responses, none parsed`}`;
      await meterComplete(deps, db, { run, jobName: run.translate_job.name, pageCount: run.page_count, kind: 'translate', responses, status: 'failed', error: failure });
      await setPhase(db, run, PHASE.FAILED, { failure, block_notes: blockNotes, response_errors: responseErrors }, deps);
      log(`[translate-batch-seam] ${run.book_id}: FAILED — ${failure}`);
      return { phase: run.phase, advanced: true, note: failure };
    }
    await meterComplete(deps, db, {
      run, jobName: run.translate_job.name, pageCount: run.page_count, kind: 'translate', responses,
      ...(errorNote ? { status: 'partial', error: errorNote } : {}),
    });
    // A page deleted since submit has no source to show the repair; its boundary keeps its draft.
    const present = new Map([...drafts].filter(([id]) => pageDocs.has(id)));
    const { pairs, skipped } = seamPairs(run.blocks.map(b => b.pages), present);
    const draftRows = [...drafts].map(([id, text]) => ({ id, text }));
    log(`[translate-batch-seam] ${run.book_id}: translate job done — ${drafts.size}/${run.page_count} drafts, ${pairs.length} seams to repair`);

    if (pairs.length === 0) {
      await setPhase(db, run, PHASE.READY_TO_WRITE, { drafts: draftRows, block_notes: blockNotes, seams: [], seams_skipped: skipped, repairs: [] }, deps);
      return { phase: run.phase, advanced: true, note: 'no seams' };
    }
    const book = await db.collection('books').findOne({ id: run.book_id });
    const requests = pairs.map(({ prevId, seamId }) => {
      const seam = pageDocs.get(seamId);
      const prompt = seamRepairPrompt({ book, prevTranslation: drafts.get(prevId), ocr: seam.ocr.data, draft: drafts.get(seamId) });
      return batchRequest({ key: seamId, prompt, maxOutputTokens: maxOutputTokensFor([seam]) });
    });
    const job = await deps.gemini.submit({ model: run.model, requests, displayName: `tbs-repair-${run.book_id}-${run.id}` });
    await setPhase(db, run, PHASE.REPAIR_SUBMITTED, {
      drafts: draftRows, block_notes: blockNotes, seams: pairs, seams_skipped: skipped,
      repair_job: { name: job.name, key_index: job.keyIndex, submitted_at: deps.now ? deps.now() : new Date() },
    }, deps);
    await meterPlaceholder(deps, db, { run, jobName: job.name, pageCount: pairs.length, kind: 'repair' });
    return { phase: run.phase, advanced: true, note: `repair job ${job.name}` };
  }

  if (run.phase === PHASE.REPAIR_SUBMITTED) {
    const { state, responses } = await deps.gemini.fetch(run.repair_job.name);
    if (DEAD_STATES.has(state)) {
      // The drafts are still good; a dead repair job costs the seams their repair, not the book its translation.
      await meterComplete(deps, db, { run, jobName: run.repair_job.name, pageCount: run.seams.length, kind: 'repair', responses, status: 'failed', error: state });
      await setPhase(db, run, PHASE.READY_TO_WRITE, { repairs: [], repair_failure: state }, deps);
      return { phase: run.phase, advanced: true, note: `repair job ${state} — writing drafts` };
    }
    if (!DONE_STATES.has(state)) return { phase: run.phase, advanced: false, note: state };
    const parsed = (responses || []).map(responseTextOf).filter(t => t.key && run.seams.some(s => s.seamId === t.key));
    const repairs = parsed.filter(t => !t.error)
      .map(t => ({ id: t.key, text: cleanRepairResponse(t.text), finish_reason: t.finishReason }));
    // An errored repair request costs that seam its repair (chooseSeamText falls back to the
    // draft); it is recorded here so a run of all-errored repairs does not read as "0 repairs
    // chosen" for no visible reason.
    const repairErrors = summarizeResponseErrors(responses);
    const errorNote = repairErrors ? `${repairErrors.errored}/${repairErrors.of} repair requests errored — ${repairErrors.top}` : null;
    await meterComplete(deps, db, {
      run, jobName: run.repair_job.name, pageCount: run.seams.length, kind: 'repair', responses,
      ...(errorNote ? { status: repairs.length ? 'partial' : 'failed', error: errorNote } : {}),
    });
    await setPhase(db, run, PHASE.READY_TO_WRITE, { repairs, ...(errorNote ? { repair_failure: errorNote, repair_errors: repairErrors } : {}) }, deps);
    return { phase: run.phase, advanced: true, note: `${repairs.length}/${run.seams.length} repairs back${errorNote ? ` (${errorNote})` : ''}` };
  }

  if (run.phase === PHASE.READY_TO_WRITE) {
    const result = await writeRun(db, run, deps);
    return { phase: run.phase, advanced: true, note: JSON.stringify(result.counts) };
  }

  return { phase: run.phase, advanced: false, note: 'terminal' };
}

/**
 * Write every page of a finished run through translate-core's door. Per page, in order:
 *   - the OCR it was translated from must still be the OCR on the page (a Batch job can take
 *     a day; a re-OCR in between makes the translation a translation of something else),
 *   - the page must still have no translation (the realtime lane or a human may have
 *     written one meanwhile — never overwrite that with a batch result),
 *   - the page must still pass isTranslatablePage (loop guard #4850, empty body #4960, …),
 *   - then writePageTranslation with refuseUnhealthy (health gate #3756, refused text kept
 *     as evidence #3826), which also enforces the human-edit guard, snapshots a revision
 *     first, and clears the stale-translation marker.
 * A shadow run stops before any of this and keeps its texts on the run document only.
 */
export async function writeRun(db, run, deps) {
  const log = deps.log || console.log;
  const writePage = deps.writePage || writePageTranslation;
  const drafts = new Map((run.drafts || []).map(d => [d.id, d.text]));
  const repairs = new Map((run.repairs || []).map(r => [r.id, r.text]));
  const seamIds = new Set((run.seams || []).map(s => s.seamId));
  const counts = { written: 0, repaired: 0, repair_rejected: 0, no_draft: 0, ocr_changed: 0, already_translated: 0, not_translatable: 0, unhealthy: 0, protected: 0 };
  const seamOutcomes = [];

  const pageDocs = await loadPages(db, run);
  if (run.shadow) {
    for (const id of seamIds) {
      const choice = chooseSeamText({ ocr: pageDocs.get(id)?.ocr?.data, draft: drafts.get(id), repaired: repairs.get(id) });
      seamOutcomes.push({ id, source: choice.source, reason: choice.reason });
    }
    await setPhase(db, run, PHASE.SHADOW_COMPLETE, { seam_outcomes: seamOutcomes }, deps);
    log(`[translate-batch-seam] ${run.book_id}: SHADOW run complete — ${drafts.size} drafts, ${repairs.size} repairs kept on run ${run.id}; nothing written to pages`);
    return { counts, seamOutcomes };
  }

  const book = await db.collection('books').findOne({ id: run.book_id });
  const promptRef = run.prompt_ref;
  for (const b of run.blocks) {
    for (const ref of b.pages) {
      const page = pageDocs.get(ref.id);
      const draft = drafts.get(ref.id);
      if (!page || !draft) { counts.no_draft++; continue; }
      if (contentHash(page.ocr?.data || '') !== ref.ocr_hash) { counts.ocr_changed++; continue; }
      if (page.translation?.data) { counts.already_translated++; continue; }
      if (!isTranslatablePage(page).ok) { counts.not_translatable++; continue; }

      let text = draft;
      if (seamIds.has(ref.id)) {
        const choice = chooseSeamText({ ocr: page.ocr.data, draft, repaired: repairs.get(ref.id) });
        text = choice.text;
        seamOutcomes.push({ id: ref.id, source: choice.source, reason: choice.reason });
        if (choice.source === 'repair') counts.repaired++;
        else if (repairs.get(ref.id)) counts.repair_rejected++;
      }
      const res = await writePage(db, {
        page, book, text, promptRef, model: run.model,
        jobId: run.id, note: REVISION_NOTE, refuseUnhealthy: true,
      });
      if (res.written) {
        counts.written++;
        if (deps.syncPage) deps.syncPage(page.id, { translation: { data: res.text, language: 'English', model: run.model, source: 'ai', prompt_version: String(promptRef?.version ?? ''), prompt_id: promptRef?.id, prompt_hash: promptRef?.content_hash, prompt_name: promptRef?.name, updated_at: new Date() } });
      } else if (res.unhealthy) {
        counts.unhealthy++;
        // Same stamp the realtime worker puts on a refused page, so the page leaves the queue.
        await db.collection('pages').updateOne({ id: page.id }, { $set: { 'translation.health_blocked': res.reason, 'translation.health_blocked_at': new Date(), updated_at: new Date() } });
      } else if (res.protected) counts.protected++;
    }
  }
  if (counts.written > 0) await syncBookTranslationCounters(db, run.book_id);
  await setPhase(db, run, PHASE.WRITTEN, { write_counts: counts, seam_outcomes: seamOutcomes }, deps);
  log(`[translate-batch-seam] ${run.book_id}: wrote ${counts.written} pages (${counts.repaired} seams repaired) — ${JSON.stringify(counts)}`);
  return { counts, seamOutcomes };
}
