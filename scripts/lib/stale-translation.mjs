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
 * `scripts/batch/retranslate-stale.mjs` defines "stale" by MODEL VINTAGE (OCR
 * model newer than translation model) — a different question, left alone.
 *
 * ── The rule, once ───────────────────────────────────────────────────────────
 *
 * A page's stored translation is STALE when it was made from a transcription
 * the page no longer serves. `translationStaleness()` decides it from the two
 * clocks every writer already stamps: `ocr.updated_at` newer than
 * `translation.updated_at` by more than `STALE_MARGIN_MS` (same-run ordering
 * — a collector writing the reading and the translation seconds apart — is not
 * staleness; the margin was set by reading pages in each band, see the test
 * and PR #4929). A MISSING translation date counts as old, never as fresh: the
 * failure we are guarding is serving invented English, and guessing "fresh" is
 * the guess that keeps serving it.
 *
 * There is deliberately NO content hash (Derek, 2026-09-18: "I just don't see
 * a situation where the timestamp wouldn't be enough… and if it doesn't leave
 * one, that's a bigger issue"). Every live writer of `ocr.data` stamps
 * `ocr.updated_at`; `tests/unit/ocr-write-stamps-updated-at.test.ts` asserts
 * that at the write boundary, so a writer that forgot would fail CI rather
 * than be tolerated by a parallel mechanism.
 *
 * Until #4927 this arm was gated on `ocr.pipeline`, which only one lane ever
 * stamped — it caught 0 of the 16,026 pages measured stale corpus-wide.
 *
 * ── Two verbs, two predicates ────────────────────────────────────────────────
 *
 * FLAGGING (`translationStaleness`, materialised as `translation_stale` by
 * `scripts/maintenance/mark-stale-translations.mjs`) applies to the whole
 * corpus; its disposition is RE-TRANSLATION, drained by
 * `scripts/batch/realtime-translate.mjs --stale`. Nothing goes dark.
 *
 * WITHHOLDING (`staleTranslationReason`, acted on by the hourly
 * `withhold-stale-translations.mjs`) takes the text off the page. Three arms:
 *
 *   1. `stale_after_reocr` — the translation is stale (above) AND the page was
 *      rewritten by a lane in `WITHHOLD_LANES`. Withholding is a per-lane
 *      opt-in, never a property of staleness: Derek, 2026-09-18, on the Syriac
 *      Kraken lane (#4883) — "don't withhold individual pages though". #4523
 *      put 65,129 pages into this state on 2026-09-10 and is the one lane that
 *      opted in.
 *   2. `ocr_unreadable` — the transcription is flagged `ocr.unreadable`, so the
 *      reader already withholds it as untrustworthy, but a translation OF that
 *      untrustworthy text is still stored. The reader withholds both panes;
 *      nothing else does — search, embeddings, quotes, exports and the MCP
 *      tools all read `translation.data` and see no flag.
 *   3. `source_loop` — the transcription is a degeneration loop (#4850); opt-in
 *      and book-scoped, see `LOOP_CANDIDATE_FILTER`.
 *   4. `unverified_script_ocr` — a Tibetan- or Syriac-script page whose only
 *      transcription is a generalist Gemini read that no specialist lane has
 *      checked (#4523, #4883); opt-in and book-scoped, see
 *      `UNVERIFIED_SCRIPT_CANDIDATE_FILTER`.
 *
 * All arms are SELF-HEALING: retranslate the page and arm 1 stops holding;
 * give the page a transcription we trust and arms 2, 3 and 4 stop holding. None
 * needs a frozen id list — the sweeps re-derive the set every run. (A frozen
 * list is how the Kloss takedown leaked for six weeks.)
 *
 * ── Where the text goes ──────────────────────────────────────────────────────
 *
 * Withholding takes the text OFF THE PAGE DOCUMENT, rather than filtering it at
 * read time. Nine surfaces read `translation.data`; one of them will always be
 * missed by a filter-list, and the one that is missed serves the fabrication.
 *
 * The text goes to `page_revisions` (source `WITHHOLD_REVISION_SOURCE`) and
 * `pages.translation_withheld` keeps only the METADATA — model, dates, length,
 * content hash, reason. **The withheld object must never carry the text.** The
 * first version of this did keep it, and the reader serialises the whole page
 * document into its RSC flight payload (`findOne(..., { projection:
 * { detected_images: 0 } })`), so 3.6 KB of withdrawn English shipped inside
 * the HTML of every affected reader page — unrendered, fully scrapeable, and
 * invisible to a probe that only looks at the rendered pane. A sibling field on
 * the same document is not "out of service"; only a different collection is.
 * `page_revisions` is never serialised to a client, so this is structural
 * rather than a rule every future serializer has to remember.
 *
 * Nothing is deleted: the snapshot is the archive, and the fabrication corpus
 * stays countable and studyable in its own right.
 */

import { loopVerdict } from './ocr-loop-guard.mjs';
import { stripOcrMetadata } from './language-content-classify.mjs';

/** Is this page's transcription a degeneration loop? The #4850 gate's own verdict. */
function isDegenerateSource(ocrText) {
  return loopVerdict(ocrText || '').refuse;
}

// ── Staleness: the flagging predicate (#4927) ────────────────────────────────

/**
 * The materialised verdict on the page: `{ reason, since, lane? }`. Written by
 * the daily sweep (and by a re-OCR lane that wants its pages found at once —
 * the Syriac Kraken lane stamps it with `ocr_rewritten`); cleared by every
 * translation writer with `CLEAR_STALE_UNSET`. Indexed by
 * `pages_translation_stale_partial` so "which books have stale translations"
 * is a query, not a 40-minute `$expr` scan.
 */
export const STALE_FIELD = 'translation_stale';

/** `$unset` fragment every translation writer includes: a new translation is the exit. */
export const CLEAR_STALE_UNSET = Object.freeze({ [STALE_FIELD]: '' });

/** How a stale verdict was reached — recorded on the marker. */
export const STALE_REASONS = Object.freeze({
  /** The transcription's date is newer than the translation's beyond the margin. */
  OCR_NEWER: 'ocr_newer',
  /** No translation date at all — missing counts as old. */
  UNDATED: 'undated',
  /** A re-OCR lane replaced the text under this translation and said so itself. */
  OCR_REWRITTEN: 'ocr_rewritten',
});

/**
 * A write-ordering tolerance, not a staleness threshold. Measured 2026-09-19
 * over the 15,951 pages whose OCR clock is newer than their translation's
 * (PR #4929): the only band where both fields come from ONE writer pass is
 * under a second — a collector tick writing a translation job's result and an
 * OCR job's result for the same book 96 ms apart (20 pages). From 3 s upward
 * every sampled page was a second read landing over the first by a different
 * lane (a realtime read translated, then a batch read collected; a lite read
 * translated, then a full-model re-read; a Gemini read, then IA's text), and
 * those re-reads can differ materially, so no wider band is excluded — the
 * clock is the rule, and the consumer prices the set before draining. 60 s is
 * that tolerance plus clock skew between hosts (Lambda, Hetzner, Vercel all
 * write these fields); it excludes 47 of the 15,951 pages.
 */
export const STALE_MARGIN_MS = 60_000;

/**
 * A single bracketed line is a placeholder, never a translation:
 * `[Blank page]`, `[This page could not be translated due to content recitation
 * restrictions.]`, `[Illustration page — no translatable content]`, …
 * Sweeping placeholders into a paid re-translate loop is how this gets expensive.
 */
export const PLACEHOLDER_RE = /^\s*\[[^\]]{0,200}\]\s*$/;
export const PLACEHOLDER_SOURCES = Object.freeze(['skip', 'system']);

export function isPlaceholderTranslation(tr) {
  if (typeof tr === 'string') return PLACEHOLDER_RE.test(tr);
  if (!tr || typeof tr !== 'object') return false;
  if (PLACEHOLDER_SOURCES.includes(tr.source)) return true;
  return typeof tr.data === 'string' && PLACEHOLDER_RE.test(tr.data);
}

/**
 * Mongo filter: pages that carry a REAL translation (text, not a placeholder).
 * The flagging sweep's candidate scope.
 */
export const REAL_TRANSLATION_FILTER = Object.freeze({
  'translation.data': { $type: 'string', $ne: '', $not: PLACEHOLDER_RE },
  'translation.source': { $nin: PLACEHOLDER_SOURCES },
});

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

/**
 * Is this page's translation stale, and how do we know?
 * Returns { stale: false } or { stale: true, reason }. A page with no real
 * translation (none, empty, placeholder) is never stale — nothing is served.
 * A page whose OCR carries no date predates date-stamping and is older than any
 * translation made from it — not stale, nothing newer exists.
 */
export function translationStaleness(page, { marginMs = STALE_MARGIN_MS } = {}) {
  const tr = page?.translation;
  if (!translationText(tr)) return { stale: false };
  if (isPlaceholderTranslation(tr)) return { stale: false };

  const ocrAt = toTime(page?.ocr?.updated_at);
  if (ocrAt === null) return { stale: false };
  const trAt = typeof tr === 'object' ? toTime(tr.updated_at ?? tr.edited_at) : null;
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

function toTime(v) {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

// ── Withholding: per lane ────────────────────────────────────────────────────

/** Written into `translation_withheld.reason` and the `page_revisions` row. */
export const WITHHOLD_REASONS = {
  STALE_AFTER_REOCR: 'stale_after_reocr',
  OCR_UNREADABLE: 'ocr_unreadable',
  SOURCE_LOOP: 'source_loop',
  UNVERIFIED_SCRIPT_OCR: 'unverified_script_ocr',
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
  // `ocr.data` is the one big body this projection carries, and arm 3 is why: a
  // degeneration loop is only visible in the transcription itself. Leaving it out
  // would not make arm 3 cheap — it would make it silently never fire.
  'ocr.data': 1,
  'ocr.pipeline': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.unreadable': 1,
  'translation.updated_at': 1, 'translation.edited_at': 1, 'translation.source': 1,
  translation_withheld: 1,
};

/**
 * Re-OCR lanes whose stale translations are WITHHELD by the hourly sweep.
 * Withholding is a per-lane decision, not a property of staleness. Add a lane
 * here only when its pages should go dark until retranslated.
 *
 * `syriac-kraken-2026-09` (#4883): on 2026-09-18 Derek ruled "don't withhold
 * individual pages though" and the lane was left out, its disposition
 * re-translation (#4927). On 2026-09-25 he REVERSED that: "i want the
 * translation to be low priority, just get the ocr done and remove the current
 * translation that is bad." From then on the hourly sweep withholds every page
 * the Kraken lane rewrites, with no list — the English on those pages was made
 * from a Gemini read of Syriac that invented text (#4746/#4901).
 *
 * The list is checked in BOTH places a withhold can start: the candidate query
 * (`STALE_CANDIDATE_FILTER`) and the verdict (`staleTranslationReason`), so a
 * caller that reaches the verdict by another route — `--loop-arm`, the restore
 * script, a book-scoped run — cannot widen it.
 */
export const WITHHOLD_LANES = Object.freeze(['reocr_bdrc_4523', 'syriac-kraken-2026-09']);

/**
 * A Mongo filter that is a SUPERSET of the withhold set — it selects every page
 * either indexed arm could apply to, cheaply, using the partial indexes
 * `pages_ocr_pipeline_partial` and `pages_ocr_unreadable_partial`. The date
 * comparison is not expressible in a plain filter, so callers must still run
 * `staleTranslationReason` on each candidate. Kept as an `$or` of two indexed
 * arms rather than one `$expr` for exactly that reason.
 */
export const STALE_CANDIDATE_FILTER = {
  $or: [
    { 'ocr.pipeline': { $in: [...WITHHOLD_LANES] } },
    { 'ocr.unreadable': true },
  ],
};

/**
 * Arm 3's candidate filter, kept SEPARATE from `STALE_CANDIDATE_FILTER` above.
 *
 * Arms 1 and 2 are indexed and narrow (`ocr.pipeline`, `ocr.unreadable`); a looping
 * transcription carries neither marker, so nothing in the page document distinguishes
 * it until the text is read. The honest filter is therefore "every page with both a
 * transcription and a translation" — which is most of the corpus, and why this is
 * opt-in and book-scoped (`withhold-stale-translations.mjs --loop-arm`, driven by the
 * book list from `scripts/audit/ocr-loop-corpus.mjs`) rather than folded into the
 * sweep's default selection.
 */
export const LOOP_CANDIDATE_FILTER = {
  'ocr.data': { $exists: true, $nin: [null, ''] },
  'translation.data': { $exists: true, $nin: [null, ''] },
};

// ── Arm 4: unverified Gemini reads of Tibetan and Syriac script ─────────────

/**
 * Scripts whose generalist Gemini reads are measured to invent text: Tibetan
 * (#4523 — old reads locate the right Derge folio 14% of the time, median
 * identity 0.182) and Syriac (#4746/#4901 — "kings of Assyria" on a page whose
 * running head says "the Arab kings"). Each is read by a specialist lane
 * (Yigdzin / `reocr_bdrc_4523`; Kraken / `syriac-kraken-2026-09`) that stamps
 * `ocr.pipeline`, which is how arm 4 hands a page over to arm 1.
 */
export const UNVERIFIED_SCRIPTS = Object.freeze({
  tibetan: /[\u0F00-\u0FFF]/u,
  syriac: /[\u0700-\u074F]/u,
});

/**
 * The share of a page's LETTERS that must be in one of those scripts. A Syriac
 * book also carries Latin, Hebrew and Arabic pages (the Kraken plan kept 6,976
 * other-script and 7,571 mixed pages out of its lane); their Gemini reads are
 * not the measured failure and their English stays. 30%: a page that is mostly
 * a Latin commentary around a Syriac lemma keeps its English; a page that is
 * mostly Syriac with a Latin gloss does not.
 *
 * Deliberately lower than `classifyScript` in `syriac-kraken-lane.mjs`, which
 * RE-READS a page only at ≥ 0.6 Syriac (a Syriac model over a Latin column
 * writes junk). That is a question about the OCR; this one is about the
 * English: a 0.3–0.6 page's Gemini read is still mostly an invention of the
 * script Gemini cannot read, so its translation comes down even though the lane
 * will not re-read it.
 */
export const UNVERIFIED_SCRIPT_MIN_SHARE = 0.3;

/**
 * Which unverified script dominates this OCR text, and by how much.
 * Counts letters only (`\p{L}` — digits, punctuation, Tibetan tsheg and the
 * page's markup never vote), after dropping the OCR metadata block so a
 * `<language>Tibetan</language>` tag cannot count as Latin letters.
 * Pure; returns `{ script: null, share: 0 }` for text with no letters.
 *
 * @param {string} ocrText
 * @returns {{ script: 'tibetan'|'syriac'|null, share: number, letters: number }}
 */
export function unverifiedScriptShare(ocrText) {
  const letters = stripOcrMetadata(ocrText || '').match(/\p{L}/gu) || [];
  if (!letters.length) return { script: null, share: 0, letters: 0 };
  let best = null;
  let bestN = 0;
  for (const [name, re] of Object.entries(UNVERIFIED_SCRIPTS)) {
    const n = letters.reduce((k, ch) => k + (re.test(ch) ? 1 : 0), 0);
    if (n > bestN) { best = name; bestN = n; }
  }
  return { script: best, share: bestN / letters.length, letters: letters.length };
}

/**
 * Is this page's transcription an unverified Gemini read of Tibetan or Syriac?
 * All must hold: no specialist lane has read it (`ocr.pipeline` absent), the
 * read is Gemini's, and the text is at least `UNVERIFIED_SCRIPT_MIN_SHARE` of
 * one of those scripts. Self-healing: the lane's rewrite sets `ocr.pipeline`.
 */
export function isUnverifiedScriptOcr(ocr, { cohortScript = null } = {}) {
  if (!ocr || ocr.pipeline) return false;
  if (typeof ocr.model !== 'string' || !ocr.model.startsWith('gemini')) return false;
  // COHORT mode: the caller asserts every book in scope is written in this script
  // (the Tibetan re-OCR cohort). Then the share test is the wrong question: read by
  // eye 2026-09-25, Gemini wrote Devanagari, Gujarati, Javanese and romanised
  // Sanskrit for Tibetan dbu-med leaves, and English descriptions naming the script
  // as Balinese or Tai Tham — 10,820 such pages in the cohort, 7,795 of them
  // Devanagari. Whatever script the read came out in, it is not a reading of the
  // page. Not for the Syriac books, whose Latin, Greek and Arabic pages are real.
  if (cohortScript) return true;
  return unverifiedScriptShare(ocr.data).share >= UNVERIFIED_SCRIPT_MIN_SHARE;
}

/**
 * Arm 4's candidate filter, kept SEPARATE like `LOOP_CANDIDATE_FILTER` and for
 * the same reason: nothing indexed marks these pages — the script share is only
 * visible in the text. So the arm is opt-in and book-scoped
 * (`withhold-stale-translations.mjs --unverified-script-arm --books-file=…`),
 * never part of the hourly sweep's default selection. `{ $in: [null, ''] }`
 * matches a missing `ocr.pipeline` too, which is the case it exists for.
 */
export const UNVERIFIED_SCRIPT_CANDIDATE_FILTER = {
  'ocr.pipeline': { $in: [null, ''] },
  'ocr.model': { $regex: '^gemini' },
  'translation.data': { $exists: true, $nin: [null, ''] },
};

/**
 * Why this page's translation should be WITHHELD, or null if it should not.
 *
 * Takes a page document (or the projection above). A page with no stored
 * translation is never withheld — there is nothing being served. A page whose
 * translation has already been withheld is not either: the field it would be
 * judged on is gone, which is the point. A page that is merely STALE (arm 1's
 * rule holds but no withholding lane rewrote it) returns null here — it is
 * flagged for re-translation by `translationStaleness`, not taken dark.
 *
 * Arm 4 is evaluated only when the caller opts in (`unverifiedScriptArm`), so
 * the hourly sweep — which reaches this verdict for every indexed candidate —
 * cannot widen into it by accident.
 *
 * `cohortScript` (one of `UNVERIFIED_SCRIPTS`) widens arm 4 to every Gemini read in
 * a single-script cohort; see `isUnverifiedScriptOcr`. It has no effect without
 * `unverifiedScriptArm`.
 *
 * @param {object} page
 * @param {{ unverifiedScriptArm?: boolean, cohortScript?: 'tibetan'|'syriac'|null }} [opts]
 * @returns {'stale_after_reocr'|'ocr_unreadable'|'source_loop'|'unverified_script_ocr'|null}
 */
export function staleTranslationReason(page, { unverifiedScriptArm = false, cohortScript = null } = {}) {
  if (cohortScript && !Object.hasOwn(UNVERIFIED_SCRIPTS, cohortScript)) {
    throw new Error(`cohortScript must be one of ${Object.keys(UNVERIFIED_SCRIPTS).join(', ')}; got ${cohortScript}`);
  }
  const tr = page?.translation;
  if (!translationText(tr)) return null;

  if (page?.ocr?.unreadable === true) return WITHHOLD_REASONS.OCR_UNREADABLE;

  // Arm 3 (#4765/#4850): the transcription this English was made from is a
  // degeneration loop — one unit repeated to the output cap. Handed that, the model
  // does not decline; it writes fluent connected prose with no basis in the page, and
  // 53,628 pages corpus-wide are in exactly that state (measured 2026-09-15).
  // Self-healing like the other two arms: re-OCR the page and it stops holding.
  if (isDegenerateSource(page?.ocr?.data)) return WITHHOLD_REASONS.SOURCE_LOOP;

  // Arm 1: stale by the shared rule, AND rewritten by a lane that opted into
  // withholding. The lane check is the whole difference between flagging and
  // withholding; the staleness rule itself is not gated on any lane.
  if (WITHHOLD_LANES.includes(page?.ocr?.pipeline) && translationStaleness(page).stale) {
    return WITHHOLD_REASONS.STALE_AFTER_REOCR;
  }

  // Arm 4 (#4523/#4883, Derek 2026-09-25): the English was made from a Gemini
  // read of Tibetan or Syriac that no specialist lane has checked.
  if (unverifiedScriptArm && isUnverifiedScriptOcr(page?.ocr, { cohortScript })) {
    return WITHHOLD_REASONS.UNVERIFIED_SCRIPT_OCR;
  }
  return null;
}

/**
 * The `$set`/`$unset` that moves one page's translation into withholding.
 * Returns null when the page has nothing to withhold, so callers can build a
 * bulk op list without pre-filtering twice.
 */
export function withholdUpdate(page, reason, now = new Date()) {
  const tr = page?.translation;
  const text = translationText(tr);
  if (!text) return null;
  const obj = typeof tr === 'string' ? {} : { ...tr };
  // `data` is deliberately dropped, not moved — see the header. Everything that
  // is NOT the text stays, so the record of what was withheld (which model,
  // when it was written, how long it was) survives on the page itself and the
  // audit can reconcile it without opening `page_revisions`.
  delete obj.data;
  return {
    $set: {
      translation_withheld: { ...obj, reason, withheld_at: now, chars: text.length },
      updated_at: now,
    },
    // The stale marker (#4927) describes a translation that is no longer here.
    $unset: { translation: '', [STALE_FIELD]: '' },
  };
}

/**
 * The inverse of `withholdUpdate`. The text is not on the page, so a caller has
 * to supply it — from the `page_revisions` snapshot, which is where it lives.
 * That asymmetry is the point: there is exactly one place holding the text, and
 * a restore has to go and read it.
 */
export function restoreUpdate(page, text, now = new Date()) {
  const w = page?.translation_withheld;
  if (!w || typeof text !== 'string' || !text) return null;
  const { reason: _r, withheld_at: _w, chars: _c, ...meta } = w;
  return {
    $set: { translation: { ...meta, data: text }, updated_at: now },
    $unset: { translation_withheld: '' },
  };
}
