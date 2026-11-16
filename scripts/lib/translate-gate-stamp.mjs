// PRIOR ART: scripts/lib/pre-translation-gate.mjs — stamps `translation.health_blocked` + `translation.refusal_reason` +
// `translation.refusal` for its own structural/image rules and releases its stamps when a page passes again; the stamp
// shape and the release pattern are copied from it, but it never records the pre-flight reasons below.
// scripts/lib/translate-core.mjs `isTranslatablePage` — the pre-flight door this records; it decides per call and
// writes nothing, so a page it turns away is asked again every run and is owed forever (#378).
/**
 * translate-gate-stamp — record the translator's own pre-flight refusals on the page (#378).
 *
 * `isTranslatablePage` turns a page away before any call when its OCR has no body, is a blank-page read, loops, is
 * marked unreadable, or (with the illegible gate on) reads as illegible. Nothing was written when it did, so the
 * page stayed in `pages_translatable`: owed, never paid, and its book never reached `complete`. Measured 2026-11-15
 * over the 5,717 books the finish lane serves: 7,528 such pages (4,557 looped OCR, 2,969 no body), against 90 pages of
 * ordinary text still owed.
 *
 * THE RULE (page-counts.mjs isHealthBlocked): a stamped page leaves the denominator.
 *   NOTHING OWED   no-body, blank-ocr: there is nothing on the page to translate.
 *   REPAIR ITEM    ocr-loop, ocr-unreadable, illegible-source: the OCR needs a re-read; the page is listed (a query on
 *                  `translation.health_blocked: 'translate_gate'` by `translation.refusal.kind`), not a block on its book.
 *
 * RECORDED: `translation.health_blocked` = TRANSLATE_GATE_BLOCK, `_at`, `translation.refusal_reason` (the gate's reason)
 * and `translation.refusal` ({ reason, kind, gate, ocr_chars, ocr_updated_at, lane, at }). Only a page with no
 * translation text and no other health_blocked reason is stamped. Nothing else on the page changes.
 * REVERSIBLE: the stamp holds only for the OCR it judged. `refusal.ocr_chars` is that text's length in code points;
 * once the OCR changes, page-counts counts the page as owed again at once (isHealthBlocked), and
 * releaseStaleGateStamps (pages re-read since the finish lane's last run, by the `ocr.updated_at` index) re-judges it on the new text: released when it now passes (back in every selector), stamped
 * afresh when it is still refused. `--undo` on the backfill script unsets the stamps of one run.
 */
import { isTranslatablePage } from './translate-core.mjs';
import { TRANSLATE_GATE_BLOCK, codePointLength } from './page-counts.mjs';

/** The `translation.health_blocked` value this gate stamps (pre-translation-gate.mjs stamps its own). Owned by page-counts. */
export { TRANSLATE_GATE_BLOCK };

/** isTranslatablePage reasons this gate records, and what each means for the book. */
export const GATE_REASON_KIND = Object.freeze({
  'no-body': 'nothing_owed',
  'blank-ocr': 'nothing_owed',
  'ocr-loop': 'repair',
  'ocr-unreadable': 'repair',
  'illegible-source': 'repair',
});

/** The page fields the verdict needs (ocr.data included: the gate reads the text). */
export const GATE_PROJECTION = Object.freeze({
  _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.unreadable': 1, 'ocr.updated_at': 1,
  'translation.data': 1, 'translation.health_blocked': 1, 'translation.recitation_blocked': 1, 'translation.safety_blocked': 1,
});

/**
 * Pure: the gate's verdict on one page, or null when it is not one this gate records (it passes, has no OCR yet
 * — pending OCR is owed work — has English, is already health-blocked, or was turned away for another reason).
 */
export function gateVerdict(page, { illegibleGate } = {}) {
  if (typeof page?.ocr?.data !== 'string' || page.ocr.data === '') return null;
  if (typeof page?.translation?.data === 'string' && page.translation.data !== '') return null;
  if (page?.translation?.health_blocked) return null;
  const v = isTranslatablePage(page, illegibleGate === undefined ? {} : { illegibleGate });
  if (v.ok || !GATE_REASON_KIND[v.reason]) return null;
  return { id: page.id, reason: v.reason, kind: GATE_REASON_KIND[v.reason] };
}

