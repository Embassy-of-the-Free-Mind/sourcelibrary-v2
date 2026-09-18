/**
 * PRIOR ART: `scripts/lib/stale-translation.mjs` holds the withhold rule and the
 * field move (#4523) — it stays the door for WITHHOLDING and now delegates its
 * date/hash arm to `translationStaleness` below. `pipeline-orchestrator.mjs`
 * already stamps `transliteration.source_ocr_hash` (a 32-bit string hash) for
 * the same reason on the transliteration lane; that hash is not collision-safe
 * and is private to the orchestrator, so it does not fit as the shared rule.
 * `scripts/batch/retranslate-stale.mjs` defines "stale" by MODEL VINTAGE (OCR
 * model newer than translation model) — a different question. TWIN:
 * `src/lib/translation-source.ts`, parity-pinned by
 * `tests/unit/translation-source-parity.test.ts`.
 *
 * ── A translation should know which transcription it was made from (#4927) ──
 *
 * Measured 2026-09-18: 5,401,385 pages hold a translation; on 16,026 of them
 * the transcription is strictly newer than the translation, and the rule we
 * had (`ocr.pipeline` gate + date compare) caught 0 of them, because only one
 * lane ever stamps `ocr.pipeline`. Roughly 10,200 of those pages serve English
 * translated from text the page no longer holds, and the tail is a year deep.
 *
 * The fix is a FACT, not an inference:
 *
 *   translation.source_hash        sha256(ocr.data)[0:16] of the exact text the
 *                                  model was handed, written by every translation
 *                                  writer (`translationSourceFields`).
 *   translation.source_updated_at  the `ocr.updated_at` of that text, for humans.
 *   translation_stale              { reason, since, lane? } — the materialised
 *                                  verdict, behind the partial index
 *                                  `pages_translation_stale_partial`, so "which
 *                                  books have stale translations" is a query.
 *
 * A page is stale iff `source_hash !== sha256(ocr.data)`. Exact: immune to clock
 * ordering, to idempotent re-runs that rewrite identical text, and to a
 * translation and transcription written seconds apart in the same pass. For
 * pages that predate the hash, `translationStaleness` falls back to the
 * timestamps with a ~60s margin, and a MISSING translation date still counts as
 * old (the guess that keeps serving invented English is "fresh").
 *
 * Who writes the marker: OCR writers, at the moment they replace text under an
 * existing translation (`markStaleAfterOcrWrite`); and the daily sweep
 * (`scripts/maintenance/mark-stale-translations.mjs`) for anything missed.
 * Who clears it: every translation writer, by `$unset` (`CLEAR_STALE_UNSET`) —
 * the new hash matches by construction, so nothing has to be remembered. Never a
 * frozen id list (the Kloss takedown leaked six weeks that way).
 *
 * Who reads the marker (ACTUATION — CLAUDE.md): `translate-worker.mjs` page
 * selection and `scripts/batch/realtime-translate.mjs --stale`. Both are paid
 * lanes behind the daily spend dial. A blank/recitation/safety placeholder is
 * not a translation and is never marked (`isPlaceholderTranslation`), because
 * sweeping placeholders into a paid loop is how this gets expensive.
 *
 * None of this bumps `pages.updated_at` on its own: `embed-gemini --incremental`
 * selects on that timestamp, and a 5.4M-page backfill that touched it would
 * re-embed the corpus at cost.
 */
import { createHash } from 'node:crypto';

/** Same shape as `contentHash` in translate-core: sha256 hex, first 16 chars. */
export function sourceHash(text) {
  return createHash('sha256').update(typeof text === 'string' ? text : '').digest('hex').slice(0, 16);
}

export const STALE_FIELD = 'translation_stale';

/** How a stale verdict was reached — recorded on the marker. */
export const STALE_REASONS = Object.freeze({
  /** The stored source hash does not match the current transcription. */
  HASH_MISMATCH: 'hash_mismatch',
  /** No source hash; the transcription's date is newer than the translation's beyond the margin. */
  OCR_NEWER: 'ocr_newer',
  /** No source hash and no translation date at all — missing counts as old. */
  UNDATED: 'undated',
  /** An OCR writer replaced the text under this translation just now. */
  OCR_REWRITTEN: 'ocr_rewritten',
});

/** Same-run ordering (a translation and its OCR written seconds apart) is not staleness. */
export const STALE_MARGIN_MS = 60_000;

/**
 * A single bracketed line is a placeholder, never a translation:
 * `[Blank page]`, `[This page could not be translated due to content recitation
 * restrictions.]`, `[Illustration page — no translatable content]`, …
 */
export const PLACEHOLDER_RE = /^\s*\[[^\]]{0,200}\]\s*$/;
export const PLACEHOLDER_SOURCES = Object.freeze(['skip', 'system']);

export function isPlaceholderTranslation(tr) {
  if (!tr || typeof tr !== 'object') return false;
  if (PLACEHOLDER_SOURCES.includes(tr.source)) return true;
  return typeof tr.data === 'string' && PLACEHOLDER_RE.test(tr.data);
}

