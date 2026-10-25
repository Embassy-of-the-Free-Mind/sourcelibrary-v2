// PRIOR ART: scripts/batch/realtime-ocr.mjs recordSkip() — the `ocr.last_skip` stamp this module writes, in the same
// shape (#4458). It is a local function in a script that runs main() on import, so no other writer can call it, and it
// has no human-edit guard and no clock guard. scripts/workers/batch-collector.mjs stamps `ocr.fail_count` /
// `fail_blocked` / `recitation_count`. Those fields are NOT reused here, because the orchestrator and the OCR selectors
// read them to stop sending a page (a routing change, out of scope for #7378). scripts/lib/ocr-loop-guard.mjs
// recordLoopRefusal() records a LOOP the guard refused as a page_revisions row, which the route census already counts as
// guard_refused. A loop is our guard refusing the output, not the engine failing to read, so it is not stamped here.
/**
 * recordFailedReads(): every OCR writer records a read that did not come back, in one shape (#7378).
 *
 * WHY. The route census (#6740, scripts/eval/estimator/ocr/route-census.mjs) found that only the two Gemini API writers
 * stamp a failed read. Paddle, Yigdzin, Kraken, NDL, the agy CLI lanes and the Claude lanes wrote nothing when a read
 * failed. So the estimator read their did-not-read rate as 0 of n, and the router priced those routes as if every call
 * returned a page. A missing stamp is not evidence that the route never fails.
 *
 * THE SHAPE (realtime-ocr's, with two optional fields added):
 *   ocr.last_skip = { reason, finish_reason, at, model, engine, detail }
 *     reason         one of FAILED_READ_REASONS:
 *                    refused (the engine declined: a refusal or summary in place of a transcription),
 *                    empty (the engine returned no text),
 *                    timeout (the call or the box ran out of time),
 *                    error (the engine call failed: non-zero exit, a crash, an .err file).
 *                    realtime-ocr also writes its older reasons (recitation, safety, max-tokens-no-text,
 *                    hallucination, no-image). The census reads both vocabularies.
 *     finish_reason  the engine's own word for it where it has one (Gemini finishReason, a CLI error class), else null
 *     at             WHEN THE READ FAILED (the .err file's mtime, the read's finished_at), not when it was stamped
 *     model          the id the lane writes to `ocr.model` on success. The census attributes the failure to this route,
 *                    so it must be that same id.
 *     engine         the writer (call site), e.g. 'scripts/workers/paddle-zh-lane.mjs'
 *     detail         up to 200 characters of the error or skip reason, or null
 *
 * WHAT IT NEVER DOES.
 *   - It never touches `ocr.data`, `ocr.model`, `ocr.source` or any field a selector or the orchestrator reads.
 *     `last_skip` is read only by the census, ia-ocr-cohort (reason 'recitation' only, which this module never
 *     writes) and reocr-ia-frontmatter's opt-in --skip-attempted-since. So a stamp changes no routing.
 *   - It never writes to a human-edited page (`ocr.source: 'manual'` or a non-empty `ocr.edited_by`, the predicate
 *     page-text-writer.mjs and the collectors use). The guard is in the update FILTER, so it also holds under a race.
 *   - It never writes over a legacy bare-string `ocr`. A dotted $set would fail on it, and a whole-field set would
 *     erase the text.
 *   - It never writes over a stamp at the same time or later (`ocr.last_skip.at` ≥ `at`). A rerun of an apply over the
 *     same files is a no-op, and an older failure never hides a newer one.
 *
 * Callers stamp only in their write mode (--apply). A dry run reports what it would stamp and writes nothing.
 */

export const FAILED_READ_REASONS = Object.freeze(['refused', 'empty', 'timeout', 'error']);
/** Older reasons realtime-ocr.mjs writes into the same field. Valid in the field, but not written by this module. */
export const LEGACY_SKIP_REASONS = Object.freeze(['recitation', 'safety', 'max-tokens-no-text', 'hallucination', 'no-image']);

