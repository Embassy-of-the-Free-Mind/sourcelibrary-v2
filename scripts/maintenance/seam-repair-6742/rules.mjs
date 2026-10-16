// PRIOR ART: scripts/eval/seams-6742/census.mjs (#6742) — the catchwordEcho test (last 1–2 English words of N = first
// of N+1), bodyLines/isFurniture/STOP, and translation-page-boundary.mjs longestWordRun (the dup8 run) are the
// DETECTORS this file repairs from; they flag a join and never edit it. seam-repair.mjs (#6756) holds the repair
// format ({tail_old,tail_new,head_old,head_new}), edgeRefusal and mapOntoRaw, which these repairs go through unchanged.
// No prior code writes a seam repair without a model.
/**
 * rules — deterministic, model-free repairs for the two mechanical seam signals (#6742 lean, Test A).
 *
 *   echoRepair(it)  catchword echo: the same 1–6 words end English N and open English N+1. The repeat is removed on
 *                   the side the source does not carry it: a hyphen-split word or a split remnant ("venas," | "nas,")
 *                   is translated whole on page N (the prompt's rule), so N+1 loses it; a printed catchword (the
 *                   lone word at the foot of N that N+1 opens with) belongs to N+1's sentence, so N loses it.
 *                   No source cause → declined.
 *   dupRepair(it)   dup8 at the facing edges: an 8+-word run that ends page N and opens page N+1. It is removed on
 *                   the side whose English/source letter ratio it inflates (the ratio closer to the other page after
 *                   the cut); a run not at both facing edges, or a ratio call too close, is declined.
 *
 * `it` carries the four excerpts (srcTailA, srcHeadB, enTailA, enHeadB) and, for dupRepair, the full stored pages
 * (rawA, rawB, ocrA, ocrB). Each returns { repair } in seam-repair.mjs's format, or { decline: reason }.
 */
import { bodyLines, isFurniture, STOP } from '../../eval/seams-6742/census.mjs';
import { longestWordRun } from '../../audit/translation-page-boundary.mjs';
import { sourceProse, translationProse } from '../../lib/block-drift.mjs';

const norm = (w) => w.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const toks = (s) => [...s.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].map(m => ({ s: m.index, e: m.index + m[0].length, w: norm(m[0]) })).filter(t => t.w);
const wordsOf = (s) => toks(s).map(t => t.w);
const letters = (t) => (String(t).match(/[\p{L}\p{N}]/gu) || []).length;
const ELLIPSIS_END = /\s*(?:…|\.\s*\.\s*\.)\s*$/u;
const LEAD_JUNK = /^(?:\s|…|\.\s*\.\s*\.|[-–—])*/u;
export const MIN_SPAN_WORDS = 6;   // old spans are widened to this many words so they map uniquely onto the stored page

/** Split an edge excerpt into furniture-free body and the furniture lines on its page-edge side. */
function edgeParts(text, side) {
  const ls = text.split('\n');
  let a = 0, b = ls.length;
  if (side === 'tail') while (b > 1 && ls.length - b < 6 && isFurniture(ls[b - 1])) b--;
  else while (a < ls.length - 1 && a < 6 && isFurniture(ls[a])) a++;
  const pre = ls.slice(0, a).map(l => l + '\n').join(''), post = ls.slice(b).map(l => '\n' + l).join('');
  return { pre, body: ls.slice(a, b).join('\n'), post };
}

