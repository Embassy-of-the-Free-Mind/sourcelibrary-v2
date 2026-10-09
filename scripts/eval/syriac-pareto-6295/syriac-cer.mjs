/**
 * PRIOR ART: scripts/eval/benchmark/syriac-retest/score-syriac-retest.py (N2 = NFC, punctuation and Syriac
 * points stripped, page CER and order-free line CER against PAGE-XML ground truth; Python, line-level, and its
 * N2 keeps Latin letters, which a bilingual print page must not be scored on); scripts/eval/lib/edition-window.mjs
 * (the Syriac fold used to CUT a window: marks stripped, Syriac letters only, per word — no CER).
 * scripts/eval/lib/metrics.mjs has no Syriac entry in SCRIPT_DEFS. This is the scorer the #6295 panel uses,
 * pinned by scripts/eval/fixtures/syriac/*.json through tests/unit/syriac-cer.test.ts.
 *
 * syriac-cer.mjs — consonantal character error rate for printed Syriac against a typed e-text (#6295).
 *
 * The measure: both texts are folded to the CONSONANTAL skeleton — tags stripped (house tags with their
 * content where they are metadata, edition-window.mjs stripTags), NFD, every combining mark and Syriac
 * vowel/diacritic point removed (U+0730–U+074A, \p{M}), Syriac punctuation (U+0700–U+070F) removed, every
 * non-Syriac letter run (a Latin or Arabic column, digits, page numbers) turned into a word break — and
 * the edit distance is counted on that skeleton, spaces included, over the reference length.
 * Why consonantal: the Digital Syriac Corpus e-texts point some texts fully and others not at all, and the
 * same edition is pointed differently by different transcribers; a vowel point is not what a reader of the
 * notice needs to know was misread. Order is LOGICAL (Kraken runs with -d horizontal-rl --base-dir R, Gemini
 * writes logical order); a visually reversed string is an error, never normalised away (fixture rtl-reversed).
 */
import { stripTags } from '../lib/edition-window.mjs';

export const SYRIAC_CER_VERSION = 'syriac-cer/1';
const LETTER = /[ܐ-ܯݍ-ݏ]/u;

export function foldSyriac(text) {
  const s = stripTags(String(text || '')).normalize('NFD').replace(/\p{M}/gu, '').replace(/[ܰ-݊]/gu, '').replace(/[܀-܏]/gu, ' ');
  let out = '';
  for (const ch of s) out += LETTER.test(ch) ? ch : ' ';
  return out.replace(/\s+/g, ' ').trim();
}

export function levenshtein(a, b) {
  const A = [...a], B = [...b];
  if (!A.length) return B.length; if (!B.length) return A.length;
  let prev = new Int32Array(B.length + 1), cur = new Int32Array(B.length + 1);
  for (let j = 0; j <= B.length; j++) prev[j] = j;
  for (let i = 1; i <= A.length; i++) {
    cur[0] = i;
    for (let j = 1; j <= B.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
    [prev, cur] = [cur, prev];
  }
  return prev[B.length];
}

/** { cer, ref_chars, hyp_chars, length_ratio } on the folded skeletons. A runaway output is capped at 3× the
 *  reference + 200 characters (as the retest did) so a loop scores CER ≥ 1 without an unbounded distance. */
export function syriacCer(hypText, refText) {
  const ref = foldSyriac(refText), hyp0 = foldSyriac(hypText);
  if (!ref.length) return null;
  const hyp = hyp0.slice(0, 3 * ref.length + 200);
  const d = levenshtein(hyp, ref);
  return { cer: d / ref.length, ref_chars: ref.length, hyp_chars: hyp0.length, length_ratio: hyp0.length / ref.length };
}
