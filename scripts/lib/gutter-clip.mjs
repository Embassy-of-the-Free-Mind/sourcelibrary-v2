/**
 * Gutter-AWARE clip detection for old-era BPH crop-coord split halves (issue #3088,
 * follow-up to #2898). Shared by the audit (audit-bph-gutter-clip.mjs) and the
 * gutter-relative re-crop (recrop-bph-gutter.mjs) so both reason about the SAME
 * geometry — never two drifting copies (code-quality lesson).
 *
 * WHY a new primitive. The first-pass audit measured raw ink (`min(R,G,B)<120`)
 * in a fixed band just past the cut and flagged anything dark. On the real BPH
 * cohort that over-flagged ~97%, because raw ink cannot tell CLIPPED LEFT-PAGE
 * TEXT apart from:
 *   (a) the BINDING SHADOW of a tight-bound book — a saturated dark run that pins
 *       ink toward ~1.0 (text tops out lower: line leading leaves white rows), and
 *   (b) FACING-PAGE bleed — ink that lives PAST the gutter, on the other page
 *       (a cut placed at/past the true gutter over-includes the facing page).
 *
 * The fix is to locate the TRUE gutter per page and count only text-like ink
 * BETWEEN the cut and the gutter (the content a widen would actually recover),
 * excluding saturation and everything past the gutter.
 *
 * Geometry. `crop` is per-mille [0,1000] of the full spread width. A zero-overlap
 * old-era split stores each half as {xStart:0, xEnd:c} (left) or {xStart:c,
 * xEnd:1000} (right), the two facing pages sharing the cut line c. Clipping
 * happens when the splitter put c short of the true gutter g (classic case: it
 * snapped to an INTER-COLUMN valley — the gap between the body text and a
 * right-aligned numeral/catchword column — instead of the binding, see Artis
 * p386), leaving recoverable content in [c, g] (left page) / [g, c] (right page).
 *
 * Method. Resize the FULL spread to width 1000 (column x === per-mille). Over the
 * central band (y 25%-75%, skips running heads/footers) compute per column:
 *   ink[x] = fraction of rows with min(R,G,B) < 120  (colored rubrication counts)
 *   lum[x] = mean luminance                          (for the dark-shadow gutter)
 * Light ±2px smoothing bridges inter-character slivers without erasing a 1-2px
 * bright gutter.
 *
 * Then, per page, LOCATE THE TRUE GUTTER independently of the cut, in a window
 * [cut-WIN, cut+WIN] (the old splitter aimed AT the gutter, so it sits near the
 * cut):
 *   - the WIDEST bright ink-free run (ink < BRIGHT_GAP) — the binding gap; picking
 *     the *widest* is what beats the ToC case (Artis p386), where a narrower
 *     INTER-COLUMN valley sits between the body text and a right-aligned numeral
 *     column and the true, wider binding gutter is just beyond it, OR
 *   - if there is no bright gap (tight binding), the saturated dark SHADOW column
 *     (ink > SHADOW_INK AND lum < SHADOW_LUM).
 * Compare gutter g to the cut c using the SIGN, which disambiguates clip from
 * bleed:
 *   left half  {0,c}:    clip only if g is to the RIGHT of c → recover text in [c, g)
 *   right half {c,1000}: clip only if g is to the LEFT  of c → recover text in (g, c]
 * A cut that sits AT or PAST the gutter clips nothing on its own page (it merely
 * over-includes some facing page) → NOT flagged; this is exactly what the naive
 * "ink just past the cut" metric got wrong. In the recover interval we count only
 * text-like columns (TEXT_LO ≤ ink ≤ TEXT_HI); saturation and the bright gap
 * contribute nothing. If no gutter is found in the window the page is reported
 * low-confidence (`gutterKind:'none'`) and NOT flagged.
 *
 * One more shadow trap (the p197 false positive): a wide-margin book can show BOTH
 * a bright inner-margin gap AND a narrow binding SHADOW just past it. The shadow's
 * ramp climbs through text-like ink (0.1→0.8) before it saturates, so its slope
 * would be miscounted as recovered text. We therefore drop any candidate column
 * within SAT_ADJ‰ of a saturation peak (ink ≥ SAT_PEAK): real marginal text (~0.24)
 * has no such peak, a shadow ramp always does.
 */

