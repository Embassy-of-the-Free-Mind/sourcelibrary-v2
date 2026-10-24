/**
 * latin-repair-census-5924/detectors.mjs — text-only page-defect detectors for stored Latin OCR (#5924). $0, no model.
 *
 * PRIOR ART: scripts/lib/ocr-loop-guard.mjs `loopVerdict` (the production write-time loop screen — used unchanged
 *   for the loop class); scripts/lib/blank-page-guard.mjs META list (copied here, plus `lang`/`margin`, because this
 *   needs the body WITH its line breaks and `transcriptionBody` collapses them); scripts/eval/latin-bakeoff-5924/
 *   score.mjs `longS` (needs a reference; a stored page has none). Nothing in scripts/{lib,audit,eval} detects
 *   facing-page bleed or a two-column read-across from text alone.
 *
 * Every detector here is gated by controls.mjs: a planted case it must fire on and a clean case it must not.
 * Classes: FIXABLE-IN-TEXT = long_s, bleed, loop; NEEDS-RE-READ = interleave, truncation, empty.
 */
import { loopVerdict } from '../../lib/ocr-loop-guard.mjs';

const META = ['language', 'lang', 'page-type', 'script', 'quality', 'scan-quality', 'image-desc', 'vocab', 'header',
  'sig', 'page-num', 'catchword', 'meta', 'warning', 'columns', 'detected-images', 'split-position', 'margin', 'note', 'gloss'];

