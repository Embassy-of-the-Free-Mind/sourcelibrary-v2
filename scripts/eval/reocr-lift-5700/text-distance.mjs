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
  // `->centred<-` markers go FIRST: a generic /<[^>]*>/ reads "<- … ->" between two centred lines as one tag and
  // deletes every line in between (metrics.mjs cleanMarkup has this; OCR prompt v19.1 centres far more lines).
  let t = stripWrappers(text || '').replace(DESCRIPTION_BLOCKS, ' ').replace(/->|<-/g, ' ').replace(/<\/?[a-zA-Z][^<>]*>/g, ' ').replace(/&amp;/gi, '&').replace(/&[a-z]{2,8};|&#\d+;/gi, ' ')
    .replace(/([\p{L}\p{M}])[-¬]\**\s*\n\s*\**/gu, '$1');
  t = SCRIPT_DEFS.hebrew.fold(t);
  t = SCRIPT_DEFS.arabic.fold(t).replace(/[کڪ]/g, 'ك').replace(/[یے]/g, 'ي').replace(/ۀ/g, 'ه');
  t = SCRIPT_DEFS.devanagari.fold(t);
  t = SCRIPT_DEFS.greek.fold(t);       // lowercases, strips combining accents U+0300–036F, folds final sigma
  t = SCRIPT_DEFS.latin.fold(t);
  return t.split(/\s+/).map((w) => [...w].filter((c) => /[\p{L}\p{M}]/u.test(c)).join('')).filter(Boolean);
}
/** Reference units missed or misread by the hypothesis, hypothesis-only units free (a fuller read is not punished). Optimistic for long hypotheses. */
function missRate(h, r) {
  if (!r.length) return null;
  let prev = new Uint32Array(h.length + 1);
  for (let i = 1; i <= r.length; i++) {
    const cur = new Uint32Array(h.length + 1); cur[0] = i;
    for (let j = 1; j <= h.length; j++) cur[j] = Math.min(cur[j - 1], prev[j - 1] + (r[i - 1] === h[j - 1] ? 0 : 1), prev[j] + 1);
    prev = cur;
  }
  return prev[h.length] / r.length;
}
/** Share of the distinct words (bigrams for CJK) of `a` that also occur in `b`: a same-leaf check, not an error rate. */
export function wordOverlap(a, b) {
  const units = (t) => (scriptClass(t) === 'cjk' ? (() => { const c = [...normalizeCJK(t)]; return c.slice(0, -1).map((x, i) => x + c[i + 1]); })() : normWords(t).filter((w) => w.length > 2));
  const A = new Set(units(a)), B = new Set(units(b)); if (!A.size) return null; let n = 0; for (const x of A) if (B.has(x)) n++; return n / A.size;
}
/** { cer, miss, wer, ref_chars, cls }: hypothesis against reference; wer is null for CJK. */
export function errorRates(hypothesis, reference) {
  const cls = scriptClass(reference);
  if (cls === 'cjk') {
    const h = [...normalizeCJK(hypothesis)], r = [...normalizeCJK(reference)];
    return { cls, cer: r.length ? levenshtein(h, r) / r.length : null, miss: missRate(h, r), wer: null, ref_chars: r.length, hyp_chars: h.length };
  }
  const hw = normWords(hypothesis), rw = normWords(reference);
  const h = [...hw.join('')], r = [...rw.join('')];
  return { cls, cer: r.length ? levenshtein(h, r) / r.length : null, miss: missRate(h, r), wer: rw.length ? levenshtein(hw, rw) / rw.length : null, ref_chars: r.length, hyp_chars: h.length, ref_words: rw.length };
}

// Shared cuts for curve.mjs, ocr-score.mjs and lift.mjs.
export const SCRIPT_GROUP = { Latin: 'Latin', German: 'vernacular (Latin script)', French: 'vernacular (Latin script)', Italian: 'vernacular (Latin script)', Dutch: 'vernacular (Latin script)', Spanish: 'vernacular (Latin script)',
  'Ancient Greek': 'Greek', 'Byzantine Greek': 'Greek', Hebrew: 'Hebrew/Aramaic', Aramaic: 'Hebrew/Aramaic', Arabic: 'Arabic', Persian: 'Persian', Sanskrit: 'Sanskrit', Pali: 'Pali', Chinese: 'Chinese' };
export const CER_BINS = [[0, 0.02, '< 2 %'], [0.02, 0.05, '2–5 %'], [0.05, 0.10, '5–10 %'], [0.10, 0.20, '10–20 %'], [0.20, Infinity, '≥ 20 %']];
export const binOf = (c) => CER_BINS.find(([lo, hi]) => c >= lo && c < hi)[2];
