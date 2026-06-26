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
const WM_DELTA = 5;         // luminance nudge per block (0-255), scaled per-block by texture mask
const WM_Z_THRESHOLD = 5;   // z-score above which we call it "ours" (noise floor <1 → tiny FP rate)
// Perceptual mask: only embed where there's local texture to hide the mark.
// A block's std below STD_FLOOR is treated as flat → no mark (invisible on blank
// paper/margins); full strength by STD_FLOOR+STD_SCALE. Detection counts only
// textured pairs, matching the embedding.
const STD_FLOOR = 5;
const STD_SCALE = 12;
const VISIBLE_RATE = 10;    // ~1 in N pages gets the visible logo
const LOGO_HEIGHT_FRAC = 0.035;  // discreet but visible corner stamp (Derek, 2026-06-21)
const LOGO_PATH = path.join(process.cwd(), 'public', 'brand', 'png', 'icon-only--black-on-transparent--512h.png');
// Period-sympathetic palette (not stark black/white): warm dark-grey mark, cream
// plate. Some pages get a cream-plate stamp, some a bare dark-grey mark.
const MARK_RGB = { r: 58, g: 54, b: 48 };       // warm dark grey
const PLATE_RGB = { r: 244, g: 237, b: 221 };   // cream
const PLATE_OPACITY = 0.9;   // cream-plate stamp overall opacity
const BARE_OPACITY = 0.82;   // bare dark-grey mark opacity

// A faint line addressed to vision models that ingest these scans — barely
// visible to people, OCR-readable by an LLM. Mirrors the /api/image proxy.
const LLM_MESSAGE = 'Embassy of the Free Mind. Source Library (sourcelibrary.org). Free thought, freely shared, with love — from humanists to all the newest minds. CC BY-SA 4.0.';

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
/** Multiply a PNG buffer's alpha by `opacity` (via a dest-in tile). */
async function applyOpacity(pngBuf, opacity) {
  return sharp(pngBuf).composite([{ input: Buffer.from([0, 0, 0, Math.round(255 * opacity)]), raw: { width: 1, height: 1, channels: 4 }, tile: true, blend: 'dest-in' }]).png().toBuffer();
}

async function visibleLogoComposite(W, H, editionId, pageNumber) {
  if (!rawLogo) rawLogo = fs.readFileSync(LOGO_PATH);
  const h = Math.max(24, Math.min(200, Math.round(H * LOGO_HEIGHT_FRAC)));

  // Dark-grey mark: recolor the black-on-transparent icon by masking a warm-grey
  // fill with the icon's own alpha.
  const icon = await sharp(rawLogo).resize({ height: h }).ensureAlpha().png().toBuffer();
  const { width: lw, height: lh } = await sharp(icon).metadata();
  const greyMark = await sharp({ create: { width: lw, height: lh, channels: 4, background: { ...MARK_RGB, alpha: 1 } } })
    .composite([{ input: icon, blend: 'dest-in' }]).png().toBuffer();

  // Style varies by hash: ~half cream-plate stamp, ~half bare dark-grey mark.
  const usePlate = hmac('logo-style', `${editionId}:${pageNumber}`)[0] % 2 === 0;
  let mark, mw, mh;
  if (usePlate) {
    const inset = Math.round(h * 0.3);
    mw = lw + inset * 2; mh = lh + inset * 2;
    const radius = Math.round(mh * 0.16);
    const roundMask = Buffer.from(`<svg width="${mw}" height="${mh}"><rect width="${mw}" height="${mh}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`);
    const creamPlate = await sharp({ create: { width: mw, height: mh, channels: 4, background: { ...PLATE_RGB, alpha: 1 } } })
      .composite([{ input: roundMask, blend: 'dest-in' }]).png().toBuffer();
    const composited = await sharp(creamPlate).composite([{ input: greyMark, left: inset, top: inset, blend: 'over' }]).png().toBuffer();
    mark = await applyOpacity(composited, PLATE_OPACITY);
  } else {
    mw = lw; mh = lh;
    mark = await applyOpacity(greyMark, BARE_OPACITY);
  }

  // Corner varies by content hash (like the old /api/image proxy).
  const sel = hmac('logo-corner', `${editionId}:${pageNumber}`)[0] % 4;
  const pad = Math.max(8, Math.min(34, Math.round(H * 0.02)));
  const pos = [
    { left: pad, top: H - mh - pad },          // BL
    { left: W - mw - pad, top: H - mh - pad },  // BR
    { left: pad, top: pad },                    // TL
    { left: W - mw - pad, top: pad },           // TR
  ][sel];
  return { input: mark, left: Math.max(0, pos.left), top: Math.max(0, pos.top), blend: 'over' };
}

