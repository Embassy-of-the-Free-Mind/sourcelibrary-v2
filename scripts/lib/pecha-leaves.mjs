// PRIOR ART: scripts/eval/split-leaf-5771/gaps.mjs — the cloth-gap idea (rows dark across the middle of the frame are
// the cloth between leaves), but it rebuilds frames from ledger crops, thresholds mean row luminance and so reads the
// EAP310 colour card between two leaves as a third leaf. scripts/split-pecha.mjs rowBrightness()/darkestRow() snap a
// model's box to the darkest row; they propose no leaves themselves. scripts/lib/leaf-break.mjs counts the read's
// `<leaf-break/>` (imported by the driver, not here). Nothing tells a recto frame from a verso frame.
/**
 * pecha-leaves — find the loose pecha leaves on an EAP photo, and tell a recto from a verso. $0, no model.
 *
 * LEAVES. EAP photographs lay 2–6 leaves on a blue/grey cloth, one above another. A pixel is PAPER when its score
 * L + 2·(R−B) is above the frame's Otsu threshold (the cloth is darker AND bluer than any paper). On a copy 300 px wide
 * (text strokes average into the paper there), a row is a LEAF ROW when paper covers more than half of it. A leaf is a
 * run of leaf rows at least 40% as tall as the tallest run; shorter runs are tape, a colour card's edge or pins. The cut
 * between two leaves is the row of the gap with the least paper (then the darkest), never a row with text on it.
 *
 * RECTO. On a recto the folio label (volume letter + number) is written LEFT of the left red margin rule; a verso has
 * nothing there. rectoInk() finds the rule (the column, in the leaf's left quarter, with the most red pixels) and
 * measures the share of ink pixels between the leaf's left edge and the rule.
 */
import sharp from 'sharp';

const WORK_W = 300;

