// PRIOR ART: scripts/eval/continuation-probe-7271/text.mjs (cleanStored is imported from it unchanged; its scores are
// WORD runs, which cannot score Chinese or sandhi-joined Sanskrit, so the character scores for #7570 live here);
// .claude/docs/invariants/non-latin-text-operations.md (letters of EVERY script are kept, and an empty comparison form
// is "unjudgeable", never a zero).
/**
 * text.mjs — per-script comparison form and the character scores for the read-or-recall pilot (#7570).
 *
 *   SCRIPTS[s].keep     the letters compared for script s (other scripts on the page are dropped from BOTH sides, so a
 *                       Latin crib beside a Greek text, or a Hindi gloss under Sanskrit, is not scored);
 *   cmp(text, s)        cleanStored → NFC → script fold → only `keep` letters, no spaces, no punctuation, no digits.
 *                       latin: lower case, marks stripped, ſ→s, æ→ae, œ→oe, j→i, v→u. greek: lower case, accents and
 *                       breathings stripped, ς→σ. hebrew: niqqud and cantillation stripped, final forms folded.
 *                       chinese: Han characters only (no variant folding). sanskrit: Devanagari letters and signs kept
 *                       (matras and virama are part of the letter), danda, digits and ZWJ/ZWNJ removed.
 *   score(out, key, s)  { acc: max(0, 1 − CER), cer, recall_ng, lcs, key_chars, out_chars } on the comparison forms;
 *                       recall_ng = share of the key's character n-grams (n = 6, Chinese 3) found in the output;
 *                       lcs = the longest common substring in characters (a verbatim-memory signature).
 *                       null when the key's comparison form is under 50 characters (Chinese 30): unjudgeable.
 */
import { cleanStored } from '../continuation-probe-7271/text.mjs';

export const SCRIPTS = {
  latin: { keep: /[a-z]/u, label: 'Latin' },
  greek: { keep: /[Ͱ-Ͽἀ-῿]/u, label: 'Greek' },
  chinese: { keep: /\p{Script=Han}/u, label: 'classical Chinese' },
  hebrew: { keep: /[א-ת]/u, label: 'Hebrew' },
  sanskrit: { keep: /[ऀ-ॣॱ-ॿ]/u, label: 'Sanskrit (Devanagari)' },
};
const NGRAM = { chinese: 3 };
const MIN_KEY = { chinese: 30 };

const LETTER = { latin: /\p{Script=Latin}/u, greek: /\p{Script=Greek}/u, chinese: /\p{Script=Han}/u, hebrew: /\p{Script=Hebrew}/u, sanskrit: /\p{Script=Devanagari}/u };
/** Letters of the script in raw text (the draw's screen). */
export const scriptLetters = (t, s) => { let n = 0; for (const ch of String(t || '')) if (LETTER[s].test(ch)) n++; return n; };

const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export function cmp(text, s) {
  let t = cleanStored(String(text || '')).normalize('NFC');
  if (s === 'latin') t = t.toLowerCase().replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe').normalize('NFD').replace(/\p{M}/gu, '').replace(/j/g, 'i').replace(/v/g, 'u');
  else if (s === 'greek') t = t.normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC').toLowerCase().replace(/ς/g, 'σ');
  else if (s === 'hebrew') t = t.normalize('NFD').replace(/\p{M}/gu, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);
  else if (s === 'sanskrit') t = t.replace(/[‌‍।॥०-९॰]/g, '');
  let o = ''; for (const ch of t) if (SCRIPTS[s].keep.test(ch)) o += ch;
  return o;
}

export function levenshtein(a, b) {
  const A = [...a], Bc = [...b]; const n = A.length, m = Bc.length;
  if (!n) return m; if (!m) return n;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i; const ai = A[i - 1];
    for (let j = 1; j <= m; j++) { const c = prev[j - 1] + (ai === Bc[j - 1] ? 0 : 1); const d = prev[j] + 1, e = cur[j - 1] + 1; cur[j] = c < d ? (c < e ? c : e) : (d < e ? d : e); }
    [prev, cur] = [cur, prev];
  }
  return prev[m];
}
export function longestCommonSubstring(a, b) {
  const A = [...a], Bc = [...b]; let best = 0; let prev = new Int32Array(Bc.length + 1), cur = new Int32Array(Bc.length + 1);
  for (let i = 1; i <= A.length; i++) { for (let j = 1; j <= Bc.length; j++) { cur[j] = A[i - 1] === Bc[j - 1] ? prev[j - 1] + 1 : 0; if (cur[j] > best) best = cur[j]; } [prev, cur] = [cur, prev]; cur.fill(0); }
  return best;
}
export function score(out, key, s) {
  const k = cmp(key, s), o = cmp(out, s);
  const K = [...k], O = [...o];
  if (K.length < (MIN_KEY[s] ?? 50)) return null;
  const cer = levenshtein(o, k) / K.length;
  const n = NGRAM[s] ?? 6; const os = new Set(); for (let i = 0; i + n <= O.length; i++) os.add(O.slice(i, i + n).join(''));
  let hit = 0, tot = 0; for (let i = 0; i + n <= K.length; i++) { tot++; if (os.has(K.slice(i, i + n).join(''))) hit++; }
  return { acc: Math.max(0, 1 - cer), cer, recall_ng: tot ? hit / tot : 0, lcs: longestCommonSubstring(o, k), key_chars: K.length, out_chars: O.length };
}