/** Main-column body, line breaks kept. Side-notes (`<margin>`), apparatus and page furniture removed. */
export function bodyLines(text) {
  let t = String(text || '');
  for (const tag of META) {
    t = t.replace(new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'gi'), '\n');
    t = t.replace(new RegExp(`<${tag}[^>]*/?>`, 'gi'), '\n');
  }
  t = t.replace(/->|<-/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&[a-z]+;|&#\d+;/gi, ' ');
  return t.split('\n').map(l => l.replace(/^[#>*\s]+|[*_]+/g, '').replace(/\s+/g, ' ').trim())
    .filter(l => l && !/^-{3,}$/.test(l));
}
/** Line-level detectors (edge bleed, interleave) only apply where the read kept the printed line breaks. */
export function lineBroken(lines) {
  if (lines.length < 10) return false; const L = lines.map(l => l.length).sort((a, b) => a - b); return L[L.length >> 1] <= 80;
}
export const letters = s => (String(s).match(/\p{L}/gu) || []).length;

/** Latin fold for lexicon lookups: lower case, ſ→s, æ/œ kept as ae/oe, accents off, u/v and i/j merged. */
export function fold(w) {
  return w.toLowerCase().replace(/ſ/g, 's').replace(/æ/g, 'ae').replace(/œ/g, 'oe')
    .normalize('NFD').replace(/\p{M}/gu, '').replace(/v/g, 'u').replace(/j/g, 'i');
}
export const words = s => String(s).match(/[\p{L}ſ]+/gu) || [];

// ---------------------------------------------------------------- lexicon & char LM (built from corpus.mjs output)
export function buildLexicon(texts) {
  const V = new Map(); let n = 0;
  // line-break hyphens joined first, or every line-end fragment (`tur`, `rum`, `Con`) enters the lexicon as a word
  for (const t of texts) for (const w of words(bodyLines(t).join('\n').replace(/[-¬=⸗]\n\s*/g, ''))) { const f = fold(w); V.set(f, (V.get(f) || 0) + 1); n++; }
  return { V, n };
}
const ORDER = 5;
export function buildCharLM(texts) {
  const C = new Map(); // context → Map(char → count)
  for (const t of texts) {
    const s = ' ' + fold(bodyLines(t).join(' ').replace(/[^\p{L}ſ ]+/gu, ' ').replace(/\s+/g, ' ')) + ' ';
    for (let i = 0; i < s.length; i++) for (let k = 0; k < ORDER && k <= i; k++) {
      const ctx = s.slice(i - k, i); let m = C.get(ctx); if (!m) C.set(ctx, m = new Map()); m.set(s[i], (m.get(s[i]) || 0) + 1);
    }
  }
  const tot = new Map(); for (const [k, m] of C) { let x = 0; for (const v of m.values()) x += v; tot.set(k, x); }
  return { C, tot };
}
/** Interpolated (Witten-Bell-ish) log P of `s` given `ctx`. */
export function lmScore(lm, ctx, s) {
  let lp = 0, h = ctx;
  for (const ch of s) {
    let p = 1 / 40;
    for (let k = 0; k < ORDER; k++) {
      const c = h.slice(Math.max(0, h.length - k)); if (k > h.length) break;
      const m = lm.C.get(c); if (!m) continue;
      const tot = lm.tot.get(c), types = m.size, lam = tot / (tot + types);
      p = lam * ((m.get(ch) || 0) / tot) + (1 - lam) * p;
    }
    lp += Math.log(p); h += ch;
  }
  return lp;
}

// ---------------------------------------------------------------- 1. long s read as f (FIXABLE-IN-TEXT)
/**
 * A token X with a non-final f where some f→s variant Y is far more common in the ſ-keeping corpus
 * (V[Y] ≥ 5 and ≥ 15× V[X], folded). `fit`/`sit`, `fine`/`sine` (ratio < 15) are left alone on purpose. ſ never ends a word, so final f is never touched. Returns the flagged tokens.
 */
export function longS(lines, lex) {
  const toks = words(lines.join(' ')); const hits = [];
  for (const w of toks) {
    if (!/f/.test(w.slice(0, -1)) || /[A-Z]/.test(w[0]) && w === w.toUpperCase()) continue;
    const X = fold(w); const vx = lex.V.get(X) || 0;
    const pos = []; for (let i = 0; i < X.length - 1; i++) if (X[i] === 'f') pos.push(i);
    if (!pos.length || pos.length > 4) continue;
    let best = null, bv = 0;
    for (let mask = 1; mask < (1 << pos.length); mask++) {
      const a = [...X]; pos.forEach((p, j) => { if (mask & (1 << j)) a[p] = 's'; });
      const Y = a.join(''); const vy = lex.V.get(Y) || 0; if (vy > bv) { bv = vy; best = Y; }
    }
    if (bv >= 5 && bv >= 15 * Math.max(vx, 0.5)) hits.push([w, best]);
  }
  return { tokens: toks.length, hits: hits.length, examples: hits.slice(0, 5) };
}
export const longSFires = r => r.hits >= 3 && r.hits / Math.max(1, r.tokens) >= 0.01;

// ---------------------------------------------------------------- 2. facing-page bleed (FIXABLE-IN-TEXT)
const COMMON = new Set('et in ad de est non cum per quod qui quae ut sed ex a ab e se si nec vel aut tamen enim etiam'.split(' ').map(fold));
const grams = (s, k) => { const g = new Set(); for (let i = 0; i + k <= s.length; i++) g.add(s.slice(i, i + k)); return g; };
/**
 * Two shapes: (a) DUP — a contiguous block of this page's lines that are a neighbour's text (≥ 3 lines, or
 * ≥ 300 letters, each line ≥ 25 letters with ≥ 85% of its 5-grams in the neighbour); (b) EDGE — the cut-off strip of the facing page: line-leading or line-trailing
 * fragments (2–7 letters, not a common word) that are the tail / head of a neighbour's line, or a run of ≥ 6
 * consecutive ≤ 6-letter lines whose fragments match the neighbour.
 */
export function bleed(lines, nbrLines) {
  const nb = nbrLines.flat(); if (!nb.length || lines.length < 4) return { dup: 0, edge: 0, lines: lines.length };
  const nbText = fold(nb.join(' ').replace(/[^\p{L}ſ]/gu, ''));
  const nb5 = grams(nbText, 5);
  const tails = new Set(), heads = new Set(), shortTails = new Set();
  for (const l of nb) { const w = words(l).map(fold); if (!w.length) continue; const a = w[w.length - 1], b = w[0];
    for (let k = 2; k <= 7; k++) { if (a.length >= k) (k >= 3 ? tails : shortTails).add(a.slice(-k)); if (b.length >= k && k >= 3) heads.add(b.slice(0, k)); } }
  let dup = 0, dupChars = 0, run = 0, runChars = 0, edge = 0, shortRun = 0, shortMatched = 0, shortBest = 0;
  let prevHyph = false;
  for (const l of lines) {
    const f = fold(l.replace(/[^\p{L}ſ]/gu, ''));
    const contHyph = prevHyph; prevHyph = /[-¬=⸗]\s*$/.test(l);
    // a copied block, not a shared formula: lines ≥ 25 letters, ≥ 85% of their 5-grams in the neighbour, in a
    // contiguous run (index entries, figure keys and refrains repeat across pages one short line at a time)
    let isDup = false;
    if (f.length >= 25) { const g = grams(f, 5); let h = 0; for (const x of g) if (nb5.has(x)) h++; isDup = h / g.size >= 0.85; }
    if (isDup) { run++; runChars += f.length; dup = Math.max(dup, run); dupChars = Math.max(dupChars, runChars); } else { run = 0; runChars = 0; }
    const w = words(l).map(fold);
    if (w.length >= 3 && !contHyph && !/^\d/.test(l)) { // a fragment that completes the previous line's hyphen is the page's own word
      const a = w[0];
      if (a.length >= 3 && a.length <= 7 && !COMMON.has(a) && tails.has(a) && !nbText.includes(a + w[1])) edge++;
    }
    if (w.length === 1 && w[0].length >= 2 && w[0].length <= 6) { shortRun++; if (tails.has(w[0]) || shortTails.has(w[0]) || heads.has(w[0])) shortMatched++; }
    else { if (shortRun >= 6 && shortMatched >= shortRun / 2) shortBest = Math.max(shortBest, shortRun); shortRun = 0; shortMatched = 0; }
  }
  if (shortRun >= 6 && shortMatched >= shortRun / 2) shortBest = Math.max(shortBest, shortRun);
  return { dup, dupChars, edge, strip: shortBest, lines: lines.length };
}
/**
 * (c) MARGIN STRIP — the shape the by-eye check found (round 1, 5 of 7 real bleeds): the cut-off line-starts or
 * line-ends of the facing page filed as side-notes, in `<margin>` tags or after a `<column-break/>`. A real side-note
 * is a word, an abbreviation with its full stop, or a reference with digits; a strip is fragments: ≤ 2 words,
 * ≤ 10 letters, mostly ending in a hyphen or not a Latin word. Fires on ≥ 6 fragments with ≥ 50% cut, or ≥ 15 with ≥ 30% cut
 * (a verse page's strip is mostly whole first words: `Mo / Mu / Par / Eq / Pul`).
 */
export function marginStrip(text, lex) {
  const t = String(text || '');
  const pieces = [];
  for (const m of t.matchAll(/<margin[^>]*>([\s\S]*?)<\/margin>/gi)) pieces.push(...m[1].split(/\n|<br\s*\/?>|\s\/\s/i));
  const cb = t.split(/<column-break\s*\/?>/i); if (cb.length > 1) pieces.push(...cb[cb.length - 1].replace(/<margin[^>]*>[\s\S]*?<\/margin>/gi, '\n').replace(/<[a-z-]+[^>]*>[\s\S]*?<\/[a-z-]+>/gi, '\n').split(/\n|<br\s*\/?>/i));
  let frag = 0, cut = 0;
  for (const raw of pieces) {
    const l = raw.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, '').trim(); if (!l || /\d/.test(l)) continue;
    const w = words(l); if (!w.length || w.length > 2 || letters(l) > 10) continue;
    frag++;
    const last = fold(w[w.length - 1]);
    if (/[-¬=⸗]$/.test(l) || (!/\.$/.test(l) && (lex.V.get(last) || 0) < 5)) cut++;
  }
  return { frag, cut, share: frag ? cut / frag : 0 };
}
export const marginStripFires = r => (r.frag >= 6 && r.share >= 0.5) || (r.frag >= 15 && r.share >= 0.3);
// COUNTED: the margin strip and the in-body strip block. DUP and EDGE (shapes a, b) passed their planted controls
// but were 1 of 5 by eye (index entries, figure keys, German pages) — kept as diagnostics, never counted.
export const bleedFires = (r, ms) => r.strip >= 6 || (ms ? marginStripFires(ms) : false);
export const bleedDupEdgeFires = r => r.dup >= 3 || r.dupChars >= 300 || (r.edge >= 4 && r.edge / r.lines >= 0.15);

// ---------------------------------------------------------------- 3. loops / repeats (FIXABLE-IN-TEXT)
export function loops(text, lines) {
  const v = loopVerdict(text);
  const long = lines.filter(l => l.length >= 12); const uniq = new Set(long.map(fold)).size;
  return { refuse: v.refuse, share: v.share || 0, uniqRatio: long.length ? uniq / long.length : 1, longLines: long.length };
}
export const loopFires = r => r.refuse || (r.longLines >= 10 && r.uniqRatio < 0.6);

// ---------------------------------------------------------------- 4. truncation (NEEDS-RE-READ)
/** Body < 40% of the median of the text neighbours (±4 pages, each ≥ 600 letters) and the page stops mid-sentence.
 *  Only on body pages (`text`/`index`/undeclared): a dedication, title or map is short by design. */
const TRUNC_TYPES = new Set(['text', 'index', null, undefined]);
export function truncation(lines, nbrLetters, pageType = 'text') {
  const n = letters(lines.join(' ')); const nb = nbrLetters.filter(x => x >= 600).sort((a, b) => a - b);
  if (nb.length < 3 || !TRUNC_TYPES.has(pageType)) return { ratio: null, n };
  const med = nb[Math.floor(nb.length / 2)]; const last = (lines[lines.length - 1] || '').trim();
  const openEnd = !/[.!?:;)\]»”]\s*$|finis\.?$|amen\.?$/i.test(last);
  return { ratio: n / med, n, med, openEnd };
}
export const truncFires = r => r.ratio != null && r.ratio < 0.4 && r.openEnd && r.n >= 40;