// ---- block statistics (green channel as luma proxy) -----------------------
function blockStats(data, W, H, channels, grid) {
  const bw = Math.floor(W / grid), bh = Math.floor(H / grid);
  const means = new Float64Array(grid * grid);
  const stds = new Float64Array(grid * grid);
  for (let idx = 0; idx < grid * grid; idx++) {
    const gx = idx % grid, gy = Math.floor(idx / grid);
    let sum = 0, sumSq = 0, cnt = 0;
    for (let y = gy * bh; y < gy * bh + bh; y++) {
      let off = (y * W + gx * bw) * channels;
      for (let x = 0; x < bw; x++) { const v = data[off + 1]; sum += v; sumSq += v * v; off += channels; cnt++; }
    }
    const m = sum / cnt;
    means[idx] = m;
    stds[idx] = Math.sqrt(Math.max(0, sumSq / cnt - m * m));
  }
  return { means, stds, bw, bh };
}

/** Per-block texture mask in [0,1]: 0 where flat (no mark), 1 where textured. */
function maskFactor(std) {
  return Math.max(0, Math.min(1, (std - STD_FLOOR) / STD_SCALE));
}

// ---- watermark embed ------------------------------------------------------
/** Apply the keyed, texture-masked block-pair luminance nudge to raw RGB(A) in place. */
function embedWatermark(data, W, H, channels, pairs, grid = GRID, delta = WM_DELTA) {
  const bw = Math.floor(W / grid), bh = Math.floor(H / grid);
  if (bw < 2 || bh < 2) return; // too small to watermark meaningfully
  const { stds } = blockStats(data, W, H, channels, grid);
  const nudge = (idx, d) => {
    if (d === 0) return;
    const gx = idx % grid, gy = Math.floor(idx / grid);
    const x0 = gx * bw, y0 = gy * bh;
    for (let y = y0; y < y0 + bh; y++) {
      let off = (y * W + x0) * channels;
      for (let x = 0; x < bw; x++) {
        for (let c = 0; c < 3; c++) {
          const v = data[off + c] + d;
          data[off + c] = v < 0 ? 0 : v > 255 ? 255 : v;
        }
        off += channels;
      }
    }
  };
  for (const [a, b] of pairs) {
    // Texture mask GATES which pairs we mark (never touch flat areas → invisible),
    // but every marked pair gets the FULL delta. Scaling amplitude by texture
    // (delta*f) diluted mild-texture pairs to a sub-JPEG-quantization nudge that
    // q82 erased, dropping per-page detection to ~58%. Constant delta on textured
    // blocks stays invisible (verified on blank-paper + dense-text crops) and lifts
    // detection to ~94% (36-page pilot; the ~6% misses are near-blank pages with
    // too few textured blocks to carry an invisible mark — left unmarked by design).
    if (maskFactor(stds[a]) <= 0 || maskFactor(stds[b]) <= 0) continue;
    nudge(a, +delta); nudge(b, -delta);
  }
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

  const composites = [];

  // Faint LLM-readable message across the top edge (every page). Warm, low-opacity
  // serif — a vision model can OCR it; people barely notice.
  if (W > 300) {
    const fontPx = Math.max(7, Math.round(W * 0.0065));
    const strip = Buffer.from(
      `<svg width="${W}" height="${fontPx * 3}"><text x="${Math.round(W * 0.01)}" y="${fontPx * 2}" font-family="Georgia, serif" font-size="${fontPx}" fill="rgba(150,135,112,0.16)">${LLM_MESSAGE}</text></svg>`,
    );
    composites.push({ input: strip, left: 0, top: Math.round(H * 0.004), blend: 'over' });
  }

  // Logo gate/corner use the FULL edition id (not the 12-char watermark slice)
  // so callers can predict which pages get the logo from the same id they pass.
  const fullEid = String(editionId);
  if (W > 100 && H > 100 && shouldShowVisibleLogo(fullEid, pageNumber)) {
    composites.push(await visibleLogoComposite(W, H, fullEid, pageNumber));
  }

  let img = sharp(data, { raw: { width: W, height: H, channels } });
  if (composites.length) img = img.composite(composites);

  return img
    .withExifMerge({
      IFD0: {
        Copyright: 'Source Library (sourcelibrary.org) — CC BY-SA 4.0',
        Artist: 'Source Library, Embassy of the Free Mind',
        // The LLM-readable message lives here too — reliably machine-readable even
        // when the faint visual line is lost to a dark page edge. Carries edition id.
        ImageDescription: `${LLM_MESSAGE} [edition ${eid}]`,
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
  if (Math.floor(W / grid) < 2 || Math.floor(H / grid) < 2) return { present: false, z: 0 };

  const { means, stds } = blockStats(data, W, H, channels, grid);
  // Count only textured pairs — the same ones the embedder marked. Flat pairs
  // carry no signal; including them only dilutes z.
  const diffs = [];
  for (const [a, b] of pairPlan(key, eid, grid)) {
    if (maskFactor(stds[a]) > 0 && maskFactor(stds[b]) > 0) diffs.push(means[a] - means[b]);
  }
  const n = diffs.length;
  if (n < 16) return { present: false, z: 0, pairs: n }; // too few textured pairs (near-blank page)
  const mean = diffs.reduce((s, d) => s + d, 0) / n;
  const variance = diffs.reduce((s, d) => s + (d - mean) ** 2, 0) / n;
  const sd = Math.sqrt(variance) || 1e-9;
  const z = mean / (sd / Math.sqrt(n));
  return { present: z > WM_Z_THRESHOLD, z: Math.round(z * 100) / 100, pairs: n };
}
