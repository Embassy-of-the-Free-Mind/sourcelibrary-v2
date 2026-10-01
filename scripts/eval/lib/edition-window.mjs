/**
 * edition-window.mjs — cut the stretch of a whole edition's text that one of our pages prints (#5488).
 *
 * PRIOR ART: benchmark-refs.mjs `wordWindow` (the word-bigram vote used for Syriac and Greek, moved here
 * unchanged so both callers share it) and `alignTrim`. benchmark-refs.mjs finds the WORK by phrase search
 * over an open corpus; here the work is known (a modern edition we hold privately), so only the window cut
 * is needed. Matching runs on FOLDED words (diacritics, case, long s, u/v, i/j), and the window is mapped
 * back to the edition's own text, which is what the reference is.
 */

import { SCRIPT_DEFS } from './metrics.mjs';
import { stripMarkupTags } from '../../lib/strip-markup-tags.mjs';

// Word-bigram vote: the densest run of the probe's bigrams in `words`, trimmed to the first/last hit ±3.
export function wordWindow(words, probeWords, contentMin = 0) {
  const P = new Set(); for (let i = 0; i + 1 < probeWords.length; i++) P.add(probeWords[i] + ' ' + probeWords[i + 1]);
  const L = Math.max(40, Math.round(probeWords.length * 1.3));
  const votes = new Float64Array(words.length + 1);
  for (let i = 0; i + 1 < words.length; i++) if (P.has(words[i] + ' ' + words[i + 1])) votes[i] = 1;
  let best = 0, at = 0, run = 0;
  for (let i = 0; i < votes.length; i++) { run += votes[i]; if (i >= L) run -= votes[i - L]; if (run > best) { best = run; at = Math.max(0, i - L + 1); } }
  const s = Math.max(0, at - Math.round(L * 0.15)), e = Math.min(words.length, at + L + Math.round(L * 0.15));
  const content = i => words[i].length >= contentMin && words[i + 1].length >= contentMin;
  let first = -1, last = -1; for (let i = s; i + 1 < e; i++) if (P.has(words[i] + ' ' + words[i + 1]) && content(i)) { if (first < 0) first = i; last = i + 2; }
  const from = first < 0 ? s : Math.max(s, first - 3), to = first < 0 ? e : Math.min(e, last + 3);
  return { window: words.slice(from, to).join(' '), from, to, overlap: P.size ? Math.min(1, best / P.size) : 0, shared: best };
}

// Folding is the SCORER's (lib/metrics.mjs SCRIPT_DEFS), so a window is cut on the same letters the
// score is computed on. Syriac is not in SCRIPT_DEFS; it gets a mark-strip + Syriac-letters fold.
// On a bilingual page (Greek + Ficino's Latin) only the edition's script survives the fold, so the
// other column neither helps nor hurts the vote.
const SYRIAC = { letters: /\p{Script=Syriac}/u, fold: s => s.normalize('NFD').replace(/\p{M}/gu, '') };
const defFor = script => (script === 'syriac' ? SYRIAC : SCRIPT_DEFS[script]);
export const SUPPORTED_SCRIPTS = [...Object.keys(SCRIPT_DEFS).filter(k => SCRIPT_DEFS[k]), 'syriac'];

export function foldWord(w, script) {
  const def = defFor(script);
  if (!def) throw new Error(`edition-window: unsupported script "${script}"`);
  return [...def.fold(w)].filter(ch => def.letters.test(ch)).join('');
}

