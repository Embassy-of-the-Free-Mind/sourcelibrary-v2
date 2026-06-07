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
    for (let x = 0; x < W; x++) {
      let d = 0;
      for (let y = bandStart; y < bandEnd; y++) {
        const i = (y * W + x) * 3;
        const m = Math.min(raw[i], raw[i + 1], raw[i + 2]);
        if (m < DARK) d++;
      }
      inkPerCol[x] = d / (bandEnd - bandStart);
    }

    // ±5px smoothing so inter-character white slivers don't fragment the gap.
    const half = 5;
    const smoothed = new Float32Array(W);
    for (let x = 0; x < W; x++) {
      const lo = Math.max(0, x - half);
      const hi = Math.min(W - 1, x + half);
      let s = 0;
      for (let i = lo; i <= hi; i++) s += inkPerCol[i];
      smoothed[x] = s / (hi - lo + 1);
    }

    const cs = Math.round(W * 0.30);
    const ce = Math.round(W * 0.70);
    const NO_INK = 0.02;
    let bestStart = -1, bestLen = 0;
    let curStart = -1, curLen = 0;
    for (let x = cs; x < ce; x++) {
      if (smoothed[x] < NO_INK) {
        if (curStart < 0) curStart = x;
        curLen = x - curStart + 1;
        if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
      } else {
        curStart = -1; curLen = 0;
      }
    }

    // No usable ink-free run → LOW confidence. The old code center-cut here;
    // we hand off to the caller (Gemini fallback) instead.
    if (bestStart < 0 || bestLen < 10) {
      return { column: null, confidence: 'low', reason: 'no-ink-free-run', ar };
    }

    const WIDE = Math.round(W * 0.15);
    const chosen = bestLen < WIDE
      ? bestStart + bestLen                  // narrow gap → cut at gap end
      : bestStart + Math.floor(bestLen / 2); // wide gap → cut at gap center
    return {
      column: Math.round(chosen / ratio),
      confidence: 'high',
      reason: bestLen < WIDE ? `ink-free-run-${bestLen}px-end` : `ink-free-run-${bestLen}px-center`,
      ar,
    };
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