import sharp from 'sharp';

// ── Tunables (per-mille unless noted). Defaults chosen against the real cohort;
// override via the audit CLI for tuning. Kept in one place so audit + recrop agree.
export const DEFAULTS = {
  BAND_TOP: 0.25,      // central-band vertical window (skip head/footer)
  BAND_BOT: 0.75,
  DARK: 120,           // min(R,G,B) < DARK counts as ink
  SMOOTH: 2,           // ±px smoothing radius
  GUTTER_WIN: 60,      // ‰ each side of the cut to search for the true gutter
  BRIGHT_GAP: 0.045,   // ink below this = a bright gap column
  GAP_RUN: 2,          // consecutive bright columns needed to call it a gap
  SHADOW_INK: 0.88,    // ink above this = saturated binding shadow (a gutter, NOT text)
  SHADOW_LUM: 90,      // AND luminance below this — shadow is dark (a dense figure may be dark too)
  TEXT_LO: 0.06,       // text-like ink floor
  TEXT_HI: 0.62,       // text-like ink ceiling — line text tops ~0.6 (leading leaves white rows)
  SAT_PEAK: 0.82,      // a column this dark is a saturation peak (binding shadow / dense figure)
  SAT_ADJ: 8,          // ‰: a text column within this of a SAT_PEAK is a shadow RAMP, not text
  MIN_RECOVER: 4,      // ≥ this many text ‰ between cut and gutter → the page clips
};

/**
 * Compute per-mille ink + luminance profiles of a full spread.
 * @returns {Promise<{ink:Float32Array, lum:Float32Array, W:number}>}
 */
export async function spreadProfile(buf, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const W = 1000;
  const meta = await sharp(buf).metadata();
  const H = Math.max(1, Math.round((meta.height || 1) * (W / (meta.width || 1))));
  const raw = await sharp(buf).resize(W, H, { fit: 'fill' }).removeAlpha().toColourspace('srgb').raw().toBuffer();
  const y0 = Math.round(H * o.BAND_TOP), y1 = Math.round(H * o.BAND_BOT);
  const rows = Math.max(1, y1 - y0);
  const inkRaw = new Float32Array(W);
  const lumRaw = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    let d = 0, lum = 0;
    for (let y = y0; y < y1; y++) {
      const i = (y * W + x) * 3;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      if (Math.min(r, g, b) < o.DARK) d++;
      lum += (r + g + b) / 3;
    }
    inkRaw[x] = d / rows;
    lumRaw[x] = lum / rows;
  }
  return { ink: smooth(inkRaw, o.SMOOTH), lum: smooth(lumRaw, o.SMOOTH), W };
}

function smooth(src, radius) {
  const W = src.length;
  const out = new Float32Array(W);
  for (let x = 0; x < W; x++) {
    const lo = Math.max(0, x - radius), hi = Math.min(W - 1, x + radius);
    let s = 0;
    for (let i = lo; i <= hi; i++) s += src[i];
    out[x] = s / (hi - lo + 1);
  }
  return out;
}

/** Which half is this crop, and where is the cut (per-mille)? null if indeterminate. */
export function cropSide(crop) {
  if (!crop || typeof crop.xStart !== 'number' || typeof crop.xEnd !== 'number') return null;
  if (crop.xStart === 0 && crop.xEnd < 1000) return { side: 'L', cut: crop.xEnd };
  if (crop.xEnd === 1000 && crop.xStart > 0) return { side: 'R', cut: crop.xStart };
  return null;
}

/**
 * Locate the true gutter in a window around the cut.
 * @returns {{ kind:'bright'|'shadow'|'none', start:number, end:number, mid:number }}
 *   For 'bright': [start,end] is the ink-free run (inclusive). For 'shadow': the
 *   darkest saturated column (start==end). 'none' when neither is present.
 */