const TIMEOUT = /time[ -]?d? ?out|timed out|ETIMEDOUT|ESOCKETTIMEDOUT|AbortError|deadline exceeded|SIGTERM|SIGKILL|wedged/i;

/** 'timeout' when an error's text says the call ran out of time, else 'error'. */
export function errorReason(err) {
  const s = typeof err === 'string' ? err : err?.message ?? String(err ?? '');
  return TIMEOUT.test(s) ? 'timeout' : 'error';
}

const clip = (s) => (s == null || s === '' ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, 200));
const asDate = (d) => {
  const t = d instanceof Date ? d : new Date(d ?? Date.now());
  return Number.isNaN(+t) ? new Date() : t;
};

/** The `ocr.last_skip` value. Throws on a malformed call: a writer that guesses is how the census gets lied to. */
export function failedReadStamp({ reason, model, engine = null, finishReason = null, detail = null, at } = {}) {
  if (!FAILED_READ_REASONS.includes(reason)) throw new Error(`failedReadStamp: reason must be one of ${FAILED_READ_REASONS.join(' / ')}, got ${JSON.stringify(reason)}`);
  if (typeof model !== 'string' || !model.trim()) throw new Error('failedReadStamp: model is required (the id the lane writes to ocr.model)');
  return { reason, finish_reason: finishReason ?? null, at: asDate(at), model, engine: engine ?? null, detail: clip(detail) };
}

/**
 * The filter: this page, not human-edited, `ocr` absent / null / an object (never a bare string), and no stamp
 * at or after this one.
 */
export function failedReadFilter(pageId, at) {
  return {
    id: pageId,
    'ocr.source': { $ne: 'manual' },
    'ocr.edited_by': { $in: [null, ''] },
    ocr: { $not: { $type: 'string' } },
    'ocr.last_skip.at': { $not: { $gte: asDate(at) } },
  };
}

/**
 * The update: a pipeline, so `ocr: null` becomes an object (a dotted $set cannot create a field inside null), then
 * the stamp. `$literal` keeps a `$` in the detail text from being read as an operator.
 */
export function failedReadUpdate(stamp) {
  return [
    { $set: { ocr: { $cond: [{ $eq: [{ $type: '$ocr' }, 'object'] }, '$ocr', {}] } } },
    { $set: { 'ocr.last_skip': { $literal: stamp } } },
  ];
}

/**
 * Stamp failed reads: rows = [{ pageId, reason, model, engine?, finishReason?, detail?, at? }].
 * Returns { stamped, matched, rows }. A row that fails validation throws before anything is written.
 * Best effort on the database side: a write error is logged and counted, never thrown, because a failed stamp
 * must not stop the lane that is writing real reads.
 */
export async function recordFailedReads(db, rows, { log = console.warn } = {}) {
  const ops = rows.filter((r) => r && r.pageId).map((r) => {
    const stamp = failedReadStamp(r);
    return { updateOne: { filter: failedReadFilter(r.pageId, stamp.at), update: failedReadUpdate(stamp) } };
  });
  if (!ops.length) return { stamped: 0, matched: 0, rows: 0 };
  try {
    const res = await db.collection('pages').bulkWrite(ops, { ordered: false });
    return { stamped: res.modifiedCount ?? 0, matched: res.matchedCount ?? 0, rows: ops.length };
  } catch (e) {
    log(`[ocr-failed-read] could not stamp ${ops.length} failed read(s): ${e?.message}`);
    return { stamped: 0, matched: 0, rows: ops.length, error: String(e?.message ?? e) };
  }
}

// ── Per-writer mappings: from what each lane already knows about a failed page to a stamp row (pure; tested). ──

/** A GPU box's `.err` file (Paddle zh / print, the guarded read's UNREAD): the error text decides timeout vs error. */
export function fromErrFile({ pageId, text, mtime, model, engine }) {
  return { pageId, reason: errorReason(text), model, engine, detail: text || 'error file', at: mtime };
}

/**
 * cli-ocr.mjs apply (agy and Claude reads): a read's meta and the skip it got → a row, or null when the skip is
 * not the engine failing to read (our own guards: loop, write guard, shared-words floor, human edit, …).
 */
