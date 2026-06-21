/**
 * Image provenance marking — issue #2651.
 *
 * Three layers, all applied to a display-variant JPEG buffer:
 *   1. EXIF metadata     — Copyright / Source / signed edition id. Invisible,
 *                          read with exiftool. Survives file copy/re-host.
 *   2. Invisible watermark — a keyed block-pair luminance ("Patchwork") mark.
 *                          Invisible to humans, survives JPEG recompression
 *                          (lives in block averages), detectable only with our
 *                          secret key. Proves "this image is ours."
 *   3. Visible logo      — a subtle, randomly-placed corner stamp on ~1-in-10
 *                          pages (hash-gated), replicating the old /api/image
 *                          behavior.
 *
 * The watermark is a *presence detector*, not a data channel: embedding nudges
 * a key-derived set of block pairs in a consistent direction; detection sums the
 * pair differences and z-tests against zero. Random (unmarked) images score ~0;
 * ours score strongly positive. The edition id seeds the pairing so the mark is
 * edition-specific, and is also carried verbatim in EXIF.
 *
 * NEVER apply to OCR/original images — only to display variants.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import sharp from 'sharp';

sharp.concurrency(1); // JS-level concurrency drives parallelism in the backfill

// ---- tunables (defaults; overridable per-call for tuning) -----------------
// Tuned 2026-06-21 on a worst-case dense text scan (issue #2651): grid 128 /
// delta 3 → detection z≈7.4 (wrong-key/original <1), survives q70 recompress &
// downscale, and is visually clean (9px blocks at ±3 luminance = imperceptible,
// no margin banding). Sparse pages detect far more strongly.
const GRID = 128;           // GRID x GRID blocks. More pairs → higher detection z (∝ √pairs)
const WM_DELTA = 3;         // luminance nudge per block (0-255). ~invisible, JPEG-robust
const WM_Z_THRESHOLD = 5;   // z-score above which we call it "ours" (noise floor <1 → tiny FP rate)
const VISIBLE_RATE = 10;    // ~1 in N pages gets the visible logo
const LOGO_HEIGHT_FRAC = 0.045;
const LOGO_OPACITY = 0.5;
const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'png', 'icon-only--black-on-transparent--512h.png');

// ---- key helpers ----------------------------------------------------------
function hmac(key, label) {
  return crypto.createHmac('sha256', key).update(label).digest();
}

/** Deterministic block-pair plan + sign vector from (key, editionId). */
function pairPlan(key, editionId, grid = GRID) {
  // Fisher–Yates shuffle of [0..grid*grid) seeded by HMAC, then pair up.
  const n = grid * grid;
  const order = [...Array(n).keys()];
  const seed = hmac(key, `pairing:${editionId}`);
  let s = 0;
  const rnd = () => {
    // simple keyed PRNG: re-hash the seed counter
    const h = crypto.createHmac('sha256', seed).update(String(s++)).digest();
    return h.readUInt32BE(0) / 0x100000000;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const pairs = [];
  for (let i = 0; i + 1 < n; i += 2) pairs.push([order[i], order[i + 1]]);
  return pairs; // each pair: block A gets +delta, block B gets -delta
}

/** ~1-in-VISIBLE_RATE deterministic gate, varying by edition + page. */
export function shouldShowVisibleLogo(editionId, pageNumber) {
  const h = hmac('visible-logo', `${editionId}:${pageNumber}`);
  return h[0] % VISIBLE_RATE === 0;
}

// ---- visible logo ---------------------------------------------------------
let rawLogo = null;
async function visibleLogoComposite(W, H, editionId, pageNumber) {
  if (!rawLogo) rawLogo = fs.readFileSync(LOGO_PATH);
  const h = Math.max(14, Math.min(64, Math.round(H * LOGO_HEIGHT_FRAC)));
  const resized = await sharp(rawLogo).resize({ height: h }).ensureAlpha().png().toBuffer();
  const { width: w } = await sharp(resized).metadata();
  const alphaTile = { input: Buffer.from([0, 0, 0, Math.round(255 * LOGO_OPACITY)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' };
  const logo = await sharp(resized).composite([alphaTile]).png().toBuffer();
  // Corner varies by content hash (like the old /api/image proxy), biased away
  // from the top (page numbers/headers usually live there).
  const sel = hmac('logo-corner', `${editionId}:${pageNumber}`)[0] % 4;
  const pad = Math.max(6, Math.min(28, Math.round(H * 0.02)));
  const pos = [
    { left: pad, top: H - h - pad },               // BL
    { left: W - w - pad, top: H - h - pad },        // BR
    { left: pad, top: pad },                        // TL
    { left: W - w - pad, top: pad },                // TR
  ][sel];
  return { input: logo, left: Math.max(0, pos.left), top: Math.max(0, pos.top), blend: 'over' };
}

// ---- watermark embed ------------------------------------------------------
/** Apply the keyed block-pair luminance nudge to a raw RGB(A) buffer in place. */
function embedWatermark(data, W, H, channels, pairs, grid = GRID, delta = WM_DELTA) {
  const bw = Math.floor(W / grid), bh = Math.floor(H / grid);
  if (bw < 2 || bh < 2) return; // too small to watermark meaningfully
  const blockBounds = (idx) => {
    const gx = idx % grid, gy = Math.floor(idx / grid);
    return { x0: gx * bw, y0: gy * bh, x1: gx * bw + bw, y1: gy * bh + bh };
  };
  const nudge = (idx, d) => {
    const { x0, y0, x1, y1 } = blockBounds(idx);
    for (let y = y0; y < y1; y++) {
      let off = (y * W + x0) * channels;
      for (let x = x0; x < x1; x++) {
        for (let c = 0; c < 3; c++) {
          const v = data[off + c] + d;
          data[off + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        off += channels;
      }
    }
  };
  for (const [a, b] of pairs) { nudge(a, +delta); nudge(b, -delta); }
}

// ---- public: mark one image ----------------------------------------------
/**
 * Mark a display-variant JPEG buffer with all three provenance layers.
 * @returns marked JPEG Buffer.
 */
export async function markImage(buffer, { editionId, pageNumber, key, jpegQuality = 82, grid = GRID, delta = WM_DELTA }) {
  if (!key) throw new Error('provenance key required');
  const eid = String(editionId).slice(0, 12);

  const { data, info } = await sharp(buffer, { failOn: 'none' }).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  embedWatermark(data, W, H, channels, pairPlan(key, eid, grid), grid, delta);

  let img = sharp(data, { raw: { width: W, height: H, channels } });

  if (W > 100 && H > 100 && shouldShowVisibleLogo(eid, pageNumber)) {
    img = img.composite([await visibleLogoComposite(W, H, eid, pageNumber)]);
  }

  return img
    .withExifMerge({
      IFD0: {
        Copyright: 'Source Library (sourcelibrary.org) — CC BY-SA 4.0',
        Artist: 'Source Library, Embassy of the Free Mind',
        ImageDescription: `Source Library provenance; edition ${eid}`,
      },
    })
    .jpeg({ quality: jpegQuality })
    .toBuffer();
}

// ---- public: detect our watermark ----------------------------------------
/**
 * @returns {present: boolean, z: number} — z is the detection z-score.
 */
export async function detectWatermark(buffer, { editionId, key, grid = GRID }) {
  const eid = String(editionId).slice(0, 12);
  const { data, info } = await sharp(buffer, { failOn: 'none' }).raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;
  const bw = Math.floor(W / grid), bh = Math.floor(H / grid);
  if (bw < 2 || bh < 2) return { present: false, z: 0 };

  // mean luminance per block (use green channel as a luma proxy — fast, fine)
  const means = new Float64Array(grid * grid);
  for (let idx = 0; idx < grid * grid; idx++) {
    const gx = idx % grid, gy = Math.floor(idx / grid);
    let sum = 0, cnt = 0;
    for (let y = gy * bh; y < gy * bh + bh; y++) {
      let off = (y * W + gx * bw) * channels;
      for (let x = 0; x < bw; x++) { sum += data[off + 1]; off += channels; cnt++; }
    }
    means[idx] = sum / cnt;
  }

  const pairs = pairPlan(key, eid, grid);
  const diffs = pairs.map(([a, b]) => means[a] - means[b]);
  const n = diffs.length;
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1e-9;
  // z-score of the mean pair-difference against 0 (standard error = sd/sqrt(n))
  const z = mean / (sd / Math.sqrt(n));
  return { present: z > WM_Z_THRESHOLD, z: Math.round(z * 100) / 100 };
}
