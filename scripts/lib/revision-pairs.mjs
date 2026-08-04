/**
 * Which `page_revisions` pairs are two READS OF THE SAME LEAF? (#3473)
 *
 * `page_revisions` is treated as a double-OCR corpus: a stored revision is the
 * text some later pass overwrote, so (revision, current) looks like the same page
 * transcribed twice. Agreement between the two sides is then used as a proxy for
 * accuracy (`calibration-scorecard.mjs` fits agreement→accuracy on anchor pages
 * and applies it corpus-wide).
 *
 * That inference holds only if both sides read the same image. Two ways it fails,
 * both measured, both silent:
 *
 *   1. A SWEEP THAT MOVED TEXT rather than producing a read. The #3357 e-rara
 *      off-by-one repair relocated existing `ocr`/`translation` subdocuments
 *      between pages; `page_revisions` snapshotted the displaced text at repair
 *      time. Those rows carry `source: 'shift-repair-erara-2026-07'` — 56,413 ocr
 *      and 55,272 translation rows, 323 books. Sampled at 600 rows, 95.2% of the
 *      translation side matches the CURRENT text of the page one leaf earlier at
 *      Jaccard 1.00 (byte-identical), and *zero* are same-page pairs. They are
 *      not two translations. They are one translation filed against two page ids.
 *      Nothing in the metadata says so: same model, same prompt_version, and the
 *      revision's `original_date` equals the live text's `updated_at`, because
 *      the moved subdocument carried its own timestamp.
 *
 *   2. A GENUINE IMAGE SWAP predating the sweep (#3368 leaf offset, re-archiving).
 *      No source label marks these. The instrument is the printed page number the
 *      model transcribes FROM THE PAGE: it identifies which leaf was photographed
 *      independently of how well the text was read. Two passes reporting different
 *      printed numbers did not read the same leaf.
 *
 * Both filters live here so a consumer cannot implement half of one. `hard-page-
 * sample.mjs` had the page-number half inline and not the source half;
 * `revision-agreement-corpus.mjs` and `calibration-scorecard.mjs` had neither.
 *
 * A new sweep label is the failure mode this file cannot see. Hence
 * `sourceKind()` returns `'unknown'` for anything unrecognised and callers are
 * expected to COUNT and REPORT unknowns rather than fold them into the corpus —
 * a bulk writer that borrows a pipeline label (`ai`, `batch_api`) is
 * indistinguishable from real model output forever after.
 *
 * No side twin in `src/`: nothing in the app reads revision pairs. If one appears,
 * pin the two together the way `strip-editorial-wrappers` is pinned.
 */

/**
 * Sources that RELOCATED existing text instead of transcribing an image.
 * A pair whose prior side carries one of these is not a double read at all.
 */
export const TEXT_MOVE_SOURCES = new Set([
  'shift-repair-erara-2026-07',
]);

/** Human edits. A real second look at the page, but not a second OCR pass. */
export const HUMAN_EDIT_SOURCES = new Set(['manual']);

/**
 * Writes that produced text WITHOUT reading the page: a mechanical transform of
 * text that already existed, or a synthetic placeholder.
 *
 *   maintenance — repair scripts rewriting stored text (`fix-unclosed-note-tags.mjs`
 *                 and friends). Prior and current are the same read, one tidied.
 *   system      — the blank-page marker `[Blank page - no translatable content]`
 *                 (`translation-processor-logic.ts`, `backfill-blank-page-markers.mjs`).
 *                 Not a translation at all; pairing a real one against it scores as
 *                 total disagreement while nothing was read twice.
 *   skip        — a skip marker from the same family.
 *
 * Found by the unknown-source alarm on the first full run (1,516 + 1,593 + 96 pairs
 * on the translation side). They were already refused as unrecognised; naming them
 * turns "we do not know what this is" into "we know, and it is not a read".
 */
export const DERIVED_TEXT_SOURCES = new Set(['maintenance', 'system', 'skip']);

/**
 * Sources known to be a model transcription pass. Present so an UNRECOGNISED
 * label surfaces loudly instead of silently joining the corpus.
 */
export const MODEL_PASS_SOURCES = new Set([
  'ai',
  'batch_api',
  'pipeline_preview',
  'realtime_api_sequential',
  'reocr-download-failure-fix-2026-07',
  'batch_api_recovery',   // re-run of a failed batch: a real second pass
  'mineru',
  'live',            // the synthetic label consumers give the current pages.ocr
  'unknown',         // pre-labelling rows; genuine passes, provenance lost
]);

