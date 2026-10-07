// PRIOR ART: tengyur-characterize/common.mjs `verseShare` (the same 7/9/11-syllable run heuristic, but it returns a
// share, not the lines). No helper in scripts/lib/ splits Tibetan verse into pādas or finds an English verse block.
// Helpers for #6141's verse-consistency detector: Tibetan verse pādas and the English verse blocks that render them.

export const METRES = new Set([7, 9, 11]);

// The Esukhia e-text's markup out: {D####} text marks, {a,b} / (a,b) variant pairs (first reading kept), #, arrows.
export function cleanBo(s) {
  return s.replace(/\{D\d+[a-zA-Z]?\}/g, '').replace(/\{([^,}]*),[^}]*\}/g, '$1').replace(/\(([^,)]*),[^)]*\)/g, '$1')
    .replace(/->|<-/g, '').replace(/[#\[\]{}()]/g, '').replace(/\r?\n/g, '');
}
export function syls(seg) { return seg.split(/[་༌\s]+/).map((x) => x.replace(/[^ཀ-ྼ]/g, '')).filter(Boolean); }

/** Verse runs: maximal runs of >= 2 consecutive shad-delimited segments of equal length (7, 9 or 11 syllables).
 *  `edge` marks a run touching the first or last segment of the page (it may be cut by the page turn). */
export function verseRuns(bo) {
  const segs = cleanBo(bo).split(/[།༎༑]+/).map((s) => syls(s)).filter((x) => x.length);
  const runs = [];
  for (let i = 0; i < segs.length;) {
    const L = segs[i].length; let j = i + 1;
    if (METRES.has(L)) while (j < segs.length && segs[j].length === L) j++;
    if (METRES.has(L) && j - i >= 2) runs.push({ start: i, end: j, rel: i / segs.length, edge: i === 0 || j === segs.length, padas: segs.slice(i, j).map((s) => s.join('་')) });
    i = j;
  }
  return runs;
}

const WRAPPER = /<(summary|keywords|meta|vocab)\b/;
/** English verse blocks in the STORED text: paragraphs of >= 2 short lines, outside the editorial wrappers.
 *  Each line carries its offsets into `en`, so a span can be replaced in place. */
export function verseBlocks(en) {
  const out = [];
  const re = /\n\s*\n/g; let start = 0; const paras = [];
  for (let m; (m = re.exec(en));) { paras.push([start, m.index]); start = m.index + m[0].length; }
  paras.push([start, en.length]);
  const body = paras.filter(([a, b]) => en.slice(a, b).trim());
  const total = en.length || 1;
  for (const [a, b] of body) {
    const para = en.slice(a, b);
    if (WRAPPER.test(para)) continue;
    const lines = []; let off = a;
    for (const ln of para.split('\n')) { if (ln.trim()) lines.push({ a: off, b: off + ln.length, text: ln }); off += ln.length + 1; }
    if (lines.length < 2 || lines.some((x) => x.text.trim().length >= 160 || /^\s*(#|[-*]\s|\d+\.\s)/.test(x.text))) continue;
    out.push({ a: lines[0].a, b: lines[lines.length - 1].b, rel: a / total, lines });
  }
  return out;
}

/** Monotone run↔block alignment. A pair needs |lines − pādas| ≤ 1 and relative positions within 0.35; an exact
 *  line count scores higher. Returns Map(runIndex → blockIndex). */
export function alignRunsToBlocks(runs, blocks) {
  const R = runs.length, B = blocks.length;
  const sc = (r, b) => {
    const d = Math.abs(blocks[b].lines.length - runs[r].padas.length), dp = Math.abs(blocks[b].rel - runs[r].rel);
    if (d > 1 || dp > 0.35) return 0;
    return (d === 0 ? 2 : 1) - dp;
  };
  const D = Array.from({ length: R + 1 }, () => new Float64Array(B + 1));
  for (let i = 1; i <= R; i++) for (let j = 1; j <= B; j++) {
    const s = sc(i - 1, j - 1);
    D[i][j] = Math.max(D[i - 1][j], D[i][j - 1], s > 0 ? D[i - 1][j - 1] + s : -1);
  }
  const m = new Map();
  for (let i = R, j = B; i > 0 && j > 0;) {
    const s = sc(i - 1, j - 1);
    if (s > 0 && Math.abs(D[i][j] - (D[i - 1][j - 1] + s)) < 1e-9) { m.set(i - 1, j - 1); i--; j--; }
    else if (D[i][j] === D[i - 1][j]) i--; else j--;
  }
  return m;
}

/** What an English rendering says, for comparison: notes out, tags out, lower case, letters only. */
export function normEn(s) {
  return s.replace(/<note\b[^>]*>[\s\S]*?<\/note>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/->|<-/g, ' ')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function grams(s) { const m = new Map(); const t = ` ${s} `; for (let i = 0; i + 3 <= t.length; i++) { const g = t.slice(i, i + 3); m.set(g, (m.get(g) || 0) + 1); } return m; }
export function dice(a, b) {
  const A = grams(a), B = grams(b); let inter = 0, na = 0, nb = 0;
  for (const v of A.values()) na += v; for (const v of B.values()) nb += v;
  for (const [g, v] of A) if (B.has(g)) inter += Math.min(v, B.get(g));
  return na + nb ? (2 * inter) / (na + nb) : 1;
}
