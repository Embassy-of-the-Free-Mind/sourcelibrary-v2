/**
 * Gutter detection for two-page spreads (#2454 decision tree).
 *
 * Primary: pixel ink-density detector — free, no model call. Ported from the
 * battle-tested `detectGutterColumn()` in scripts/workers/batch-split-bph.mjs
 * (which survived four false starts — see memory lesson-splitter-gutter-detection),
 * but here it returns a CONFIDENCE signal instead of silently falling back to a
 * center cut. Center-cutting is the documented way text gets clipped: BPH gutters
 * are offset from center by up to 19%.
 *
 * The caller uses confidence to decide whether to trust the pixel result or fall
 * back to a Gemini vision call (the manuscript / tight-binding tail), and to
 * refuse to cut at all when neither detector is confident.
 *
 * Operating principle (hard-won): measure ink CONTENT presence per column, not
 * brightness. Ink = min(R,G,B) < 120 so colored rubrication registers (grayscale
 * weights red at ~21% and missed vermillion titles).
 */

import sharp from 'sharp';

/**
 * @returns {Promise<{ column: number|null, confidence: 'high'|'low', reason: string, ar: number }>}
 *   column     — gutter x in ORIGINAL image pixels, or null when not found
 *   confidence — 'high' only when a clear ink-free run was located in the search band
 *   reason     — short human label for logs / provenance
 *   ar         — width/height aspect ratio of the source image
 */
export async function detectGutterPixel(spreadBuf) {
  const meta = await sharp(spreadBuf).metadata();
  const imgWidth = meta.width || 1;
  const imgHeight = meta.height || 1;
  const ar = imgWidth / imgHeight;

  try {
    const W = 800;
    const ratio = W / imgWidth;
    const H = Math.round(imgHeight * ratio);
    const raw = await sharp(spreadBuf)
      .resize(W, H, { fit: 'fill' })
      .removeAlpha()
      .toColourspace('srgb')
      .raw()
      .toBuffer();

    const bandStart = Math.round(H * 0.25);
    const bandEnd = Math.round(H * 0.75);
    const DARK = 120;
    const inkPerCol = new Float32Array(W);
    const lumPerCol = new Float32Array(W); // mean luminance — for binding-shadow valley
    for (let x = 0; x < W; x++) {
      let d = 0, lum = 0;
      for (let y = bandStart; y < bandEnd; y++) {
        const i = (y * W + x) * 3;
        const m = Math.min(raw[i], raw[i + 1], raw[i + 2]);
        if (m < DARK) d++;
        lum += (raw[i] + raw[i + 1] + raw[i + 2]) / 3;
      }
      inkPerCol[x] = d / (bandEnd - bandStart);
      lumPerCol[x] = lum / (bandEnd - bandStart);
    }

    // LIGHT smoothing (±2px) — bridges inter-character white slivers without
    // smearing a NARROW gutter above the detection floor. ±5px used to erase
    // 1-2px bright gutters entirely (the bug that sent clean pages to Gemini's
    // useless center-guess).
    const smooth = (src) => {
      const out = new Float32Array(W);
      const half2 = 2;
      for (let x = 0; x < W; x++) {
        const lo = Math.max(0, x - half2), hi = Math.min(W - 1, x + half2);
        let s = 0; for (let i = lo; i <= hi; i++) s += src[i];
        out[x] = s / (hi - lo + 1);
      }
      return out;
    };
    const ink = smooth(inkPerCol);
    const lum = smooth(lumPerCol);

    // Search the CENTRAL third only (35%–65%). These books are 2-columns-per-page,
    // so the intra-page column gaps sit near 25% and 75% — outside this window —
    // leaving the binding gutter as the dominant central valley.
    const cs = Math.round(W * 0.35);
    const ce = Math.round(W * 0.65);
    const flank = Math.round(W * 0.08);

    // ── Signal A: bright gutter — the relative ink MINIMUM in the window,
    // confirmed as a valley flanked by text (higher ink) on both sides.
    let inkX = cs, inkMin = Infinity;
    for (let x = cs; x < ce; x++) if (ink[x] < inkMin) { inkMin = ink[x]; inkX = x; }
    let lInk = 0, rInk = 0;
    for (let x = Math.max(0, inkX - flank); x < inkX; x++) lInk = Math.max(lInk, ink[x]);
    for (let x = inkX + 1; x <= Math.min(W - 1, inkX + flank); x++) rInk = Math.max(rInk, ink[x]);
    if (inkMin < 0.10 && lInk - inkMin >= 0.10 && rInk - inkMin >= 0.10) {
      return { column: Math.round(inkX / ratio), confidence: 'high', reason: `ink-valley-${Math.round(inkMin * 100)}pct`, ar };
    }

    // ── Signal B: dark gutter (binding shadow) — the luminance MINIMUM, as a
    // valley flanked by brighter margins. Returned as a LOW-confidence HINT only,
    // NOT a standalone cut: on manuscripts a dark figure / shadow / margin is
    // easily mistaken for the binding (it mis-cut Figurae p6 → 594, Annvae p11 →
    // 540, both ~50px off the true gutter). The caller treats a low-confidence
    // result as "snap to the book median", which is anchored by the reliable
    // ink-valley pages + the Gemini sample. Photographed codices with no bright
    // gap (Euclid) are covered by that median, so we lose nothing by demoting it.
    let lumX = cs, lumMin = Infinity;
    for (let x = cs; x < ce; x++) if (lum[x] < lumMin) { lumMin = lum[x]; lumX = x; }
    let lLum = 0, rLum = 0;
    for (let x = Math.max(0, lumX - flank); x < lumX; x++) lLum = Math.max(lLum, lum[x]);
    for (let x = lumX + 1; x <= Math.min(W - 1, lumX + flank); x++) rLum = Math.max(rLum, lum[x]);
    if (lLum - lumMin >= 25 && rLum - lumMin >= 25) {
      return { column: Math.round(lumX / ratio), confidence: 'low', reason: `dark-valley-hint-${Math.round(lumMin)}lum`, ar };
    }

    // Neither a bright nor (trusted) dark central valley → LOW; snap to median.
    return { column: null, confidence: 'low', reason: 'no-central-valley', ar };
  } catch (e) {
    return { column: null, confidence: 'low', reason: `pixel-error:${(e.message || '').slice(0, 40)}`, ar };
  }
}

/**
 * Convert a 0-1000 split-position (Gemini's scale) to an absolute pixel column.
 */
export function splitPositionToColumn(splitPosition, imgWidth) {
  if (typeof splitPosition !== 'number') return null;
  return Math.round((splitPosition / 1000) * imgWidth);
}