/** The repair that turns (enTailA, enHeadB) into (T2, H2): the differing suffix / prefix, widened to whole words. */
export function diffRepair(it, T2, H2) {
  const T = it.enTailA.trimEnd(), H = it.enHeadB.trimStart();
  T2 = T2.trimEnd(); H2 = H2.trimStart();
  const rep = { tail_old: '', tail_new: '', head_old: '', head_new: '' };
  if (T2 !== T) {
    let p = 0; while (p < T.length && p < T2.length && T[p] === T2[p]) p++;
    // back to a word start, then at least MIN_SPAN_WORDS words back (not across a line break)
    const lineStart = T.lastIndexOf('\n', p - 1) + 1;
    const before = toks(T.slice(lineStart, p));
    let start = before.length ? lineStart + before[Math.max(0, before.length - MIN_SPAN_WORDS)].s : lineStart;
    if (toks(T.slice(start, p)).length && /[\p{L}\p{N}]/u.test(T[p] || '') && /[\p{L}\p{N}]/u.test(T[p - 1] || '')) { /* mid-word p: start already precedes it */ }
    start = Math.min(start, p);
    rep.tail_old = T.slice(start); rep.tail_new = T2.slice(start);
  }
  if (H2 !== H) {
    let s = 0; while (s < H.length && s < H2.length && H[H.length - 1 - s] === H2[H2.length - 1 - s]) s++;
    const qH = H.length - s, qH2 = H2.length - s;   // differing prefix ends at qH (H) / qH2 (H2)
    const lineEnd = (() => { const k = H.indexOf('\n', qH); return k < 0 ? H.length : k; })();
    const after = toks(H.slice(qH, lineEnd));
    const extra = after.length ? after[Math.min(after.length, MIN_SPAN_WORDS) - 1].e : 0;
    rep.head_old = H.slice(0, qH + extra); rep.head_new = H2.slice(0, qH2 + extra);
  }
  return rep;
}

/** Cut `k` tokens (and any edge junk before them) off the START of a head body; returns { body, punct }. */
function cutHeadTokens(body, k) {
  const t = toks(body);
  const lead = body.match(LEAD_JUNK)[0];
  const keep = body.slice(lead.length, t[0].s);            // an opening quote or bracket before the first word stays
  let rest = body.slice(t[k - 1].e);
  const junk = rest.match(/^[^\p{L}\p{N}\n]*/u)[0];
  rest = rest.slice(junk.length);
  const punct = (junk.replace(/…|\.\s*\.\s*\./g, '').match(/[.;:!?,]/u) || [''])[0];
  return { body: keep + rest, punct };
}