function otsu(values) {
  let lo = Infinity, hi = -Infinity; for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const bins = 256, hist = new Array(bins).fill(0), w = (hi - lo) / bins || 1;
  for (const v of values) hist[Math.min(bins - 1, Math.floor((v - lo) / w))]++;
  const n = values.length;
  let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, t = 0;
  for (let i = 0; i < bins; i++) {
    wB += hist[i]; if (!wB) continue;
    const wF = n - wB; if (!wF) break;
    sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  return lo + (t + 0.5) * w;
}

/**
 * Leaves on one frame.
 * @returns {{W,H, leaves:[{left,top,width,height, run:[y0,y1]}], cuts:number[], flags:string[], profile:number[]}}
 *   coordinates in full-resolution pixels. flags: 'tall-run' (a run ≥1.6× the median: two leaves touching),
 *   'cut-on-paper' (the best cut row still has paper across it), 'no-leaf'.
 */
async function frameScore(buf) {
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  const { data, info } = await sharp(buf).resize({ width: WORK_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, k = W / w;
  const score = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[3 * i], g = data[3 * i + 1], b = data[3 * i + 2];
    score[i] = (r + g + b) / 3 + 2 * (r - b);
  }
  const thr = otsu(score);
  const paper = (x, y) => score[y * w + x] > thr;
  const x0 = Math.round(0.03 * w), x1 = Math.round(0.97 * w);
  const raw = [];
  for (let y = 0; y < h; y++) { let n = 0; for (let x = x0; x < x1; x++) if (paper(x, y)) n++; raw.push(n / (x1 - x0)); }
  const rowMean = (y) => { let s = 0; for (let x = x0; x < x1; x++) s += score[y * w + x]; return s / (x1 - x0); };
  return { W, H, w, h, k, score, thr, paper, raw, rowMean };
}

/** The row in [a,b) with the least paper (then the darkest), in work-copy rows. */
function bestCut(F, a, b) {
  let best = a, bv = Infinity;
  for (let y = Math.max(0, a); y < Math.min(F.h, b); y++) { const v = F.raw[y] * 1000 + F.rowMean(y) / 1000; if (v < bv) { bv = v; best = y; } }
  return best;
}

/**
 * Columns of one leaf that are paper over most of its rows (col[x] = share of the leaf's rows that are paper).
 * `best` is the widest run: the ink measures (rectoInk, inkOnset) start from it. `span` is the run joined with every
 * neighbouring run across a gap of at most BRIDGE_COLS of the width: the box is cut on it. A printed text block has a
 * black border line, which no column of paper crosses; the widest run then stopped at the border, and the margin
 * beyond it, with the folio label, was cut off (69e7883a…, frames 55, 82, 141: paper from x≈20, box from x≈105).
 * Cloth beyond a leaf's end is wider than the bridge.
 */
export const BRIDGE_COLS = 0.02;
export function paperColumns(col, thr = 0.5) {
  const runs = []; let s0 = null;
  col.forEach((v, x) => { if (v > thr && s0 == null) s0 = x; if ((v <= thr || x === col.length - 1) && s0 != null) { runs.push([s0, v > thr ? x + 1 : x]); s0 = null; } });
  if (!runs.length) return { best: [0, col.length], span: [0, col.length] };
  let bi = 0; runs.forEach((r, i) => { if (r[1] - r[0] > runs[bi][1] - runs[bi][0]) bi = i; });
  const gap = Math.max(1, Math.round(BRIDGE_COLS * col.length));
  let i0 = bi, i1 = bi;
  while (i0 > 0 && runs[i0][0] - runs[i0 - 1][1] <= gap) i0--;
  while (i1 < runs.length - 1 && runs[i1 + 1][0] - runs[i1][1] <= gap) i1++;
  return { best: runs[bi], span: [runs[i0][0], runs[i1][1]] };
}

/**
 * Leaves from runs [a,b) (work rows) and cuts (full-res px) between them. A leaf runs from cut to cut, and the outer
 * leaves to `outer` ([top, bottom] full-res px): the paper run of a leaf can start or end inside it (a darker or
 * shadowed band of grey paper falls under the threshold), and a box drawn on the run then drops its first or last
 * line of text (69e77a14…, frames 70 and 73). Extra cloth in a crop costs nothing; a dropped line costs the text.
 */
function buildLeaves(F, spans, cuts, outer = [0, F.H]) {
  const { W, w, k, paper } = F;
  return spans.map(([a, b], i) => {
    const top = i === 0 ? Math.max(0, Math.min(outer[0], Math.round(a * k))) : cuts[i - 1];
    const bot = i === spans.length - 1 ? Math.min(F.H, Math.max(outer[1], Math.round(b * k))) : cuts[i];
    // x extent: the columns that are paper over most of this leaf's rows, joined across a border line (paperColumns)
    const col = [];
    for (let x = 0; x < w; x++) { let n = 0; for (let y = a; y < b; y++) if (paper(x, y)) n++; col.push(n / Math.max(1, b - a)); }
    const { best: bestRun, span } = paperColumns(col);
    const mx = Math.round(0.015 * W);
    const left = Math.max(0, Math.round(span[0] * k) - mx), right = Math.min(W, Math.round(span[1] * k) + mx);
    return { left, top, width: right - left, height: bot - top, run: [Math.round(a * k), Math.round(b * k)], paper_x: [Math.round(bestRun[0] * k), Math.round(bestRun[1] * k)], thr: F.thr };
  });
}

/**
 * Two leaves touching with no cloth between them make one run about twice a leaf's height. Measured against the LOWER
 * median: with two runs the upper median is the tall run itself, so a title leaf merged into its neighbour on a
 * two-run frame passed (6a370228…fbd3, frame 1: runs 266 and 537 px, Opus review, wave 1).
 */
export function tallRun(heights) {
  if (heights.length < 2) return false;
  const h = [...heights].sort((a, b) => a - b), med = h[(h.length - 1) >> 1];
  return h[h.length - 1] >= 1.6 * med;
}
/**
 * An outer leaf cut at a run of paper beyond it (a tape, a colour card) that is much shorter than every other leaf: the
 * run beyond can be the leaf's own lower part, under a dark band of dense writing, and the box then stops inside the
 * leaf and drops its last lines (69e7883f…, frames 6/12/14/16; 69e78842…, frames 20/41; 6a370224…, frame 92; the review
 * caught the first). Flagged, the frame goes to agy, whose outer box sets the bound. Of 12 such frames by eye, 6 had
 * lost lines and 6 stopped at a tape; for those, agy's box agrees.
 */
export const SHORT_OUTER = 0.75;
export function shortOuter(heights, above, below) {
  const n = heights.length;
  if (n < 2) return false;
  return (below && heights[n - 1] < SHORT_OUTER * Math.min(...heights.slice(0, n - 1))) || (above && heights[0] < SHORT_OUTER * Math.min(...heights.slice(1)));
}
export const MERGE_DIP = 0.25;
export async function findLeaves(buf) {
  const F = await frameScore(buf);
  const { W, H, h, raw } = F;
  const profile = raw.map((_, i) => (raw[i - 1] ?? raw[i]) / 4 + raw[i] / 2 + (raw[i + 1] ?? raw[i]) / 4);
  const runs = []; let st = null;
  profile.forEach((v, y) => { if (v > 0.5 && st == null) st = y; if ((v <= 0.5 || y === h - 1) && st != null) { runs.push([st, v > 0.5 ? y + 1 : y]); st = null; } });
  // a dense line of text can pull a row of a leaf under 0.5 (69e77a14…, frame 70: 0.49); the cloth between two leaves
  // falls to ~0.1 or less. Runs whose dip between them stays above MERGE_DIP are one leaf.
  for (let i = runs.length - 2; i >= 0; i--) {
    let lo = Infinity; for (let y = runs[i][1]; y < runs[i + 1][0]; y++) lo = Math.min(lo, profile[y]);
    if (lo > MERGE_DIP) runs.splice(i, 2, [runs[i][0], runs[i + 1][1]]);
  }
  const tallest = Math.max(0, ...runs.map(([a, b]) => b - a));
  const kept = runs.filter(([a, b]) => b - a >= 0.4 * tallest && b - a >= 0.04 * h);
  const flags = [];
  if (!kept.length) return { W, H, leaves: [], cuts: [], flags: ['no-leaf'], profile };
  if (tallRun(kept.map(([a, b]) => b - a))) flags.push('tall-run');
  if (kept.length === 1 && (kept[0][1] - kept[0][0]) > 0.55 * h && W / H < 1.8) flags.push('tall-run');
  // cuts: in each gap, the row with the least paper; ties broken by the darkest mean score
  const cutsW = [];
  for (let i = 0; i < kept.length - 1; i++) {
    const best = bestCut(F, kept[i][1], kept[i + 1][0]);
    if (raw[best] > 0.25) flags.push('cut-on-paper');
    cutsW.push(best);
  }
  const cuts = cutsW.map((y) => Math.round((y + 0.5) * F.k));
  // outer bounds: the frame's edge, or the cut between the outer leaf and a short run beyond it (tape, colour card)
  const above = runs.filter(([, b]) => b <= kept[0][0]).pop(), below = runs.find(([a]) => a >= kept[kept.length - 1][1]);
  const outer = [above ? Math.round((bestCut(F, above[1], kept[0][0]) + 0.5) * F.k) : 0,
    below ? Math.round((bestCut(F, kept[kept.length - 1][1], below[0]) + 0.5) * F.k) : H];
  // x extent: the union over the frame's leaves. One end of a leaf can be darker than the paper threshold, and its own
  // paper run then stops short of its last characters (69e7ac45…, frame 31); leaves on a frame lie one above another.
  const ls = buildLeaves(F, kept, cuts, outer);
  if (shortOuter(ls.map((l) => l.height), !!above, !!below)) flags.push('short-outer');
  const L = Math.min(...ls.map((l) => l.left)), R = Math.max(...ls.map((l) => l.left + l.width));
  return { W, H, leaves: ls.map((l) => ({ ...l, left: L, width: R - L })), cuts, flags, profile };
}

/** Share of dark (ink) pixels per row of a copy INK_W wide, over the middle 76% of the width. */
const INK_W = 1000;
/**
 * Luminance copy INK_W wide, with the BLUE pixels marked: the cloth and the measuring tape. Ink is black or brown and
 * paper grey to warm (blue − red ≤ 20), the cloth and the tape are blue or teal (blue − red 40–80); on an underexposed
 * frame with grey paper the cloth is as dark as ink, and the tape's teal as bright as paper (EAP310, 6a370224…).
 */
export const BLUE_MIN = 28;
async function lumCopy(buf) {
  const { data, info } = await sharp(buf).resize({ width: INK_W }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, lum = new Float32Array(w * h), blue = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[3 * i], g = data[3 * i + 1], b = data[3 * i + 2];
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b; blue[i] = b - r >= BLUE_MIN ? 1 : 0;
  }
  const vals = []; for (let y = 0; y < h; y += 3) for (let x = Math.round(0.12 * w); x < 0.88 * w; x += 3) if (!blue[y * w + x]) vals.push(lum[y * w + x]);
  vals.sort((p, q) => p - q);
  return { w, h, lum, blue, paperL: vals[Math.floor(vals.length * 0.75)] ?? 255 };
}
async function inkRows(buf) {
  const { w, h, lum, blue, paperL } = await lumCopy(buf);
  const x0 = Math.round(0.12 * w), x1 = Math.round(0.88 * w);
  const ink = []; for (let y = 0; y < h; y++) { let n = 0; for (let x = x0; x < x1; x++) { const i = y * w + x; if (!blue[i] && lum[i] < 0.55 * paperL) n++; } ink.push(n / (x1 - x0)); }
  return { ink, h };
}

/**
 * Leaves from a model's boxes ([ymin,xmin,ymax,xmax], 0–1000, top to bottom), snapped to the frame. Between two boxes
 * the cut goes through the BLANK BAND between the last text line of one leaf and the first of the next: within the
 * boxes' seam zone (±4% of the height) the rows with ink on under 0.8% of the width, the longest run of them, and in it
 * the row with the least paper (the cloth or the shadow where the leaves meet). Text rows carry 4–11% ink, blank
 * margin rows 0–0.5% (measured on EAP039 frames whose leaves overlap). Leaves that overlap on a slant cannot be cut
 * apart by a straight line; the crop then keeps a sliver of the neighbour's blank margin, never its text.
 * flags: 'seam-on-text' when no blank row exists in the zone, 'thin' when a leaf is under 6% of the height.
 * @returns {{W,H,leaves,cuts,flags,seam_ink:number[]}}
 */
export const SEAM_BLANK = 0.008;
export const CLOTH_GAP = 0.3;
// A paper dip: a row with CLOTH_DIP less paper than the zone's fullest row; its extent is the rows CLOTH_DIP_EDGE below it.
// Text rows on grey paper read ~0.1 under the fullest row, so 0.25 does not fire on a line of writing.
export const CLOTH_DIP = 0.25, CLOTH_DIP_EDGE = 0.2;
// A dense line of writing also reads as low paper. When it is the seam zone's first or last row, its "dip" touches the
// zone's edge and its middle is the line itself (69e782bc…, frame 54: the bottom leaf's first line cut, seam_ink 0.53).
// Cloth between leaves lies inside the zone (3-45 rows of a 667-750 row copy), so a dip that touches the zone's edge is
// treated as not cloth: 265 seams in waves 3-4 moved, 12 of 12 sampled better or equal by eye. A minimum height was
// tried and rejected: it dropped good thin cloth dips.
/**
 * [first, last] row of the paper dip in rows [a,b) of paperAt(y), or null when there is none or when it touches row a
 * or row b-1.
 */
export function paperDip(paperAt, a, b) {
  let mx = 0, mn = Infinity, my = -1;
  for (let y = a; y < b; y++) { const v = paperAt(y); if (v > mx) mx = v; if (v < mn) { mn = v; my = y; } }
  if (my < 0 || mn >= mx - CLOTH_DIP) return null;
  let d0 = my, d1 = my;
  while (d0 > a && paperAt(d0 - 1) < mx - CLOTH_DIP_EDGE) d0--;
  while (d1 < b - 1 && paperAt(d1 + 1) < mx - CLOTH_DIP_EDGE) d1++;
  if (d0 <= a || d1 >= b - 1) return null;
  return [d0, d1];
}
export async function snapBoxes(buf, boxes) {
  const F = await frameScore(buf);
  const { W, H, h, raw } = F;
  const I = await inkRows(buf);
  boxes = [...boxes].sort((p, q) => p[0] - q[0]);
  const bx = boxes.map((b) => [b[0] / 1000, b[2] / 1000]);
  const flags = []; const cuts = []; const seam = [];
  for (let i = 0; i < bx.length - 1; i++) {
    const lo = Math.max(bx[i][0] + 0.02, Math.min(bx[i][1], bx[i + 1][0]) - 0.04), hi = Math.min(bx[i + 1][1] - 0.02, Math.max(bx[i][1], bx[i + 1][0]) + 0.04);
    const a = Math.round(lo * I.h), b = Math.round(hi * I.h);
    const rawAt = (y) => raw[Math.min(h - 1, Math.floor((y + 0.5) / I.h * h))];
    // a cloth gap in the zone (paper on under CLOTH_GAP of the row): cut there, at the row with the least paper nearest
    // the zone's middle. Dark cloth reads as ink, so the blank-band rule would otherwise cut in a leaf's margin, on the
    // row touching its last line (69e76168…, frame 79).
    { let m = -1, mv = Infinity; const mid = (a + b) / 2;
      for (let y = a; y < b; y++) { const v = rawAt(y) + Math.abs(y - mid) / I.h / 100; if (rawAt(y) < CLOTH_GAP && v < mv) { mv = v; m = y; } }
      if (m >= 0) { seam.push(0); cuts.push(Math.round((m + 0.5) / I.h * H)); continue; } }
    // No row under CLOTH_GAP, but a clear dip in paper: the cloth between slanted or pinned leaves never reads as empty
    // (0.5-0.7 paper), and dark cloth reads as ink, so the blank-run rule below would cut on the blank row BETWEEN TWO LINES
    // of text (69e77aa8…, frames 54, 68, 71: the first or last line of a leaf cut). Cut at the middle of the dip, not at
    // its lowest row: with slanted leaves the lowest row can sit on the next leaf's first line.
    { const d = paperDip(rawAt, a, b);
      if (d) { const m = Math.round((d[0] + d[1]) / 2); seam.push(+I.ink[m].toFixed(3)); cuts.push(Math.round((m + 0.5) / I.h * H)); continue; } }
    let run = null, cur = null;
    for (let y = a; y <= b; y++) {
      if (y < b && I.ink[y] <= SEAM_BLANK) { if (!cur) cur = [y, y]; cur[1] = y; }
      else if (cur) { if (!run || cur[1] - cur[0] > run[1] - run[0]) run = cur; cur = null; }
    }
    if (!run) {
      flags.push('seam-on-text');
      let m = a; for (let y = a; y < b; y++) if (I.ink[y] < I.ink[m]) m = y;
      seam.push(+I.ink[m].toFixed(3)); cuts.push(Math.round((m + 0.5) / I.h * H)); continue;
    }
    // inside the blank run, kept clear of its ends (the rows next to a line of text), the row with the least paper
    // (the shadow where two leaves meet), else its middle
    let best = Math.round((run[0] + run[1]) / 2), bv = Infinity;
    const pad = Math.min(3, Math.floor((run[1] - run[0]) / 3));
    for (let y = run[0] + pad; y <= run[1] - pad; y++) { const wy = Math.min(h - 1, Math.floor((y + 0.5) / I.h * h)); const v = raw[wy] * 1000 + Math.abs(y - (run[0] + run[1]) / 2) / 1000; if (v < bv) { bv = v; best = y; } }
    seam.push(+I.ink[best].toFixed(3)); cuts.push(Math.round((best + 0.5) / I.h * H));
  }
  const toW = (px) => Math.round(px / H * h);
  const spans = bx.map(([t, b], i) => [i === 0 ? Math.round(t * h) : toW(cuts[i - 1]) + 1, i === bx.length - 1 ? Math.round(b * h) : toW(cuts[i])]);
  if (spans.some(([p, q]) => q - p < 0.06 * h)) flags.push('thin');
  // x extent: the union of the paper run and the model's own box (a pale or stained leaf can fall under the frame's
  // paper threshold over part of its width, and the paper run then drops that part of its text; seen on EAP039).
  const mx = Math.round(0.015 * W);
  // outer bounds: the model's outer boxes with 3% of the height to spare
  const outer = [Math.max(0, Math.round((bx[0][0] - 0.03) * H)), Math.min(H, Math.round((bx[bx.length - 1][1] + 0.03) * H))];
  const leaves = buildLeaves(F, spans, cuts, outer).map((l, i) => {
    const left = Math.max(0, Math.min(l.left, Math.round((boxes[i][1] / 1000) * W) - mx));
    const right = Math.min(W, Math.max(l.left + l.width, Math.round((boxes[i][3] / 1000) * W) + mx));
    return { ...l, left, width: right - left };
  });
  return { W, H, leaves, cuts, flags: [...new Set(flags)], seam_ink: seam };
}

/**
 * Text left or right of a leaf's box: for each leaf, the share of dark pixels (under 45% of the paper level: ink, not
 * cloth or shadow) in the columns outside the box, over the leaf's middle rows, in 2%-wide bands. Returns the largest
 * band share per leaf, counting only bands that are at least 40% paper (text sits on paper; cloth and the photo's
 * dark border do not). Blue pixels (cloth, tape; lumCopy) are neither ink nor paper.
 */
export async function inkOutside(buf, leaves) {
  const { w, lum, blue, paperL } = await lumCopy(buf);
  const meta = await sharp(buf).metadata(), k = w / meta.width, thr = 0.45 * paperL, paperT = 0.75 * paperL;
  const bw = Math.max(4, Math.round(0.02 * w));
  return leaves.map((l) => {
    const y0 = Math.round((l.top + 0.2 * l.height) * k), y1 = Math.round((l.top + 0.8 * l.height) * k);
    const L = Math.round(l.left * k), R = Math.round((l.left + l.width) * k);
    let worst = 0;
    // bands in the outer 6% of the frame are skipped: the measuring tape lies there, paper-white with dark numbers
    for (const [a, b] of [[Math.round(0.06 * w), L], [R, Math.round(0.94 * w)]]) for (let x = a; x + bw <= b; x += bw) {
      let n = 0, pp = 0, t = 0; for (let y = y0; y < y1; y++) for (let xx = x; xx < x + bw; xx++) { t++; const i = y * w + xx; if (blue[i]) continue; const v = lum[i]; if (v < thr) n++; else if (v > paperT) pp++; }
      if (t && pp / t >= 0.4) worst = Math.max(worst, n / t); // text sits on paper; cloth and the photo's border do not
    }
    return +worst.toFixed(3);
  });
}

/**
 * Ink in the left margin of one leaf, left of its margin rule (a recto carries its folio label there).
 *
 * Work copy: the leaf's rows, ≤1600 px wide. Paper and redness levels are this leaf's own (warm EAP310 paper, grey
 * pilot paper, underexposed EAP039 frames all differ). The PAPER EDGE is the first column that is paper (frame Otsu
 * score) on ≥60% of rows — so a measuring tape or cloth left of the leaf is never margin. THE RULE, in order:
 *   1. red: the leftmost column (left 35% of the leaf) with a red pixel within ±2 columns on ≥25% of rows;
 *   2. faint: the leftmost column holding a vertical run of faintly dark or red pixels ≥45% of the text height
 *      (gaps of ≤2 rows bridged) — text and labels never run that long;
 *   3. gap: no rule; the text block is the first run of covered columns ≥8% of the leaf wide, split from the margin
 *      by a blank gap ≥0.8% (misses a label that touches the text, so it can only under-call a recto).
 * A rule candidate is refused when there is no blank paper between it and the edge (the edge's own shadow) or a
 * text-wide run of ink lies left of it (red ink inside the text). Score = Σ over margin columns of their ink coverage
 * (dark, not red, within ±2 columns) ÷ leaf width: a label scores ~1e-3, blank paper ~0.
 * @param leaf one entry of findLeaves().leaves (carries the frame's paper threshold)
 * @returns {{ink:number|null, rule:number|null, by:'red'|'faint'|'gap'|null}} rule in full-res px.
 */
export async function rectoInk(buf, leaf) {
  const [px0, px1] = leaf.paper_x, [ry0, ry1] = leaf.run;
  const ex0 = Math.max(0, px0 - Math.round(0.02 * (px1 - px0)));
  const lw = px1 - ex0, lh = ry1 - ry0;
  const scale = Math.min(1, 1600 / lw);
  const bw = Math.max(8, Math.round(lw * scale)), bh = Math.max(8, Math.round(lh * scale));
  const { data } = await sharp(buf).extract({ left: ex0, top: ry0, width: lw, height: lh }).resize({ width: bw, height: bh, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = (x, y) => { const i = 3 * (y * bw + x); return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  const red = (x, y) => { const i = 3 * (y * bw + x); return data[i] - (data[i + 1] + data[i + 2]) / 2; };
  const sc = (x, y) => { const i = 3 * (y * bw + x); return (data[i] + data[i + 1] + data[i + 2]) / 3 + 2 * (data[i] - data[i + 2]); };
  const yA = Math.round(0.08 * bh), yB = Math.round(0.92 * bh), H2 = yB - yA;
  // paper edge
  let edge = 0;
  for (let x = 0; x < 0.3 * bw; x++) { let n = 0; for (let y = yA; y < yB; y += 2) if (sc(x, y) > leaf.thr) n++; if (n / Math.ceil(H2 / 2) >= 0.6) { edge = x; break; } }
  const ls = [], rs = []; for (let y = yA; y < yB; y += 3) for (let x = edge; x < bw; x += 3) { ls.push(L(x, y)); rs.push(red(x, y)); }
  ls.sort((a, b) => a - b); rs.sort((a, b) => a - b);
  const paperL = ls[Math.floor(ls.length * 0.7)], redCut = rs[Math.floor(rs.length / 2)] + 14;
  const dark = new Uint8Array(bw * bh), redm = new Uint8Array(bw * bh);
  for (let y = yA; y < yB; y++) for (let x = 0; x < bw; x++) { const r = red(x, y) > redCut; redm[y * bw + x] = r ? 1 : 0; dark[y * bw + x] = !r && L(x, y) < paperL * 0.62 ? 1 : 0; }
  const ink = new Float32Array(bw), mark = new Float32Array(bw), redc = new Float32Array(bw);
  for (let x = 0; x < bw; x++) {
    let d = 0, m = 0, r = 0;
    for (let y = yA; y < yB; y++) {
      let dd = 0, rr = 0;
      for (let k = -2; k <= 2; k++) { const xx = x + k; if (xx < 0 || xx >= bw) continue; dd |= dark[y * bw + xx]; rr |= redm[y * bw + xx]; }
      d += dd; r += rr; m += dd | rr;
    }
    ink[x] = d / H2; mark[x] = m / H2; redc[x] = r / H2;
  }
  const x0 = edge + Math.round(0.015 * bw), xEnd = Math.min(bw - 2, edge + Math.round(0.35 * bw));
  const gapMin = Math.max(2, Math.round(0.008 * bw));
  const segs = []; { let st = null, gap = 0;
    for (let x = x0; x < bw; x++) {
      if (mark[x] >= 0.03) { if (st == null) st = x; gap = 0; }
      else if (st != null && ++gap >= gapMin) { segs.push([st, x - gap + 1]); st = null; gap = 0; }
    }
    if (st != null) segs.push([st, bw]); }
  const ok = (x) => {
    let blank = 0; for (let k = x0; k < x - 2; k++) if (mark[k] < 0.03) blank++;
    return blank >= 0.004 * bw && !segs.some(([a, b]) => b <= x - 2 && b - a >= 0.08 * bw);
  };
  const score = (xb) => { let s = 0; for (let x = x0; x < xb; x++) s += ink[x]; return +(s / bw).toFixed(5); };
  const out = (x, by) => ({ ink: score(x - Math.max(2, Math.round(0.004 * bw))), rule: Math.round(ex0 + x / scale), by });
  for (let x = x0; x < xEnd; x++) if (redc[x] >= 0.25 && ok(x)) return out(x, 'red');
  const faint = (x, y) => L(x, y) < paperL * 0.85 || red(x, y) > redCut - 6;
  for (let x = Math.max(1, x0); x < xEnd; x++) {
    let run = 0, best = 0, miss = 0;
    for (let y = yA; y < yB; y++) {
      if (faint(x - 1, y) || faint(x, y) || faint(x + 1, y)) { run += 1 + miss; miss = 0; if (run > best) best = run; }
      else if (++miss > 2) { run = 0; miss = 0; }
    }
    if (best >= 0.45 * H2 && ok(x)) return out(x, 'faint');
  }
  const ti = segs.findIndex(([a, b]) => b - a >= 0.08 * bw);
  if (ti < 0) return { ink: null, rule: null, by: null };
  let sum = 0;
  for (const [a, b] of segs.slice(0, ti)) {
    let peak = 0; for (let x = a; x < b; x++) peak = Math.max(peak, mark[x]);
    if (b - a <= 0.012 * bw && peak >= 0.5) continue; // a rule standing apart from the text
    for (let x = a; x < b; x++) sum += ink[x];
  }
  return { ink: +(sum / bw).toFixed(5), rule: Math.round(ex0 + segs[ti][0] / scale), by: 'gap' };
}

/**
 * Ink onset of one leaf: where ink begins, as a share of the leaf width from its paper edge. No rule needed: on a
 * recto the first ink is the folio label, on a verso it is the text, which starts further right. A column counts as
 * inked when ≥4% of the leaf's text rows hold an ink pixel within ±2 columns, for 0.4% of the width without a break.
 * Frames are compared WITHIN a book (orderBook), since margins differ between manuscripts.
 * @returns {number|null}
 */
export async function inkOnset(buf, leaf) {
  const [px0, px1] = leaf.paper_x, [ry0, ry1] = leaf.run;
  const ex0 = Math.max(0, px0 - Math.round(0.02 * (px1 - px0)));
  const lw = px1 - ex0, lh = ry1 - ry0;
  const bw = Math.min(800, lw), bh = Math.max(8, Math.round(lh * bw / lw));
  const { data } = await sharp(buf).extract({ left: ex0, top: ry0, width: lw, height: lh }).resize({ width: bw, height: bh, fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const L = (x, y) => { const i = 3 * (y * bw + x); return (data[i] + data[i + 1] + data[i + 2]) / 3; };
  const sc = (x, y) => { const i = 3 * (y * bw + x); return (data[i] + data[i + 1] + data[i + 2]) / 3 + 2 * (data[i] - data[i + 2]); };
  const red = (x, y) => { const i = 3 * (y * bw + x); return data[i] - (data[i + 1] + data[i + 2]) / 2; };
  const yA = Math.round(0.08 * bh), yB = Math.round(0.92 * bh), H2 = yB - yA;
  let edge = null;
  for (let x = 0; x < 0.3 * bw; x++) { let n = 0; for (let y = yA; y < yB; y += 2) if (sc(x, y) > leaf.thr) n++; if (n / Math.ceil(H2 / 2) >= 0.6) { edge = x; break; } }
  if (edge == null) return null;
  const ls = [], rs = []; for (let y = yA; y < yB; y += 3) for (let x = edge; x < bw; x += 3) { ls.push(L(x, y)); rs.push(red(x, y)); }
  ls.sort((a, b) => a - b); rs.sort((a, b) => a - b);
  const paperL = ls[Math.floor(ls.length * 0.7)], redCut = rs[Math.floor(rs.length / 2)] + 14;
  const cov = new Float32Array(bw);
  for (let x = 0; x < bw; x++) { let n = 0; for (let y = yA; y < yB; y++) { let d = 0; for (let k = -2; k <= 2 && !d; k++) { const xx = x + k; if (xx >= 0 && xx < bw && L(xx, y) < paperL * 0.62 && red(xx, y) <= redCut) d = 1; } n += d; } cov[x] = n / H2; }
  const start = edge + Math.round(0.015 * bw), need = Math.max(2, Math.round(0.004 * bw));
  for (let x = start; x < 0.45 * bw; x++) { let ok = true; for (let k = 0; k < need; k++) if (cov[x + k] < 0.04) { ok = false; break; } if (ok) return +((x - edge) / bw).toFixed(4); }
  return null;
}

const median = (a) => { const v = a.filter((x) => x != null && Number.isFinite(x)).sort((p, q) => p - q); return v.length ? v[v.length >> 1] : null; };

/**
 * Recto evidence of each frame, relative to its own book: e > 0 leans recto. Two cues, each centred on the book's
 * median and scaled by its spread: ink onset (earlier than the book's usual = a label; onsets ≤2.5% are the edge
 * shadow and ignored) and margin ink (log scale). Frames with no usable cue get 0.
 * @param frames [{ onset:[..], ink:[..] }] per-leaf values from inkOnset()/rectoInk(), in photo order
 */
export function rectoEvidence(frames, { window = 0 } = {}) {
  const on = frames.map((f) => median((f.onset || []).map((o) => (o != null && o > 0.025 ? o : null))));
  const lk = frames.map((f) => { const m = median(f.ink || []); return m == null ? null : Math.log10(m + 2e-4); });
  const spread = (xs) => { const m = median(xs); const dev = median(xs.map((x) => (x == null ? null : Math.abs(x - m)))); return [m, dev]; };
  const whole = [spread(on), spread(lk)];
  // window > 0: centre each frame on its neighbours (±window/2 frames), since a book's hand, paper and margins change
  // between sections; the window is clamped to the book's ends and always holds both sides of the alternation.
  const local = (i) => {
    if (!window || frames.length <= window) return whole;
    const a = Math.max(0, Math.min(frames.length - window, i - (window >> 1))), b = a + window;
    return [spread(on.slice(a, b)), spread(lk.slice(a, b))];
  };
  return frames.map((_, i) => {
    const [[mo, so], [mk, sk]] = local(i);
    let e = 0;
    if (on[i] != null && mo != null) e += Math.max(-3, Math.min(3, (mo - on[i]) / Math.max(0.004, so)));
    if (lk[i] != null && mk != null) e += Math.max(-3, Math.min(3, (lk[i] - mk) / Math.max(0.15, sk)));
    return e;
  });
}

/**
 * Sides by the photographer's habit: N rectos shot, the leaves flipped in place, N versos shot, so sides ALTERNATE.
 * Two-state Viterbi over the evidence; staying on the same side costs SWITCH (an unpaired frame, a missing photo).
 * @returns {{sides:('R'|'V')[], agree:number, confident:number, breaks:number}} agree = share of confident frames
 *   (|e| ≥ 1) whose evidence sign matches the fitted side.
 */
export function fitSides(ev, { SWITCH = 6 } = {}) {
  const n = ev.length; if (!n) return { sides: [], agree: 0, confident: 0, breaks: 0 };
  const cost = (i, s) => (s === 0 ? -ev[i] : ev[i]); // s=0 recto
  let D = [cost(0, 0), cost(0, 1)]; const back = [];
  for (let i = 1; i < n; i++) {
    const nd = [], bk = [];
    for (const s of [0, 1]) { const alt = D[1 - s], same = D[s] + SWITCH; nd.push(Math.min(alt, same) + cost(i, s)); bk.push(alt <= same ? 1 - s : s); }
    D = nd; back.push(bk);
  }
  let s = D[0] <= D[1] ? 0 : 1; const st = [s];
  for (let i = n - 2; i >= 0; i--) { s = back[i][s]; st.unshift(s); }
  let conf = 0, ok = 0, breaks = 0;
  st.forEach((v, i) => { if (i && v === st[i - 1]) breaks++; if (Math.abs(ev[i]) >= 1) { conf++; if ((ev[i] > 0) === (v === 0)) ok++; } });
  return { sides: st.map((v) => (v === 0 ? 'R' : 'V')), agree: conf ? +(ok / conf).toFixed(3) : 0, confident: conf, breaks };
}
