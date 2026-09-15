/**
 * Gutter detection for two-page spreads (#2454 decision tree, rebuilt in #4796).
 *
 * Primary: pixel detector — free, no model call. Returns a CONFIDENCE signal
 * instead of silently falling back to a centre cut: centre-cutting is the
 * documented way text gets clipped (BPH gutters sit up to 19% off centre), and
 * the caller (split-book.mjs) snaps low-confidence pages to the book median
 * anchored by the confident pages plus a Gemini sample.
 *
 * What it looks for (validated by eye on 33 real spreads across Japanese, Chinese,
 * Hebrew, Arabic, German and Latin books, plus 6 wide single pages, 2026-09-13):
 *
 *   1. TEXT-LIKE columns — measured as dark/light TRANSITIONS down the column,
 *      not as darkness. A line of type alternates ink and paper every few rows;
 *      a binding shadow is dark but uniform; blank paper is light and uniform.
 *      The old detector measured darkness, so a binding shadow counted as "ink"
 *      and tan paper (yellowed Chinese woodblock prints) counted as ink
 *      everywhere; it then cut at the single least-inked column, which on a
 *      page with a wide inner margin is anywhere in that margin — 14 Japanese
 *      books were cut inside the LEFT page's blank margin and served a strip of
 *      the facing page.
 *   2. The GAP — the run of non-text columns between the two text blocks that
 *      crosses the central 30–70% window and has text within 15% on both sides.
 *      A gap reaching the image edge is a blank facing page; it is accepted
 *      only when a binding shadow inside the window says where the pages meet.
 *   3. The CUT — at the binding shadow (luminance dip inside the gap, smoothed
 *      over ±6 columns so a 1–2px frame rule does not pass for a binding) when
 *      the shadow is clear of both text edges by the 3% overlap split-book.mjs
 *      adds; otherwise the gap centre. Either way the cut never sits inside text.
 *
 * The ink threshold is per COLUMN (80th percentile of that column minus 55), so
 * type inside the curvature shadow next to the binding still registers as text
 * — with one global threshold that region read as solid ink and the gap ended
 * 4% early on tightly bound BPH octavos.
 *
 * Operating principle (hard-won, still true): measure CONTENT, not brightness.
 * Ink = min(R,G,B) so coloured rubrication registers (grayscale weights red at
 * ~21% and missed vermilion titles).
 */

import sharp from 'sharp';

/**
 * @returns {Promise<{ column: number|null, confidence: 'high'|'low', reason: string, ar: number, gap?: {start:number,end:number} }>}
 *   column     — gutter x in ORIGINAL image pixels, or null when not found
 *   confidence — 'high' only when a text-flanked gap was located in the search band
 *   reason     — short human label for logs / provenance
 *   ar         — width/height aspect ratio of the source image
 *   gap        — the inter-text gap in 0–1000 units (start, end), when found
 */