/** Any future `shift-repair-*` sweep is a text move by construction. */
export function isTextMoveSource(source) {
  const s = source == null ? '' : String(source);
  return TEXT_MOVE_SOURCES.has(s) || /^shift[-_]repair/i.test(s);
}

/**
 * 'text-move' | 'human' | 'model' | 'unknown'
 * `null`/`undefined`/`''` are pre-labelling rows — genuine passes whose
 * provenance was never written. They are 'model', not 'unknown': treating them as
 * unknown would flag 1,263 legitimate rows and train readers to ignore the count.
 */
export function sourceKind(source) {
  if (isTextMoveSource(source)) return 'text-move';
  const s = source == null || source === '' ? 'unknown' : String(source);
  if (HUMAN_EDIT_SOURCES.has(s)) return 'human';
  if (DERIVED_TEXT_SOURCES.has(s)) return 'derived';
  if (MODEL_PASS_SOURCES.has(s)) return 'model';
  return 'unknown';
}

/**
 * The printed page number the model transcribed FROM the leaf, normalised for
 * comparison. Digits compare numerically (`[9]` === `9`); roman numerals and
 * folio marks compare as normalised strings (`iv.` === `IV`), which is why this
 * does not restrict itself to `[0-9]` the way the first ad-hoc audit did.
 * Returns null when the page carries no printed number — very common, and NOT
 * evidence of a shift.
 */
export function printedLeaf(text) {
  const m = (text || '').match(/<page-num>\s*([^<]{1,20}?)\s*<\/page-num>/i);
  if (!m) return null;
  const raw = m[1].replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  if (!raw) return null;
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
}

/**
 * The dominant writing system of a text, or null when there is too little to say.
 *
 * Format-independent on purpose. The obvious test — do the two sides declare
 * different `<language>` tags — is not usable, because the tag VOCABULARY changed
 * between prompt versions (`<lang>sa</lang>` in v3 against
 * `<language>Sanskrit</language>` in v5), so it partly measures the prompt. The
 * actual characters do not lie.
 */
const SCRIPT_BLOCKS = [
  ['latin', 0x0041, 0x024F], ['greek', 0x0370, 0x03FF], ['cyrillic', 0x0400, 0x04FF],
  ['armenian', 0x0530, 0x058F], ['hebrew', 0x0590, 0x05FF], ['arabic', 0x0600, 0x06FF],
  ['devanagari', 0x0900, 0x097F], ['bengali', 0x0980, 0x09FF], ['tamil', 0x0B80, 0x0BFF],
  ['tibetan', 0x0F00, 0x0FFF], ['georgian', 0x10A0, 0x10FF], ['ethiopic', 0x1200, 0x137F],
  ['kana', 0x3040, 0x30FF], ['han', 0x4E00, 0x9FFF],
];
const MIN_SCRIPT_CHARS = 20;
export function dominantScript(text) {
  const t = (text || '').replace(/<[^>]+>/g, ' ').slice(0, 6000);
  const counts = {};
  for (const ch of t) {
    const cp = ch.codePointAt(0);
    for (const [name, lo, hi] of SCRIPT_BLOCKS) {
      if (cp >= lo && cp <= hi) { counts[name] = (counts[name] || 0) + 1; break; }
    }
  }
  const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return ranked.length && ranked[0][1] >= MIN_SCRIPT_CHARS ? ranked[0][0] : null;
}

/**
 * Did these two texts come off the same leaf?
 *   'same'        — both printed numbers present and equal
 *   'different'   — both present and unequal (the two passes read different leaves)
 *   'unverified'  — at least one side prints no page number. The commonest case,
 *                   and the reason a per-pair check alone is not enough: a uniform
 *                   shift through an unnumbered stretch is invisible here. Use
 *                   `bookShiftVerdict()` over a book's pairs to catch it.
 */
export function leafVerdict(priorText, currentText) {
  const a = printedLeaf(priorText), b = printedLeaf(currentText);
  if (a == null || b == null) return 'unverified';
  return a === b ? 'same' : 'different';
}

/**
 * Classify one (prior, current) pair.
 *
 * `usable` means: two independent model reads of the same leaf, i.e. the thing an
 * agreement metric assumes it is looking at. Everything else is returned with a
 * reason rather than dropped silently, so callers can report the flow.
 *
 * BOTH sides are judged. The first version of this checked only `priorSource`,
 * which passes a pair whose CURRENT side is a synthetic blank-page marker
 * (`source: 'system'`) sitting against a real earlier translation — scoring as
 * total disagreement while nothing was read twice. `currentSource` is optional and
 * defaults to a model pass, so a caller that cannot supply it is no worse off than
 * before; supply it wherever the live subdocument's `source` is available.
 */