export function fromCliRead(meta, skip, engine = 'scripts/batch/cli-ocr.mjs') {
  const base = { pageId: meta.page_id ?? null, model: meta.model, engine, finishReason: meta.error_class ?? null, at: meta.finished_at };
  if (!base.pageId || !meta.model) return null;
  switch (skip) {
    case 'exit': {
      const cls = String(meta.error_class ?? '');
      // claude-ocr.mjs records an image it could not fetch as exit 1: not the engine's failure, so not stamped
      if (/^image\b/i.test(cls)) return null;
      const reason = cls === 'timeout' || meta.exit === -9 ? 'timeout' : cls === 'empty' || cls === 'denied_tool' ? 'empty' : 'error';
      return { ...base, reason, detail: `exit ${meta.exit}${cls ? ` ${cls}` : ''}${meta.stderr_tail ? `: ${meta.stderr_tail}` : ''}` };
    }
    case 'empty': return { ...base, reason: 'empty', detail: 'empty read' };
    case 'refused': return { ...base, reason: 'refused', detail: 'refusal or summary in place of a transcription' };
    case 'wrapper': return { ...base, reason: 'refused', detail: `reply wrapper: ${meta.wrapper}` };
    default: return null;
  }
}

/** syriac-kraken-lane.mjs fail.jsonl rows of stage 'kraken' (a fetch failure is not the engine's and is not stamped). */
export function fromKrakenFail(row, { pageId, model, engine = 'scripts/workers/syriac-kraken-lane.mjs' }) {
  if (row?.stage !== 'kraken' || !pageId) return null;
  const timedOut = row.signal === 'SIGTERM' || row.signal === 'SIGKILL' || TIMEOUT.test(String(row.err ?? ''));
  return { pageId, reason: timedOut ? 'timeout' : 'error', model, engine, finishReason: row.signal ?? (row.rc != null ? `rc ${row.rc}` : null), detail: row.err || `rc ${row.rc}`, at: row.at };
}

/** A lane read that came back with no text (Paddle / NDL / Kraken "textless", Yigdzin "too short"). */
export function fromTextless({ pageId, model, engine, chars, at }) {
  return { pageId, reason: 'empty', model, engine, detail: `textless read (${chars ?? 0} characters)`, at };
}

/** A reply guard's flags (scripts/gpu/zh-guarded-read-6871/flash.py reply_flags) → a reason, or null for a fetch failure. */
export function reasonFromFlags(flags) {
  const s = (Array.isArray(flags) ? flags : [flags]).filter(Boolean).join(' ');
  if (/^(fetch|image|sha)/i.test(s)) return null;
  if (TIMEOUT.test(s)) return 'timeout';
  if (/refus|summary|cannot|unable|recitation/i.test(s)) return 'refused';
  if (/empty|no text|no reply|textless/i.test(s)) return 'empty';
  return 'error';
}

/**
 * paddle-zh-guarded-lane.mjs: a GPU record routed UNREAD by a Paddle error, or a Flash row the reply guard held after
 * both rounds. Null for a fetch failure, or for a Flash row still PENDING (a quota stop, not an answer).
 */
export function fromGuardedRead({ rec, flash, paddleModel, engine = 'scripts/workers/paddle-zh-guarded-lane.mjs', flashAt = null }) {
  if (rec?.route === 'UNREAD') {
    if (!/^paddle:/.test(String(rec.error ?? ''))) return null;
    return { pageId: rec.page_id, reason: errorReason(rec.error), model: paddleModel, engine, detail: rec.error, at: rec.at };
  }
  if (rec?.route === 'FLASH' && flash?.route === 'HOLD' && flash.model) {
    const reason = reasonFromFlags(flash.reply_flags);
    if (!reason) return null;
    return { pageId: rec.page_id, reason, model: flash.model, engine, finishReason: (flash.reply_flags || [])[0] ?? null,
      detail: `reply guard after ${flash.attempt ?? '?'} round(s): ${(flash.reply_flags || []).join(', ')}`, at: flash.date || flashAt };
  }
  return null;
}