export async function detectGutterPixel(spreadBuf, opts = {}) {
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
    const rows = bandEnd - bandStart;

    // Per column: text-likeness (transitions/row) and mean luminance.
    const trans = new Float32Array(W);
    const lum = new Float32Array(W);
    const col = new Uint8Array(rows);
    for (let x = 0; x < W; x++) {
      let l = 0;
      for (let y = bandStart, r = 0; y < bandEnd; y++, r++) {
        const i = (y * W + x) * 3;
        col[r] = Math.min(raw[i], raw[i + 1], raw[i + 2]);
        l += (raw[i] + raw[i + 1] + raw[i + 2]) / 3;
      }
      lum[x] = l / rows;
      const sorted = Uint8Array.from(col).sort();
      const paper = sorted[Math.floor(rows * 0.8)];
      const dark = Math.max(40, Math.min(150, paper - 55));
      let t = 0;
      let prev = col[0] < dark;
      for (let r = 1; r < rows; r++) {
        const d = col[r] < dark;
        if (d !== prev) t++;
        prev = d;
      }
      trans[x] = t / rows;
    }

    const smooth = (src, half) => {
      const out = new Float32Array(W);
      for (let x = 0; x < W; x++) {
        const lo = Math.max(0, x - half), hi = Math.min(W - 1, x + half);
        let s = 0;
        for (let i = lo; i <= hi; i++) s += src[i];
        out[x] = s / (hi - lo + 1);
      }
      return out;
    };
    const text = smooth(trans, 2);   // ±2: bridges inter-character slivers, keeps narrow gaps
    const lumS = smooth(lum, 6);     // ±6: a binding shadow survives, a frame rule does not

    const GAP_MAX = opts.gapMax ?? 0.02;    // fewer transitions than this = no text in the column
    const TEXT_MIN = opts.textMin ?? 0.05;  // flanking text must reach this
    const SHADOW_DIP = opts.shadowDip ?? 25; // luminance dip that counts as a binding shadow
    const FLANK_W = Math.round(W * 0.15);
    const cs = Math.round(W * 0.30);
    const ce = Math.round(W * 0.70);
    const MARGIN = Math.round(W * 0.03);     // split-book.mjs adds 3% overlap; keep the cut this far from text

    // Maximal runs of non-text columns that touch the central window.
    const runs = [];
    let x = 0;
    while (x < W) {
      if (text[x] >= GAP_MAX) { x++; continue; }
      const s = x;
      while (x < W && text[x] < GAP_MAX) x++;
      const e = x - 1;
      if (e < cs || s > ce) continue;
      const edge = s === 0 ? 'left' : e === W - 1 ? 'right' : null;
      let lFl = 0, rFl = 0;
      for (let i = Math.max(0, s - FLANK_W); i < s; i++) lFl = Math.max(lFl, text[i]);
      for (let i = e + 1; i <= Math.min(W - 1, e + FLANK_W); i++) rFl = Math.max(rFl, text[i]);
      let lumMean = 0;
      for (let i = s; i <= e; i++) lumMean += lumS[i];
      lumMean /= (e - s + 1);
      let lumMin = Infinity, lumX = -1;
      for (let i = Math.max(s, cs); i <= Math.min(e, ce); i++) {
        if (lumS[i] < lumMin) { lumMin = lumS[i]; lumX = i; }
      }
      runs.push({
        s, e, w: e - s + 1, edge,
        flanked: lFl >= TEXT_MIN && rFl >= TEXT_MIN,
        shadow: lumX >= 0 && lumMean - lumMin >= SHADOW_DIP,
        lumX,
        center: Math.round((s + e) / 2),
      });
    }

    const eligible = runs.filter(r => r.flanked || (r.edge && r.shadow));
    if (eligible.length === 0) {
      return { column: null, confidence: 'low', reason: runs.length ? `gaps-unflanked(${runs.length})` : 'no-central-gap', ar };
    }
    // A gap with a binding shadow beats one without; text on both sides beats a
    // blank facing page; then the widest.
    eligible.sort((a, b) => (Number(b.shadow) - Number(a.shadow)) || (Number(b.flanked) - Number(a.flanked)) || (b.w - a.w));
    const best = eligible[0];
    const gap = { start: Math.round(best.s / W * 1000), end: Math.round(best.e / W * 1000) };

    let cutX, how;
    if (best.edge) {
      // Blank facing page: the shadow is the only evidence of where the pages
      // meet, and it must sit clear of the text edge on the printed side.
      const textEdge = best.edge === 'left' ? best.e : best.s;
      if (Math.abs(best.lumX - textEdge) < MARGIN) {
        return { column: null, confidence: 'low', reason: 'blank-side-shadow-at-text', ar, gap };
      }
      cutX = best.lumX; how = `blank-${best.edge}+shadow`;
    } else if (best.shadow && best.lumX - best.s >= MARGIN && best.e - best.lumX >= MARGIN) {
      cutX = best.lumX; how = 'gap+shadow';
    } else {
      cutX = best.center; how = best.shadow ? 'gap-centre(shadow-at-edge)' : 'gap-centre';
    }
    return {
      column: Math.round(cutX / ratio),
      confidence: 'high',
      reason: `${how}-w${Math.round(best.w / W * 1000)}`,
      ar,
      gap,
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