/** What the SOURCE says about a doubled word at the turn: 'keep-N' | 'keep-N1' | null. */
export function echoCause(srcTailA, srcHeadB) {
  const ls = bodyLines(srcTailA.replace(/^…/, ''));
  const last = (ls[ls.length - 1] || '').trim().replace(/[*_`~\s]+$/u, '');
  const lw = wordsOf(last), hw = wordsOf(srcHeadB.replace(/…$/, '')).slice(0, 3);
  if (!lw.length || !hw.length) return null;
  // printed catchword: a lone (≤2-word) last line that N+1 opens with, or N's last word = N+1's first word
  if ((lw.length <= 2 && ls.length > 1 && lw[0] === hw[0]) || lw[lw.length - 1] === hw[0]) return 'keep-N1';
  // a split word: N's source ends on a hyphen, or N+1 opens on the remnant of N's last word ("venas," | "nas,")
  if (/[-‐‑⸗=¬]$/u.test(last)) return 'keep-N';
  const lastW = lw[lw.length - 1];
  if (hw[0].length >= 2 && lastW.length > hw[0].length && lastW.endsWith(hw[0])) return 'keep-N';
  return null;
}

/** Catchword echo repair. */
export function echoRepair(it) {
  const tp = edgeParts(it.enTailA, 'tail'), hp = edgeParts(it.enHeadB, 'head');
  const tt = toks(tp.body), ht = toks(hp.body);
  let k = 0;
  for (let n = Math.min(6, tt.length, ht.length); n >= 1; n--) {
    const a = tt.slice(-n).map(x => x.w), b = ht.slice(0, n).map(x => x.w);
    if (a.join(' ') !== b.join(' ')) continue;
    if (n === 1 && (STOP.has(b[0]) || b[0].length < 3)) continue;
    k = n; break;
  }
  if (!k) return { decline: 'no-echo' };
  if (/[\p{L}\p{N}]/u.test(tp.body.slice(tt[tt.length - 1].e))) return { decline: 'echo-not-at-edge' };
  const cause = echoCause(it.srcTailA, it.srcHeadB);
  if (!cause) return { decline: 'echo-no-source-cause' };
  let tBody = tp.body, hBody = hp.body;
  if (cause === 'keep-N') {
    const c = cutHeadTokens(hBody, k);
    hBody = c.body;
    tBody = tBody.replace(ELLIPSIS_END, '');
    if (c.punct && /[\p{L}\p{N}]$/u.test(tBody)) tBody += c.punct;
  } else {
    tBody = tBody.slice(0, tt[tt.length - k].s).replace(/[\s\-–—]+$/u, '');
    hBody = hBody.replace(LEAD_JUNK, '');
  }
  if (!toks(tBody).length || !toks(hBody).length) return { decline: 'echo-empties-a-side' };
  return { repair: diffRepair(it, tp.pre + tBody + tp.post, hp.pre + hBody + hp.post), cause, k };
}

const ratio = (raw, ocr) => { const s = letters(sourceProse(ocr)); return s >= 80 ? letters(translationProse(raw)) / s : null; };
export const DUP_EDGE_SLACK = 2;   // words allowed between the run and the facing edge
export const DUP_RATIO_MARGIN = 0.05;

/** dup8 repair: an 8+-word run that ends N's English and opens N+1's. */
export function dupRepair(it) {
  const tp = edgeParts(it.enTailA, 'tail'), hp = edgeParts(it.enHeadB, 'head');
  const tt = toks(tp.body).slice(-80), ht = toks(hp.body).slice(0, 80);
  const run = longestWordRun(tt.map(x => x.w), ht.map(x => x.w), 8);
  if (run.len < 8) return { decline: 'no-dup-run-in-excerpts' };
  if (tt.length - (run.i + run.len) > DUP_EDGE_SLACK || run.j > DUP_EDGE_SLACK) return { decline: 'dup-not-at-facing-edges' };
  if (/[\p{L}\p{N}]/u.test(tp.body.slice(tt[tt.length - 1].e))) return { decline: 'dup-not-at-facing-edges' };
  const rA = ratio(it.rawA, it.ocrA), rB = ratio(it.rawB, it.ocrB);
  if (rA == null || rB == null) return { decline: 'dup-no-ratio' };
  const runLetters = letters(tp.body.slice(tt[run.i].s));
  const sA = letters(sourceProse(it.ocrA)), sB = letters(sourceProse(it.ocrB));
  const cutA = Math.abs(Math.log(Math.max(1e-6, rA - runLetters / sA) / rB)), cutB = Math.abs(Math.log(rA / Math.max(1e-6, rB - runLetters / sB)));
  if (Math.abs(cutA - cutB) < DUP_RATIO_MARGIN) return { decline: 'dup-ratio-ambiguous' };
  let tBody = tp.body, hBody = hp.body, side;
  if (cutA < cutB) { side = 'tail'; tBody = tBody.slice(0, tt[run.i].s).replace(/\s+$/u, ''); hBody = hBody.replace(LEAD_JUNK, ''); }
  else { side = 'head'; const c = cutHeadTokens(hBody, run.j + run.len); hBody = c.body; tBody = tBody.replace(ELLIPSIS_END, ''); if (c.punct && /[\p{L}\p{N}]$/u.test(tBody)) tBody += c.punct; }
  if (!toks(tBody).length || !toks(hBody).length) return { decline: 'dup-empties-a-side' };
  return { repair: diffRepair(it, tp.pre + tBody + tp.post, hp.pre + hBody + hp.post), side, len: run.len };
}

export const RULES = { catchwordEcho: echoRepair, dup8: dupRepair };