/** The translation text a page serves, or '' — legacy bare strings included. */
export function translationText(tr) {
  if (typeof tr === 'string') return tr;
  return typeof tr?.data === 'string' ? tr.data : '';
}

/**
 * The two provenance fields to spread INTO a translation object (or, with
 * `dotted`, to add to a `$set` that writes `translation.*` keys).
 */
export function translationSourceFields(ocrText, ocrUpdatedAt, { dotted = false } = {}) {
  const f = { source_hash: sourceHash(ocrText) };
  const at = toDate(ocrUpdatedAt);
  if (at) f.source_updated_at = at;
  if (!dotted) return f;
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [`translation.${k}`, v]));
}

/** `$unset` fragment every translation writer includes: the new hash is the exit. */
export const CLEAR_STALE_UNSET = Object.freeze({ [STALE_FIELD]: '' });

/**
 * Is this page's translation stale, and how do we know?
 * Returns { stale: false } or { stale: true, reason }. A page with no real
 * translation (none, empty, placeholder) is never stale — nothing is served.
 */
export function translationStaleness(page, { marginMs = STALE_MARGIN_MS } = {}) {
  const tr = page?.translation;
  const text = translationText(tr);
  if (!text) return { stale: false };
  if (typeof tr === 'object' && isPlaceholderTranslation(tr)) return { stale: false };
  if (typeof tr === 'string' && PLACEHOLDER_RE.test(tr)) return { stale: false };

  const ocrText = page?.ocr?.data;
  if (typeof tr === 'object' && typeof tr.source_hash === 'string' && tr.source_hash) {
    return tr.source_hash === sourceHash(ocrText)
      ? { stale: false }
      : { stale: true, reason: STALE_REASONS.HASH_MISMATCH };
  }

  const ocrAt = toTime(page?.ocr?.updated_at);
  const trAt = typeof tr === 'object' ? toTime(tr.updated_at ?? tr.edited_at) : null;
  // No transcription date: the OCR predates date-stamping, so it is older than
  // any translation that was made from it. Not stale — nothing newer exists.
  if (ocrAt === null) return { stale: false };
  if (trAt === null) return { stale: true, reason: STALE_REASONS.UNDATED };
  if (ocrAt - trAt > marginMs) return { stale: true, reason: STALE_REASONS.OCR_NEWER };
  return { stale: false };
}

/** The marker object written to `translation_stale`. */
export function staleMarker(reason, { now = new Date(), lane } = {}) {
  const m = { reason, since: now };
  if (lane) m.lane = lane;
  return m;
}

/**
 * Mongo filter: pages that carry a REAL translation (text, not a placeholder).
 * Used by the sweep and by `staleMarkerOps`.
 */
export const REAL_TRANSLATION_FILTER = Object.freeze({
  'translation.data': { $type: 'string', $ne: '', $not: PLACEHOLDER_RE },
  'translation.source': { $nin: PLACEHOLDER_SOURCES },
});

/**
 * bulkWrite ops an OCR writer runs right after replacing `ocr.data`, so a page
 * whose translation was made from the OLD text is marked the moment the new
 * text lands. Filters on `translation.source_hash != hash(newText)`, so a
 * rewrite of identical text marks nothing, and on the page holding a real
 * translation, so a page with nothing to go stale is left alone. Entries carry
 * `{ id }` or `{ _id }` plus `text` (the new transcription).
 */
export function staleMarkerOps(entries, { lane, now = new Date() } = {}) {
  const ops = [];
  for (const e of entries || []) {
    if (!e || typeof e.text !== 'string') continue;
    const key = e.id !== undefined ? { id: e.id } : e._id !== undefined ? { _id: e._id } : null;
    if (!key) continue;
    ops.push({
      updateOne: {
        filter: { ...key, ...REAL_TRANSLATION_FILTER, 'translation.source_hash': { $ne: sourceHash(e.text) } },
        update: { $set: { [STALE_FIELD]: staleMarker(STALE_REASONS.OCR_REWRITTEN, { now, lane }) } },
      },
    });
  }
  return ops;
}

/**
 * Run `staleMarkerOps` against `pages`. Returns the number of pages marked.
 * Never throws: a failed marker is caught by the daily sweep, and an OCR write
 * that already succeeded must not be reported as failed because of it.
 */
export async function markStaleAfterOcrWrite(db, entries, { lane, now } = {}) {
  const ops = staleMarkerOps(entries, { lane, now });
  if (ops.length === 0) return 0;
  try {
    const r = await db.collection('pages').bulkWrite(ops, { ordered: false });
    return r.modifiedCount ?? 0;
  } catch (err) {
    console.warn(`[translation-source] stale marker write failed (${ops.length} ops): ${err.message}`);
    return 0;
  }
}

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toTime(v) {
  const d = toDate(v);
  return d ? d.getTime() : null;
}