export function findGutter(profile, cut, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const { ink, lum, W } = profile;
  const lo = Math.max(0, cut - o.GUTTER_WIN);
  const hi = Math.min(W - 1, cut + o.GUTTER_WIN);

  // Widest bright ink-free run in the window.
  let bestS = -1, bestE = -1, bestLen = 0;
  let curS = -1;
  for (let x = lo; x <= hi; x++) {
    if (ink[x] < o.BRIGHT_GAP) {
      if (curS < 0) curS = x;
      const len = x - curS + 1;
      if (len > bestLen) { bestLen = len; bestS = curS; bestE = x; }
    } else {
      curS = -1;
    }
  }
  if (bestLen >= o.GAP_RUN) {
    return { kind: 'bright', start: bestS, end: bestE, mid: Math.round((bestS + bestE) / 2) };
  }

  // No bright gap → tight binding: the darkest saturated column in the window.
  let sx = -1, sLum = Infinity;
  for (let x = lo; x <= hi; x++) {
    if (ink[x] > o.SHADOW_INK && lum[x] < o.SHADOW_LUM && lum[x] < sLum) { sLum = lum[x]; sx = x; }
  }
  if (sx >= 0) return { kind: 'shadow', start: sx, end: sx, mid: sx };

  return { kind: 'none', start: -1, end: -1, mid: -1 };
}

/**
 * Measure gutter clipping for one page's crop against its spread profile.
 * Returns null when the side is indeterminate.
 *
 * @returns {{
 *   side:'L'|'R', cut:number,
 *   gutter:number|null,        // per-mille cut-to line (gap near-edge / shadow col), null if none
 *   gutterKind:'bright'|'shadow'|'none',
 *   recoverWidth:number,       // count of text-like ‰ between cut and gutter
 *   recoverInkMax:number,      // densest text column found (0 if none)
 *   reach:number,              // furthest ‰ from cut with text before the gutter
 *   clipped:boolean,
 * }|null}
 */
export function measureClip(profile, crop, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const sc = cropSide(crop);
  if (!sc) return null;
  const { side, cut } = sc;
  const { ink } = profile;
  const g = findGutter(profile, cut, o);

  const base = { side, cut, gutter: null, gutterKind: g.kind, recoverWidth: 0, recoverInkMax: 0, reach: 0, clipped: false };
  if (g.kind === 'none') return base;

  // Recover interval: text between the cut and the gutter, on the correct side.
  // The near edge of the gutter (toward the cut) is the boundary — the gap/shadow
  // itself is never counted as recoverable text.
  let a, b, boundary;
  if (side === 'L') {
    boundary = g.start;                                 // run start = near edge for a left page
    if (boundary <= cut) return { ...base, gutter: boundary }; // cut at/past gutter → no left clip (bleed)
    a = cut + 1; b = boundary - 1;
  } else {
    boundary = g.end;                                   // run end = near edge for a right page
    if (boundary >= cut) return { ...base, gutter: boundary }; // cut at/past gutter → no right clip (bleed)
    a = boundary + 1; b = cut - 1;
  }

  // A saturation peak anywhere near the recover interval means we're looking at a
  // binding shadow (or a dense figure/initial), whose RAMP passes through text-like
  // ink values on the way up — the p197 false-positive. Exclude any candidate column
  // that sits within SAT_ADJ‰ of such a peak.
  const nearSat = (x) => {
    for (let d = -o.SAT_ADJ; d <= o.SAT_ADJ; d++) {
      const xx = x + d;
      if (xx >= 0 && xx < ink.length && ink[xx] >= o.SAT_PEAK) return true;
    }
    return false;
  };

  let width = 0, inkMax = 0, reach = 0;
  for (let x = a; x <= b; x++) {
    const v = ink[x];
    if (v >= o.TEXT_LO && v <= o.TEXT_HI && !nearSat(x)) {
      width++;
      inkMax = Math.max(inkMax, v);
      reach = Math.max(reach, Math.abs(x - cut));
    }
  }
  const clipped = width >= o.MIN_RECOVER && inkMax >= o.TEXT_LO;
  return { side, cut, gutter: boundary, gutterKind: g.kind, recoverWidth: width, recoverInkMax: +inkMax.toFixed(3), reach, clipped };
}