export function classifyPair({ priorSource, currentSource, priorText, currentText }) {
  const priorKind = sourceKind(priorSource);
  const currentKind = currentSource === undefined ? 'model' : sourceKind(currentSource);
  const leaf = leafVerdict(priorText, currentText);
  const printed = { prior: printedLeaf(priorText), current: printedLeaf(currentText) };
  const base = {
    source_kind: priorKind, current_source_kind: currentKind, leaf, printed,
    script: { prior: dominantScript(priorText), current: dominantScript(currentText) },
  };
  const either = k => priorKind === k || currentKind === k;

  if (!priorText || !currentText) return { ...base, usable: false, reason: 'empty-side' };
  if (either('text-move')) return { ...base, usable: false, reason: 'text-move-source' };
  if (either('derived')) return { ...base, usable: false, reason: 'derived-text' };
  if (either('human')) return { ...base, usable: false, reason: 'human-edit' };
  if (either('unknown')) return { ...base, usable: false, reason: 'unknown-source' };
  // Two texts in different writing systems are not two reads of one page. This is
  // the #3362 cross-book signature: the archiver wrote pages to a shared
  // `archived/undefined/<n>.jpg` key, OCR transcribed ANOTHER BOOK's page into
  // this one, and the later re-OCR of the correct image disagrees completely.
  // Verified against the scan on `rasaratnasamuccaya-vagbhata` p27 — a Devanagari
  // table of contents whose stored OCR was a Latin index (`erigeron`, `eryngium`).
  // Measured across the whole near-zero-agreement tail: 27.6% of those pairs are
  // cross-script, 539 of them latin->devanagari. They are not hard pages, and a
  // corpus that keeps them ranks the affected strata as the worst in the library.
  if (base.script.prior && base.script.current && base.script.prior !== base.script.current) {
    return { ...base, usable: false, reason: 'different-script' };
  }
  if (leaf === 'different') return { ...base, usable: false, reason: 'different-leaf' };
  return { ...base, usable: true, reason: 'ok' };
}

/**
 * Book-level verdict from that book's own verified pairs.
 *
 * A uniform slide preserves the page-number SEQUENCE perfectly, so per-pair checks
 * pass on every unnumbered leaf in an affected book. Where a book's *verified*
 * pairs are mostly shifted, its unverified pairs should be treated as shifted too
 * — the per-book signature is the only thing that can reach them.
 *
 * `minPairs` guards against calling a book on one or two comparisons.
 * Returns { verdict: 'clean'|'shifted'|'insufficient', verified, shifted, dominant_offset }
 * where dominant_offset is the modal numeric delta when both sides print digits
 * (a single dominant offset = a systematic slide; scattered offsets = per-page
 * reassignment or noise, a messier and different problem).
 *
 * Each pair may be given as texts (`{ priorText, currentText }`) or as already
 * extracted page numbers (`{ printedPrior, printedCurrent }`). Prefer the latter
 * at corpus scale: a book's pairs are not contiguous in a page_id-ordered scan, so
 * they must be accumulated across the whole run, and holding two page texts per
 * pair for 165K pages is gigabytes. Two numbers per pair is not.
 */
export function bookShiftVerdict(pairs, { minPairs = 3, threshold = 0.5 } = {}) {
  let verified = 0, shifted = 0;
  const offsets = new Map();
  for (const p of pairs) {
    const a = p.printedPrior !== undefined ? p.printedPrior : printedLeaf(p.priorText ?? p.prior_text);
    const b = p.printedCurrent !== undefined ? p.printedCurrent : printedLeaf(p.currentText ?? p.current_text);
    if (a == null || b == null) continue;
    verified++;
    if (a === b) continue;
    shifted++;
    if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
      const d = Number(b) - Number(a);
      offsets.set(d, (offsets.get(d) || 0) + 1);
    }
  }
  if (verified < minPairs) return { verdict: 'insufficient', verified, shifted, dominant_offset: null };
  const top = [...offsets.entries()].sort((x, y) => y[1] - x[1])[0] || null;
  return {
    verdict: shifted / verified > threshold ? 'shifted' : 'clean',
    verified,
    shifted,
    dominant_offset: top && top[1] / Math.max(1, shifted) >= 0.8 ? top[0] : null,
  };
}
