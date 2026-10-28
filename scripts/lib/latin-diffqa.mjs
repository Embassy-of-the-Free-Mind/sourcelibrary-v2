// PRIOR ART: scripts/eval/tibetan-correct-6560/pass/diffqa.mjs (classify / revertHunks over Tibetan SYLLABLES, with a
// Derge dictionary for the low-risk class) and scripts/lib/tibetan-yatags-guard.mjs (the aligner, reused here). Neither
// tokenises Roman script: syllableTokens keeps only Tibetan letters, so on Latin it returns nothing (#7269). This is the
// same spans / revert shape over WORDS, with the Latin low-risk classes of #7591 and a third read to vote with.
/**
 * Word-level diff-QA of a model correction of a Latin / Roman-script OCR draft (#7591).
 *
 *   wordTokens(text)            -> [{ tok, key, start, end }] whitespace tokens whose fold is not empty (a token that is
 *                                  only punctuation is not a word: punctuation changes are low-risk by rule)
 *   fold(tok)                   -> the comparison key: tags out, edge punctuation out, lower case, ſ→s, æ→ae, œ→oe,
 *                                  v→u, j→i (the printer's interchangeable letters, never a reading)
 *   diffWords(a, b)             -> { A, B, pairs, hunks, changed, draftN }: hunks are the runs whose keys differ
 *   classifyHunk(aToks, bToks)  -> ['LOW'|'RISKY', why]
 *   voteHunk(d, h, F, bf)       -> 'correction' | 'draft' | 'split' | 'no-anchor': what an independent read says
 *   revertWordHunks(draft, next, d, idx) -> next with the hunks in idx put back to the draft's text
 *
 * LOW (accepted from the text alone): long-s / f↔ſ, u/v, i/j, æ/ae, œ/oe, case, punctuation, whitespace and
 * hyphenation joins. RISKY (needs a vote): any digit or roman numeral, a capitalised word (names, shelfmarks), a
 * negation added or dropped, a line's worth added or dropped, and anything else.
 */
import { alignSyllables } from './tibetan-yatags-guard.mjs';

const EDGE_PUNCT = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;
export function fold(tok) {
  return String(tok).normalize('NFC').replace(/<[^>]*>/g, '').replace(EDGE_PUNCT, '').toLowerCase()
    .replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/v/g, 'u').replace(/j/g, 'i');
}
/** As fold, but ſ kept, so a f↔ſ confusion can be told from a f↔s one. */
const foldKeepS = (tok) => String(tok).normalize('NFC').replace(/<[^>]*>/g, '').replace(EDGE_PUNCT, '').toLowerCase()
  .replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/v/g, 'u').replace(/j/g, 'i');

