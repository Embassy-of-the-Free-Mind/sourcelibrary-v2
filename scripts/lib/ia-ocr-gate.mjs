// PRIOR ART: scripts/import/ia-ocr-ingest.mjs — carried the cutoff as one `--min-agreement 0.85`
// default for every language; scripts/eval/ia-ocr-delivered-quality.mjs (#4790) measured that the
// right cutoff differs by language, so the policy moves here, where the ingester, the eval and the
// report read ONE table instead of each carrying a magic number.
//
// ia-ocr-gate — the per-language agreement cutoff for the free IA OCR lane.
//
// The lane (scripts/import/ia-ocr-ingest.mjs) fills untranscribed pages with the Internet
// Archive's own OCR when the Archive's reading of a book's leaves agrees with our model's reading
// of the same leaves (median word-sequence ratio over ≥ 5 reference pages). The cutoff is a policy
// choice about how much of a quality tail we accept, and #4790 measured the delivered text (one
// interior page per book against a fresh model read, CER) to set it per language:
//
//   language | cutoff | accepted median CER / ≤5% / >20% at that cutoff | why
//   English  | 0.80   | 3.3% / 65% /  7%  | the 0.80–0.85 band delivers median 5% CER, 80% of pages ≤ 10%
//   French   | 0.80   | 3.4% / 68% /  8%  | the pages below 0.80 held ONE good page; lowest false-reject rate
//   Latin    | 0.85   | 4.5% / 61% / 11%  | flat trade; the tail is pre-1800 typography, not the cutoff
//   German   | 0.85   | 3.2% / 57% / 13%  | the tail does not shrink even at 0.90: the gate discriminates poorly on Fraktur
//   Italian  | 0.85   | 2.1% / 71% / 14%  | n = 30, too few to move
//   Greek    | never  | 6.6% / 29% / 24% at 0.85 | IA's Greek reading is poor across the board AND the reference is suspect
//
// Languages not in the table were never measured and keep the historic 0.85. There is no cliff
// anywhere in the curve (quality degrades smoothly with the score), so moving a value here is a
// quality/yield trade, not a correctness fix — re-measure with the delivered-quality eval first.
//
// Read `.claude/docs/invariants/language-fields.md` before keying anything else on `books.language`:
// it is the EDITION's language, which is exactly what this gate wants (the Archive OCR'd the edition).
import { normalizeLanguageToken } from './language-normalize.mjs';

/** Canonical language name (as `normalizeLanguageToken` returns it) → cutoff; `null` = never fill. */
export const IA_OCR_MIN_AGREEMENT = Object.freeze({
  English: 0.80,
  French: 0.80,
  Latin: 0.85,
  German: 0.85,
  Italian: 0.85,
  Greek: null,
});

/** Cutoff for a language that was never measured (#4790 measured six). The historic gate. */
export const IA_OCR_DEFAULT_MIN_AGREEMENT = 0.85;

/**
 * The gate for one book, from its `language` field (any spelling `normalizeLanguageToken` accepts).
 * Returns `{ language, cutoff, source }` where `cutoff` is a number or `null` (never fill) and
 * `source` says where it came from: 'measured' (in the table), 'excluded' (table says never), or
 * 'default' (not measured, or no usable language).
 */
export function iaOcrMinAgreement(language) {
  const canonical = normalizeLanguageToken(language) || null;
  if (canonical && Object.prototype.hasOwnProperty.call(IA_OCR_MIN_AGREEMENT, canonical)) {
    const cutoff = IA_OCR_MIN_AGREEMENT[canonical];
    return { language: canonical, cutoff, source: cutoff === null ? 'excluded' : 'measured' };
  }
  return { language: canonical, cutoff: IA_OCR_DEFAULT_MIN_AGREEMENT, source: 'default' };
}

// ---------- the digits gate (#5186) ----------
// The agreement cutoff above is about WORDS, and a book can clear it at 0.98 with 1 in 12 of its
// years wrong. This is the second, per-book check: the share of the numbers on the model's
// reference pages that the Archive printed identically on the same leaves
// (`numericAgreement`, scripts/lib/ia-ocr-agreement.mjs), pooled over the reference pages.
//
// Calibrated 2026-10-13 on the four #5186 county histories, 2,283 Archive-vs-lite page pairs from
// `page_revisions` (year error from the #5402 taxonomy, numeric agreement whole-book / on an evenly
// spaced 25-page sample like the reference the ingester sees):
//
//   book                      | years wrong | numeric agreement | 25-page sample
//   Deyo, Barnstable 1890     | 4.6%        | 0.950             | 0.958
//   Wakeley, Gate City 1917   | 8.0%        | 0.925             | 0.948
//   NH Notables 1919          | 1.0%        | 0.989             | 0.986
//   Clevelanders 1914         | 0.7%        | 0.990             | 0.986
//
// The issue's proposed 0.95 would have passed Deyo (0.958 on its sample) — the book that found
// the 3→8 swaps. 0.97 separates the two groups on every measure. Lite itself misreads ~1–2% of
// numbers (#5224), so agreement near 0.98 is about as good as two engines get.
// The verdict does NOT refuse a book: the prose is still good. It stamps the pages that carry
// numbers `ocr.digits_unreliable` so a reader, a quote, or a re-read lane can find them.

/** Pooled numeric agreement below this → the book's digits are unreliable. */
export const IA_OCR_MIN_NUMERIC_AGREEMENT = 0.97;
/** Fewer reference numbers than this → unmeasured (a discursive book; nothing to judge on). */
export const IA_OCR_MIN_REF_NUMBERS = 30;

/**
 * Judge a book's pooled numeric agreement `{ ref, matched }`. Returns the record written into
 * `ocr.agreement_ref.numeric`: `{ ratio, ref, matched, min, unreliable }`, where `ratio` is null
 * and `unreliable` false when there were too few numbers to measure.
 */
export function iaOcrDigitsVerdict({ ref = 0, matched = 0 } = {}) {
  const measured = ref >= IA_OCR_MIN_REF_NUMBERS;
  const ratio = measured ? +(matched / ref).toFixed(3) : null;
  return { ratio, ref, matched, min: IA_OCR_MIN_NUMERIC_AGREEMENT, unreliable: measured && matched / ref < IA_OCR_MIN_NUMERIC_AGREEMENT };
}
