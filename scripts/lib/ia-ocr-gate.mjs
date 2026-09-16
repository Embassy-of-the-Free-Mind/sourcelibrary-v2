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