// ---------------------------------------------------------------- 5. empty / refusal (NEEDS-RE-READ)
const REFUSAL = /\b(I (?:cannot|can't|am unable|'m unable)|unable to (?:transcribe|read)|as an AI|I'm sorry|no (?:readable )?text (?:is )?(?:visible|present))\b/i;
const NONTEXT_TYPES = new Set(['blank', 'illustration', 'map', 'diagram', 'frontispiece', 'cover', 'plate', 'archived-spread', 'title-page']);
export function empty(text, lines, pageType, nbrLetters) {
  const n = letters(lines.join(' ')); const nb = nbrLetters.filter(x => x != null).sort((a, b) => a - b);
  const med = nb.length ? nb[Math.floor(nb.length / 2)] : 0;
  return { n, med, refusal: REFUSAL.test(text), hasImage: /<image-desc/i.test(text), declared: pageType || null,
    nontext: NONTEXT_TYPES.has(pageType) };
}
export const emptyFires = r => r.refusal || (!r.nontext && !r.hasImage && r.n < 40 && r.med >= 800);

// ---------------------------------------------------------------- 6. column interleave (NEEDS-RE-READ; HEURISTIC)
/**
 * For each line i, score the join i→i+1 against i→i+2 under a Latin character 5-gram LM (last 12 chars of i, the
 * first 10 chars of the candidate; a trailing hyphen joins without a space). On a page read straight across two
 * columns the true continuation of i is i+2, so i→i+2 wins far more often than on a clean page.
 */
export function interleave(lines, lm, lex) {
  const raw = lines.filter(l => letters(l) >= 8);
  // (a) hyphen test — decisive where it applies: a line ending in a hyphen fragment should complete a word with the
  //     NEXT line; on a read-across it completes one with the line after that.
  let h = 0, nx = 0, sk = 0;
  for (let i = 0; i + 2 < raw.length; i++) {
    const m = raw[i].match(/([\p{L}ſ]+)[-¬=⸗]$/u); if (!m) continue; h++;
    const a = fold(m[1]), b1 = fold((raw[i + 1].match(/^[\p{L}ſ]+/u) || [''])[0]), b2 = fold((raw[i + 2].match(/^[\p{L}ſ]+/u) || [''])[0]);
    if (lex.V.get(a + b1)) nx++; if (lex.V.get(a + b2)) sk++;
  }
  // (b) char-LM join share — the fallback where a page has < 3 hyphenated line ends
  const L = raw.map(l => fold(l.replace(/[^\p{L}ſ\-¬=⸗ ]+/gu, ' ').replace(/\s+/g, ' ').trim()));
  let share = null;
  if (L.length >= 14) {
    const join = (a, b) => { const hy = /[-¬=⸗]$/.test(a); const ctx = ' ' + a.replace(/[-¬=⸗]$/, '').slice(-12); return lmScore(lm, ctx, (hy ? '' : ' ') + b.replace(/[-¬=⸗]/g, '').slice(0, 10)); };
    let win = 0, n = 0;
    for (let i = 0; i + 2 < L.length; i++) { const s1 = join(L[i], L[i + 1]), s2 = join(L[i], L[i + 2]); if (s2 > s1 + 1) win++; n++; }
    share = win / n;
  }
  return { n: L.length, hyph: h, hyphNext: nx, hyphSkip: sk, share, path: h >= 3 ? 'hyphen' : share != null ? 'lm' : 'n/a' };
}
export const INTERLEAVE_T = { share: 0.5 }; // set by controls.mjs from the clean-page distribution, see there
// Only the hyphen path is COUNTED: the LM path failed its gate (controls.json: 26% of planted read-across, 6% of
// clean pages), so it is kept as a diagnostic (`lmFires`) and never enters a census rate.
export const interleaveFires = r => r.path === 'hyphen' && r.hyphSkip >= 2 && r.hyphSkip > r.hyphNext;
export const interleaveLmFires = r => r.share != null && r.share >= INTERLEAVE_T.share;

export const CLASS = { long_s: 'FIXABLE', bleed: 'FIXABLE', loop: 'FIXABLE', interleave: 'REREAD', truncation: 'REREAD', empty: 'REREAD' };
