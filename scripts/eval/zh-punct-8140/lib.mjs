// PRIOR ART: scripts/eval/cbeta-ref-6101.mjs (the CBETA frame, its gaiji rule `〔…〕` → one character, Mulberry32 —
// reused here), scripts/eval/ground-truth-5935/lib.mjs (Han-only CER folding: it DROPS punctuation, which is the
// thing measured here, so it does not fit). No existing scorer measures break positions.
/**
 * #8140 — punctuation (句读) as break positions over an unchanged character string.
 *   - stripForInput(text): what an arm sees. Every Unicode punctuation mark (\p{P}) and all whitespace removed, the
 *     （） around inline notes with them (the note text stays). A CBETA gaiji 〔…〕 becomes ONE 〓 first.
 *   - breaksOf(text): the same strip, recording after which character (0-based index into the stripped string) each
 *     run of marks sat. Returns { chars, any: Set, final: Set } — final = the run holds 。？！ (or ASCII . ? !).
 *     A mark before the first character or after the last is not a position (no break can be judged there).
 *   - （） and 〔〕 are never breaks, in the key or in an arm's output (an arm cannot know where CBETA's notes are).
 */
export function mulberry32(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const gaiji = (t) => String(t || '').normalize('NFC').replace(/〔[^〔〕]{1,12}〕/g, '〓');
const MARK = /[\p{P}]/u;
const WS = /\s/u;
const NOT_BREAK = new Set(['（', '）', '(', ')']);
const FINAL = new Set(['。', '？', '！', '?', '!', '.', '｡']);
export const hanCount = (t) => [...String(t || '')].filter((c) => /\p{Script=Han}/u.test(c)).length;

export function breaksOf(text) {
  const chars = []; const any = new Set(); const final = new Set(); const kinds = new Map();
  let run = [];
  const flush = () => {
    const marks = run.filter((m) => !NOT_BREAK.has(m));
    if (marks.length && chars.length) { const i = chars.length - 1; any.add(i); if (marks.some((m) => FINAL.has(m))) final.add(i); kinds.set(i, marks.join('')); }
    run = [];
  };
  for (const c of gaiji(text)) {
    if (WS.test(c)) continue;
    if (MARK.test(c)) { run.push(c); continue; }
    flush(); chars.push(c);
  }
  // trailing marks: after the last character — not a position
  const n = chars.length;
  for (const s of [any, final]) s.delete(n - 1);
  kinds.delete(n - 1);
  return { chars: chars.join(''), n, any, final, kinds };
}
export const stripForInput = (text) => breaksOf(text).chars;

/** Guard: the arm's output with its marks and whitespace removed must equal the input, code point for code point. */
export function guard(input, output) {
  const b = breaksOf(output);
  const same = b.chars === input;
  let firstDiff = -1;
  if (!same) { const a = [...input], o = [...b.chars]; firstDiff = a.findIndex((c, i) => c !== o[i]); if (firstDiff < 0) firstDiff = Math.min(a.length, o.length); }
  return { same, outLen: [...b.chars].length, inLen: [...input].length, firstDiff, breaks: b };
}

/**
 * Repair = keep only the insertion positions: align the output's characters to the input with an LCS over code
 * points (O(n·m), pages are ≤ ~1,500 chars), and carry a mark over only where the character it follows is matched
 * AND the next matched pair is adjacent on both sides (no inserted/deleted character between). A changed character is
 * never served: the served string is the INPUT with marks inserted.
 */
export function repairBreaks(input, output) {
  const b = breaksOf(output);
  const A = [...input], O = [...b.chars];
  const n = A.length, m = O.length;
  const W = m + 1; const L = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i * W + j] = A[i] === O[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
  const pairs = []; let i = 0, j = 0;
  while (i < n && j < m) { if (A[i] === O[j]) { pairs.push([i, j]); i++; j++; } else if (L[(i + 1) * W + j] >= L[i * W + j + 1]) i++; else j++; }
  const any = new Set(), final = new Set();
  for (let k = 0; k < pairs.length - 1; k++) {
    const [ai, oj] = pairs[k], [ai2, oj2] = pairs[k + 1];
    if (ai2 !== ai + 1 || oj2 !== oj + 1) continue;
    if (b.any.has(oj)) any.add(ai);
    if (b.final.has(oj)) final.add(ai);
  }
  return { any, final, matched: pairs.length, inLen: n, outLen: m };
}

/** TP/FP/FN of predicted positions against the key, over one page. */
export function prf(key, pred) { let tp = 0; for (const p of pred) if (key.has(p)) tp++; return { tp, fp: pred.size - tp, fn: key.size - tp }; }
export const f1Of = ({ tp, fp, fn }) => { const p = tp + fp ? tp / (tp + fp) : NaN, r = tp + fn ? tp / (tp + fn) : NaN; return { p, r, f1: tp ? 2 * p * r / (p + r) : 0 }; };