// Strip OCR tags (<page-num>, <header>, <margin>…) to bare text; keep it for matching only.
export const stripTags = t => stripMarkupTags(String(t || '').replace(/<(meta|image-desc|figure|scan-quality|language|page-type|columns|detected-images|vocab|warning|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' '));

/** Words of `text` in `script`, folded, each with its [start, end) offset in the original text. */
export function foldedWords(text, script) {
  const out = []; const re = /[\p{L}\p{M}ſ]+/gu; let m;
  while ((m = re.exec(text))) { const f = foldWord(m[0], script); if (f.length >= 2) out.push({ w: f, start: m.index, end: m.index + m[0].length }); }
  return out;
}

/**
 * Cut the window of `editionText` that our page's `probeText` prints.
 * Returns { window, overlap, shared, probe_words, from_char, to_char } or null when the probe is too short.
 * `pad` widens the cut by N edition words each side: the probe is usually our own production read, and
 * trimming to exactly what it read would excuse its omissions at the page's edges. A human leaf check
 * sets the true boundaries; the pad only keeps the automatic cut from favouring the probe.
 */
export function cutEditionWindow(editionWords, editionText, probeText, script, { pad = 3, minProbeWords = 20 } = {}) {
  const probe = foldedWords(stripTags(probeText), script).map(x => x.w);
  if (probe.length < minProbeWords) return null;
  const words = editionWords.map(x => x.w);
  let w = wordWindow(words, probe, 3), matchKey = 'bigram';
  // Early prints abbreviate (hns = habens, ptas = potestas, p = per, q; = que) while a modern edition
  // expands, so adjacent-word pairs rarely survive and the bigram vote finds nothing (Vitruvius 1511
  // vs Krohn 1912: 7 of 15 pages under 0.35). Long words are rarely abbreviated, so fall back to a
  // vote on them alone; the alignment trim below tolerates the abbreviations as substitutions.
  if (w.overlap < 0.35) { const lw = longWordWindow(words, probe); if (lw.overlap > w.overlap) { w = lw; matchKey = 'long-words'; } }
  // The bigram vote LOCATES the passage but cannot TRIM it: common pairs (καὶ οὐ, et in) hit all
  // through the vote window, so first-to-last hit spans all of it (measured: 1,355 edition words cut
  // for an 819-word page). Trim by fitting alignment instead: the probe against the best SUBSTRING
  // of the located window, free skips at both ends — benchmark-refs.mjs alignTrim, at word level.
  const lo = Math.max(0, w.from - probe.length), hi = Math.min(words.length, w.to + probe.length);
  const span = alignSpan(probe, words.slice(lo, hi));
  const fromW = span ? lo + span.start : w.from, toW = span ? lo + span.end : w.to;
  const from = Math.max(0, fromW - pad), to = Math.min(editionWords.length, toW + pad);
  if (to <= from) return null;
  const a = editionWords[from].start, b = editionWords[to - 1].end;
  return { window: editionText.slice(a, b), overlap: w.overlap, shared: w.shared, probe_words: probe.length,
    span_wer: span ? +span.wer.toFixed(3) : null, match_key: matchKey, from_char: a, to_char: b };
}

// Vote on the probe's long words (≥ 6 letters) in a sliding window of the probe's length; overlap is
// the share of DISTINCT long probe words present in the best window.
export function longWordWindow(words, probe, minLen = 6) {
  const P = new Set(probe.filter(x => x.length >= minLen));
  const L = Math.max(40, Math.round(probe.length * 1.3));
  if (!P.size) return { from: 0, to: 0, overlap: 0, shared: 0 };
  let best = 0, at = 0; const inWin = new Map(); let distinct = 0;
  const add = x => { if (!P.has(x)) return; const n = (inWin.get(x) || 0) + 1; inWin.set(x, n); if (n === 1) distinct++; };
  const del = x => { if (!P.has(x)) return; const n = inWin.get(x) - 1; inWin.set(x, n); if (n === 0) distinct--; };
  for (let i = 0; i < words.length; i++) { add(words[i]); if (i >= L) del(words[i - L]); if (distinct > best) { best = distinct; at = Math.max(0, i - L + 1); } }
  return { from: at, to: Math.min(words.length, at + L), overlap: best / P.size, shared: best };
}

// Fitting alignment (free skip at both ends of `ref`): the substring of ref that `hyp` matches best.
// Arrays of tokens; returns { start, end, wer } in ref indices.
export function alignSpan(hyp, ref) {
  const n = hyp.length, m = ref.length; if (!n || !m) return null;
  let prev = new Int32Array(m + 1), cur = new Int32Array(m + 1), ps = new Int32Array(m + 1), cs = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) { prev[j] = 0; ps[j] = j; }
  for (let i = 1; i <= n; i++) {
    cur[0] = i; cs[0] = 0;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (hyp[i - 1] === ref[j - 1] ? 0 : 1), del = prev[j] + 1, ins = cur[j - 1] + 1;
      if (sub <= del && sub <= ins) { cur[j] = sub; cs[j] = ps[j - 1]; } else if (del <= ins) { cur[j] = del; cs[j] = ps[j]; } else { cur[j] = ins; cs[j] = cs[j - 1]; }
    }
    [prev, cur] = [cur, prev]; [ps, cs] = [cs, ps];
  }
  let best = Infinity, end = 0; for (let j = 0; j <= m; j++) if (prev[j] < best) { best = prev[j]; end = j; }
  return { start: ps[end], end, wer: best / Math.max(1, n) };
}
