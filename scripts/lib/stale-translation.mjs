/**
 * PRIOR ART: scripts/maintenance/withdraw-fabricated-translation-4584.mjs
 * withdraws INVENTED SPANS from a translation that is otherwise sound, by
 * replacing them with `<lacuna>` (an editorial wrapper both strippers already
 * drop). That is the right shape for a page where most of the translation is
 * good. It does not fit here: on these pages the ENTIRE translation was made
 * from OCR text that no longer exists on the page, so there is no good part to
 * keep and no span to anchor a marker to — the whole field has to come out.
 * `scripts/maintenance/quarantine-fabricated-ocr.mjs` (#4149) is the other
 * relative: it `$unset`s a field after snapshotting, which is the method
 * borrowed here, but it removes text that has no correct version, whereas this
 * text has a correct version that has not been written yet.
 *
 * ── The rule, once ───────────────────────────────────────────────────────────
 *
 * A page's stored translation is STALE when it was made from a transcription
 * the page no longer serves. Two arms, and a page is stale if either holds:
 *
 *   1. `stale_after_reocr` — the OCR was rewritten by a re-OCR lane
 *      (`ocr.pipeline` is set) and `translation.updated_at` is not newer than
 *      `ocr.updated_at`. The English on screen is a translation of text that
 *      was deleted; #4523 put 65,129 pages into this state on 2026-09-10.
 *   2. `ocr_unreadable` — the transcription is flagged `ocr.unreadable`, so the
 *      reader already withholds it as untrustworthy, but a translation OF that
 *      untrustworthy text is still stored. The reader withholds both panes;
 *      nothing else does — search, embeddings, quotes, exports and the MCP
 *      tools all read `translation.data` and see no flag.
 *
 * Both arms are SELF-HEALING: retranslate the page and arm 1 stops holding;
 * give the page a transcription we trust and arm 2 stops holding. Neither needs
 * a flag anyone has to remember to clear, and neither needs a frozen id list —
 * the sweep re-derives the set every run. (A frozen list is how the Kloss
 * takedown leaked for six weeks.)
 *
 * ── Where the text goes ──────────────────────────────────────────────────────
 *
 * Withholding MOVES the text rather than filtering it at read time: the page's
 * `translation` object becomes `translation_withheld` and the served field is
 * unset. Nine surfaces read `translation.data`; one of them will always be
 * missed by a filter-list, and the one that is missed serves the fabrication.
 * A move cannot be missed. Nothing is deleted: the prior translation is also
 * snapshotted to `page_revisions` under `WITHHOLD_REVISION_SOURCE`, so the
 * fabrication corpus stays countable and studyable in its own right.
 */

/** Written into `translation_withheld.reason` and the `page_revisions` row. */
export const WITHHOLD_REASONS = {
  STALE_AFTER_REOCR: 'stale_after_reocr',
  OCR_UNREADABLE: 'ocr_unreadable',
};

/** `page_revisions.reason` for the snapshot taken before a withhold. */
export const WITHHOLD_REVISION_SOURCE = 'withhold-stale-translation-4523';

/**
 * Mongo projection sufficient to evaluate `staleTranslationReason` without
 * pulling the (large) text bodies. `translation.data` is projected as a
 * presence test would need it; callers that only classify should use this and
 * fetch bodies for the pages they act on.
 */
export const STALE_PREDICATE_PROJECTION = {
  id: 1, book_id: 1, page_number: 1,
  'ocr.pipeline': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1,
  'translation.updated_at': 1, 'translation.edited_at': 1,
  translation_withheld: 1,
};

/**
 * A Mongo filter that is a SUPERSET of the stale set — it selects every page
 * either arm could apply to, cheaply, using the partial indexes
 * `pages_ocr_pipeline_partial` and `pages_ocr_unreadable_partial`. The date
 * comparison is not expressible in a plain filter, so callers must still run
 * `staleTranslationReason` on each candidate. Kept as an `$or` of two indexed
 * arms rather than one `$expr` for exactly that reason.
 */
export const STALE_CANDIDATE_FILTER = {
  $or: [
    { 'ocr.pipeline': { $exists: true } },
    { 'ocr.unreadable': true },
  ],
};

/**
 * Why this page's translation is stale, or null if it is not.
 *
 * Takes a page document (or the projection above). A page with no stored
 * translation is never stale — there is nothing being served. A page whose
 * translation has already been withheld is not stale either: the field it would
 * be judged on is gone, which is the point.
 *
 * @param {object} page
 * @returns {'stale_after_reocr'|'ocr_unreadable'|null}
 */
export function staleTranslationReason(page) {
  const tr = page?.translation;
  if (!translationText(tr)) return null;

  if (page?.ocr?.unreadable === true) return WITHHOLD_REASONS.OCR_UNREADABLE;

  if (page?.ocr?.pipeline) {
    const ocrAt = toTime(page.ocr.updated_at);
    const trAt = toTime(tr?.updated_at ?? tr?.edited_at);
    // No translation date at all means it predates date-stamping, which puts it
    // years before any re-OCR lane. Treat missing as old, never as fresh — the
    // failure we are guarding is serving invented English, and guessing "fresh"
    // is the guess that keeps serving it.
    if (trAt === null) return WITHHOLD_REASONS.STALE_AFTER_REOCR;
    if (ocrAt !== null && trAt <= ocrAt) return WITHHOLD_REASONS.STALE_AFTER_REOCR;
  }
  return null;
}

/**
 * The translation text a page is actually serving, or ''.
 *
 * Two shapes, both live in the collection: the modern `TranslationData` object
 * and a bare string on legacy pages (`withdraw-fabricated-translation-4584.mjs`
 * handles the same pair). A third shape — an object with no `data` — exists on
 * ~2,000 pages of this cohort alone and serves NOTHING; counting it as text
 * would withhold a field that has no text in it and inflate every number in the
 * report by about 3%.
 */
export function translationText(tr) {
  if (typeof tr === 'string') return tr;
  return typeof tr?.data === 'string' ? tr.data : '';
}

function toTime(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

/**
 * The `$set`/`$unset` that moves one page's translation into withholding.
 * Returns null when the page has nothing to withhold, so callers can build a
 * bulk op list without pre-filtering twice.
 */
export function withholdUpdate(page, reason, now = new Date()) {
  const tr = page?.translation;
  if (!translationText(tr)) return null;
  // A legacy bare-string translation is normalised into the object shape on the
  // way into holding, so the restore path has one shape to put back.
  const obj = typeof tr === 'string' ? { data: tr } : tr;
  return {
    $set: {
      translation_withheld: { ...obj, reason, withheld_at: now },
      updated_at: now,
    },
    $unset: { translation: '' },
  };
}

/** The inverse of `withholdUpdate`, for the restore path. */
export function restoreUpdate(page, now = new Date()) {
  const w = page?.translation_withheld;
  if (!w) return null;
  const { reason: _r, withheld_at: _w, ...translation } = w;
  return {
    $set: { translation, updated_at: now },
    $unset: { translation_withheld: '' },
  };
}
