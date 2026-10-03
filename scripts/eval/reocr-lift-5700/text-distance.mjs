// PRIOR ART: scripts/eval/lib/metrics.mjs — `normalizeForScript` keeps ONE script's letters (a Greek page with a
// Latin column, or a Hebrew page with Aramaic and a Latin header, loses the rest) and `scoreAgainstReference` is a
// free-skip aligner for passage references cut from another edition. Here both sides are the SAME page (served OCR
// vs a by-eye corrected transcription of it), so the plain edit distance over every letter is the right measure.
// The per-script folds and `levenshtein` are reused from metrics.mjs unchanged.
/** Character and word error rate between two transcriptions of the same page, every script kept (#5700 A5). */
import { SCRIPT_DEFS, stripWrappers, normalizeCJK, levenshtein } from '../lib/metrics.mjs';

const HAN = /\p{Script=Han}/u;
const DESCRIPTION_BLOCKS = /<(image-desc|figure|detected-images)\b[^>]*>[\s\S]*?<\/\1>/gi;
/** Dominant script of a text: 'cjk' when more than 30 % of its letters are Han, else 'alphabetic'. */
export function scriptClass(text) {
  const letters = [...String(text || '').replace(/[^\p{L}]/gu, '')].slice(0, 3000);
  if (!letters.length) return 'empty';
  return letters.filter((c) => HAN.test(c)).length / letters.length > 0.3 ? 'cjk' : 'alphabetic';
}
/**
 * Strip our markup, apply every script's edition-level fold (long s, u/v, polytonic accents, niqqud, tashkeel,
 * Persian kaf/yeh), keep letters and combining marks (Indic vowel signs are marks), split on whitespace.
 */
export function normWords(text) {
  let t = stripWrappers(text || '').replace(DESCRIPTION_BLOCKS, ' ').replace(/<[^>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&[a-z]{2,8};|&#\d+;/gi, ' ')
    .replace(/(\p{L})[-¬]\s*\n\s*/gu, '$1');
  t = SCRIPT_DEFS.hebrew.fold(t);
  t = SCRIPT_DEFS.arabic.fold(t).replace(/[کڪ]/g, 'ك').replace(/[یے]/g, 'ي').replace(/ۀ/g, 'ه');
  t = SCRIPT_DEFS.devanagari.fold(t);
  t = SCRIPT_DEFS.greek.fold(t);       // lowercases, strips combining accents U+0300–036F, folds final sigma
  t = SCRIPT_DEFS.latin.fold(t);
  return t.split(/\s+/).map((w) => [...w].filter((c) => /[\p{L}\p{M}]/u.test(c)).join('')).filter(Boolean);
}
/** { cer, wer, ref_chars, cls }: hypothesis against reference; wer is null for CJK. */
export function errorRates(hypothesis, reference) {
  const cls = scriptClass(reference);
  if (cls === 'cjk') {
    const h = [...normalizeCJK(hypothesis)], r = [...normalizeCJK(reference)];
    return { cls, cer: r.length ? levenshtein(h, r) / r.length : null, wer: null, ref_chars: r.length, hyp_chars: h.length };
  }
  const hw = normWords(hypothesis), rw = normWords(reference);
  const h = [...hw.join('')], r = [...rw.join('')];
  return { cls, cer: r.length ? levenshtein(h, r) / r.length : null, wer: rw.length ? levenshtein(hw, rw) / rw.length : null, ref_chars: r.length, hyp_chars: h.length, ref_words: rw.length };
}