/** The `$set` for one stamp. */
export function gateStampSet(page, verdict, { lane, run = null, now = new Date() }) {
  return {
    'translation.health_blocked': TRANSLATE_GATE_BLOCK,
    'translation.health_blocked_at': now,
    'translation.refusal_reason': verdict.reason,
    'translation.refusal': { reason: verdict.reason, kind: verdict.kind, gate: 'isTranslatablePage', ocr_chars: codePointLength(page.ocr.data), ocr_updated_at: page.ocr.updated_at ?? null, lane, run, at: now },
    updated_at: now,
  };
}

/** The fields a release (or an undo) removes. `translation.data` is never touched. */
export const GATE_UNSET = Object.freeze({ 'translation.health_blocked': '', 'translation.health_blocked_at': '', 'translation.refusal_reason': '', 'translation.refusal': '' });

/**
 * Judge `pages` (each with GATE_PROJECTION's fields) and stamp the refusals this gate records. Returns
 * { stamped: [{ id, book_id, page_number, reason, kind }], passed: ids } — `passed` are the pages a reader may take.
 * With apply false nothing is written (the verdicts are still returned). The write is guarded: a page that gained
 * English or another block since it was read is left alone.
 */
export async function stampGateRefusals(db, pages, { apply = false, lane = 'unknown', run = null, now = new Date(), illegibleGate } = {}) {
  const stamped = [], passed = [];
  for (const p of pages) {
    const v = gateVerdict(p, { illegibleGate });
    if (!v) { passed.push(p.id); continue; }
    if (apply) {
      const r = await db.collection('pages').updateOne(
        { id: p.id, 'translation.health_blocked': { $exists: false }, $or: [{ 'translation.data': { $exists: false } }, { 'translation.data': { $in: [null, ''] } }] },
        { $set: gateStampSet(p, v, { lane, run, now }) });
      if (!r.modifiedCount) continue;
    }
    stamped.push({ id: p.id, book_id: p.book_id, page_number: p.page_number, reason: v.reason, kind: v.kind });
  }
  return { stamped, passed };
}

/**
 * The exit for a re-read (header: REVERSIBLE): this gate's stamps on pages whose OCR was written since `since` (the
 * `ocr.updated_at` index, so it costs the pages re-read in that window, not a walk of every book) and whose text has
 * changed since the stamp (`$strLenCP` no longer equal to `refusal.ocr_chars`) are judged again on the current text.
 * Released when they pass; re-stamped (new `ocr_chars`) when still refused. Any book, any lane's stamp of this gate.
 * An OCR writer that does not move `ocr.updated_at` is not seen here; the count still owes such a page (isHealthBlocked).
 * Returns { released: ids, restamped: ids, books: ids of the books either touched (recount them) }.
 */
export async function releaseStaleGateStamps(db, { since, apply = false, lane = 'unknown', run = null, now = new Date(), illegibleGate } = {}) {
  if (!(since instanceof Date)) throw new Error('releaseStaleGateStamps: pass { since: Date }');
  const released = [], restamped = [], books = new Set();
  const stale = await db.collection('pages').aggregate([
    { $match: { 'ocr.updated_at': { $gte: since }, 'translation.health_blocked': TRANSLATE_GATE_BLOCK } },
    { $project: { _id: 0, id: 1, changed: { $ne: [{ $strLenCP: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, '$ocr.data', ''] } }, { $ifNull: ['$translation.refusal.ocr_chars', -1] }] } } },
    { $match: { changed: true } },
  ]).toArray();
  if (!stale.length) return { released, restamped, books: [] };
  const pages = await db.collection('pages').find({ id: { $in: stale.map((p) => p.id) } }, { projection: GATE_PROJECTION }).toArray();
  for (const p of pages) {
    const v = gateVerdict({ ...p, translation: { ...p.translation, health_blocked: undefined } }, { illegibleGate });
    if (!v) {
      if (apply) await db.collection('pages').updateOne({ id: p.id, 'translation.health_blocked': TRANSLATE_GATE_BLOCK }, { $unset: GATE_UNSET, $set: { updated_at: now } });
      released.push(p.id);
    } else {
      if (apply) await db.collection('pages').updateOne({ id: p.id, 'translation.health_blocked': TRANSLATE_GATE_BLOCK }, { $set: gateStampSet(p, v, { lane, run, now }) });
      restamped.push(p.id);
    }
    books.add(p.book_id);
  }
  return { released, restamped, books: [...books] };
}