// The transcription's judgement fields (what language, what kind of page, how many columns, a catchword note, the
// indexing terms, a picture's description, a warning): a model's description of the page, not words printed on it. Their words are not aligned (a change to them is LOW);
// <header>, <page-num> and <sig> are printed and stay words.
export const META_TAG = /<(language|script|scan-quality|page-type|columns|meta|vocab|image-desc|warning)>[\s\S]*?<\/\1>/g;
export function wordTokens(text) {
  const t = String(text).normalize('NFC');
  const meta = [...t.matchAll(META_TAG)].map((m) => [m.index, m.index + m[0].length]);
  const out = [];
  for (const m of t.matchAll(/\S+/gu)) {
    const key = fold(m[0]);
    if (!key || meta.some(([s, e]) => m.index < e && m.index + m[0].length > s)) continue;
    out.push({ tok: m[0], key, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function diffWords(draft, next) {
  const A = wordTokens(draft), B = wordTokens(next);
  const pairs = alignSyllables(A.map((x) => x.key), B.map((x) => x.key));
  const hunks = [];
  let cur = null, same = 0, lastI = null, lastJ = null;
  for (const [i, j] of pairs) {
    const eq = i !== null && j !== null && A[i].key === B[j].key;
    if (eq) { same++; if (cur) { cur.aAfter = i; cur.bAfter = j; hunks.push(cur); cur = null; } lastI = i; lastJ = j; continue; }
    cur ??= { a: [], b: [], aBefore: lastI, bBefore: lastJ, aAfter: null, bAfter: null };
    if (i !== null) cur.a.push(i);
    if (j !== null) cur.b.push(j);
  }
  if (cur) hunks.push(cur);
  // A run of word-for-word substitutions is voted word by word: one wrong word must not take its neighbours' good
  // fixes back with it (Philolophico tranfmutatione → Philosophico transmutatione, where a fresh read had one of each).
  const split = hunks.flatMap((h) => (h.a.length > 1 && h.a.length === h.b.length
    ? h.a.map((i, m) => ({ a: [i], b: [h.b[m]], aBefore: m ? h.a[m - 1] : h.aBefore, bBefore: m ? h.b[m - 1] : h.bBefore, aAfter: m < h.a.length - 1 ? h.a[m + 1] : h.aAfter, bAfter: m < h.b.length - 1 ? h.b[m + 1] : h.bAfter }))
    : [h]));
  return { A, B, pairs, hunks: split, same, draftN: A.length, nextN: B.length, changed: Math.max(A.length, B.length) - same };
}

// Joined, with every punctuation mark out except one between two digits (A.D. = A. D., Ib.p.69 = Ib. p. 69, White-hall
// = Whitehall, Hiſto-|riæ = Hiſtoriæ; but 1.2 is not 12).
const joinKey = (toks) => fold(toks.map((t) => String(t).replace(/<[^>]*>/g, '')).join(' ').replace(/(?<!\d)[\p{P}\p{S}]+|[\p{P}\p{S}]+(?!\d)/gu, '').replace(/\s+/g, ''));
/** As joinKey, with f read as s: the vote's second look, where one read writes the long s as f and another as ſ. */
const joinKeyFS = (toks) => joinKey(toks).replace(/f/g, 's');
export const NEGATIONS = new Set(['non', 'nec', 'neque', 'nisi', 'ne', 'ni', 'haud', 'nunquam', 'numquam', 'nihil', 'nil', 'nullus', 'nulla', 'nullum', 'nemo', 'not', 'no', 'nor', 'never', 'none', 'nothing', 'ne', 'pas', 'point', 'nicht', 'kein', 'keine']);
const ROMAN = /^[ivxlcdm]+i?$/; // folded (j→i), so iij / viij count
const isRoman = (t) => { const k = fold(t); return k.length > 0 && k.length <= 9 && ROMAN.test(k); };
const isCap = (t) => /^\p{Lu}/u.test(String(t).replace(/<[^>]*>/g, '').replace(/^[\p{P}\p{S}]+/u, ''));
const negCount = (toks) => toks.filter((t) => NEGATIONS.has(fold(t))).length;

/** f↔ſ only (plus folded-equal letters): the long-s misread, both ways. */
function longS(x, y) {
  const a = [...foldKeepS(x)], b = [...foldKeepS(y)];
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const p = a[i] + b[i];
    if (p === 'fſ' || p === 'ſf' || p === 'sſ' || p === 'ſs') { diff++; continue; }
    return false;
  }
  return diff > 0;
}

export function classifyHunk(a, b) {
  if (joinKey(a) === joinKey(b)) return ['LOW', a.length === b.length ? 'case-punct' : 'join-split'];
  if (a.length === b.length && a.length > 0 && a.every((x, i) => fold(x) === fold(b[i]) || longS(x, b[i]))) return ['LOW', 'long-s'];
  if (Math.max(a.length, b.length) > 6 || Math.abs(a.length - b.length) >= 4) return ['RISKY', 'line-size'];
  if (negCount(a) !== negCount(b)) return ['RISKY', 'negation'];
  if ([...a, ...b].some((t) => /\d/.test(t))) return ['RISKY', 'number'];
  if ([...a, ...b].some(isRoman)) return ['RISKY', 'roman'];
  if ([...a, ...b].some(isCap)) return ['RISKY', 'capital'];
  return ['RISKY', a.length && b.length ? 'substitution' : (a.length ? 'dropped' : 'added')];
}

/**
 * The B↔F alignment once per page: bf.get(j) = the F index aligned to B[j] with an equal key, else absent.
 */
export function alignToFresh(B, F) {
  const bf = new Map();
  for (const [j, f] of alignSyllables(B.map((x) => x.key), F.map((x) => x.key))) if (j !== null && f !== null && B[j].key === F[f].key) bf.set(j, f);
  return bf;
}
/**
 * What an independent read (F, the fresh read's tokens) says at a hunk. The hunk's place in F is found from the
 * nearest correction tokens on either side that F also has (up to 4 back and forward); the F tokens between those
 * anchors are set beside the correction's tokens and the draft's (the hunk's span swapped for the draft's) over the
 * same window, compared as joined fold keys (so a hyphen break or a long s in F does not count).
 */
export function voteHunk(d, h, F, bf, { reach = 4 } = {}) {
  const lo = h.b.length ? h.b[0] : (h.bAfter ?? d.B.length); // first B index of the hunk or the insertion point
  const hi = h.b.length ? h.b[h.b.length - 1] : lo - 1;
  let L = null, R = null;
  for (let j = lo - 1; j >= Math.max(-1, lo - 1 - reach); j--) { if (j === -1) { L = -1; break; } if (bf.has(j)) { L = j; break; } }
  for (let j = hi + 1; j <= Math.min(d.B.length, hi + 1 + reach); j++) { if (j === d.B.length) { R = j; break; } if (bf.has(j)) { R = j; break; } }
  if (L === null || R === null) return 'no-anchor';
  const fL = L === -1 ? -1 : bf.get(L), fR = R === d.B.length ? F.length : bf.get(R);
  if (fR <= fL || fR - fL - 1 > (R - L - 1) + Math.max(h.a.length, h.b.length) + 6) return 'no-anchor';
  const keys = (xs) => xs.map((x) => x.key);
  const fresh = joinKey(keys(F.slice(fL + 1, fR)));
  const left = d.B.slice(L + 1, lo), right = d.B.slice(hi + 1, R);
  const corr = joinKey(keys([...left, ...h.b.map((j) => d.B[j]), ...right]));
  const draft = joinKey(keys([...left, ...h.a.map((i) => d.A[i]), ...right]));
  if (fresh === corr) return 'correction';
  if (fresh === draft) return 'draft';
  const [f2, c2, d2] = [F.slice(fL + 1, fR), [...left, ...h.b.map((j) => d.B[j]), ...right], [...left, ...h.a.map((i) => d.A[i]), ...right]].map((xs) => joinKeyFS(keys(xs)));
  if (f2 === c2 && f2 !== d2) return 'correction';
  if (f2 === d2 && f2 !== c2) return 'draft';
  return 'split';
}

/**
 * The correction with the hunks in `idx` put back to the draft's text, raw (the draft's own spelling, punctuation and
 * line breaks between the hunk's words). A word the correction added is removed with the space before it; a word it
 * dropped comes back with the draft's separator before it (a newline, if it was a line).
 */
export function revertWordHunks(draft, next, d, idx) {
  const D = String(draft).normalize('NFC'), N = String(next).normalize('NFC');
  const edits = [];
  for (const [k, h] of d.hunks.entries()) {
    if (!idx.has(k)) continue;
    const { A, B } = d;
    if (h.a.length && h.b.length) {
      edits.push([B[h.b[0]].start, B[h.b.at(-1)].end, D.slice(A[h.a[0]].start, A[h.a.at(-1)].end)]);
    } else if (h.b.length) { // the correction added words: take them out with the separator before (else after)
      const s = h.bBefore !== null ? B[h.bBefore].end : B[h.b[0]].start;
      const e = h.bBefore !== null ? B[h.b.at(-1)].end : (h.bAfter !== null ? B[h.bAfter].start : N.length);
      edits.push([s, e, '']);
    } else { // the correction dropped words: put them back with the draft's separator
      if (h.bBefore !== null) {
        const from = h.aBefore !== null ? A[h.aBefore].end : A[h.a[0]].start;
        edits.push([B[h.bBefore].end, B[h.bBefore].end, (h.aBefore !== null ? '' : ' ') + D.slice(from, A[h.a.at(-1)].end)]);
      } else {
        const to = h.aAfter !== null ? A[h.aAfter].start : A[h.a.at(-1)].end;
        const at = h.bAfter !== null ? B[h.bAfter].start : N.length;
        edits.push([at, at, D.slice(A[h.a[0]].start, to) + (h.aAfter !== null ? '' : ' ')]);
      }
    }
  }
  let out = N;
  for (const [s, e, t] of edits.sort((x, y) => y[0] - x[0])) out = out.slice(0, s) + t + out.slice(e);
  return out;
}

/** Line of a character offset, counted from 1. */
export const lineAt = (text, off) => String(text).slice(0, off).split('\n').length;
