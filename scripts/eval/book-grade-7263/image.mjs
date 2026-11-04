#!/usr/bin/env node
// PRIOR ART: scripts/eval/confidence-7866/analyze.mjs uses only the stored scan_quality scores (AUC 0.38–0.39, the wrong
// way). scripts/lib/page-image-url.mjs resolves an image but measures nothing. Searched scripts/eval/INDEX.md and
// `git grep -l "laplacian\|otsu"` under scripts/: no per-page image measures for OCR difficulty exist. sharp is the
// repo's image library.
/**
 * Family I of #7263 book-grade-model: simple measures of each judged page's image, from the bytes the judge saw
 * (#7866's img/, severity-cal's img/). Reads no database.
 *
 *   node scripts/eval/book-grade-7263/image.mjs        → OUT/feat-images.json.gz
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { OUT, C66, SEVCAL, J, W } from './lib.mjs';

const EDGE = 1000;

function otsu(hist, n) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i]; if (!wB) continue; const wF = n - wB; if (!wF) break;
    sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; t = i; }
  }
  return t;
}
/** Peaks of a smoothed profile above its mean: a rough count of text lines or columns. */
function bands(profile, minGap) {
  const k = 3, s = profile.map((_, i) => { let a = 0, c = 0; for (let j = i - k; j <= i + k; j++) if (j >= 0 && j < profile.length) { a += profile[j]; c++; } return a / c; });
  const m = s.reduce((a, b) => a + b, 0) / s.length;
  let n = 0, inBand = false, last = -minGap;
  for (let i = 0; i < s.length; i++) { if (s[i] > m && !inBand && i - last >= minGap) { n++; inBand = true; last = i; } else if (s[i] <= m) inBand = false; }
  return n;
}

export async function imageFeatures(file) {
  const meta = await sharp(file, { limitInputPixels: false }).metadata();
  const { data, info } = await sharp(file, { limitInputPixels: false }).rotate().greyscale().resize({ width: EDGE, height: EDGE, fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, n = w * h;
  const hist = new Array(256).fill(0); let mean = 0;
  for (let i = 0; i < n; i++) { hist[data[i]]++; mean += data[i]; }
  mean /= n; let v = 0; for (let i = 0; i < n; i++) v += (data[i] - mean) ** 2;
  const t = otsu(hist, n);
  let ink = 0; const row = new Array(h).fill(0), col = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (data[y * w + x] < t) { ink++; row[y]++; col[x]++; }
  // Laplacian variance (blur), on the inner pixels.
  let ls = 0, ls2 = 0, ln = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x; const L = 4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w]; ls += L; ls2 += L * L; ln++; }
  // Skew: the angle (±4°, 0.5° steps) whose row projection of ink has the largest variance.
  const pts = []; for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (data[y * w + x] < t) pts.push([x, y]);
  let bestA = 0, bestV = -1;
  for (let a = -4; a <= 4.001; a += 0.5) {
    const r = (a * Math.PI) / 180, prof = new Map();
    for (const [x, y] of pts) { const yy = Math.round(y * Math.cos(r) - x * Math.sin(r)); prof.set(yy, (prof.get(yy) ?? 0) + 1); }
    const vals = [...prof.values()], m = vals.reduce((p, q) => p + q, 0) / Math.max(1, vals.length);
    const vv = vals.reduce((p, q) => p + (q - m) ** 2, 0) / Math.max(1, vals.length);
    if (vv > bestV) { bestV = vv; bestA = a; }
  }
  // Illustration share: 25x25 blocks whose ink density exceeds 0.35 (text runs ~0.05–0.2).
  const B = 25; let blocks = 0, dense = 0;
  for (let by = 0; by + B <= h; by += B) for (let bx = 0; bx + B <= w; bx += B) {
    let k = 0; for (let y = by; y < by + B; y++) for (let x = bx; x < bx + B; x++) if (data[y * w + x] < t) k++;
    blocks++; if (k / (B * B) > 0.35) dense++;
  }
  // Gutter: the darkest-or-emptiest central column band against the page's mean column ink.
  const c0 = Math.floor(w * 0.4), c1 = Math.ceil(w * 0.6), colMean = col.reduce((a, b) => a + b, 0) / w;
  const centralMin = Math.min(...col.slice(c0, c1)), centralMax = Math.max(...col.slice(c0, c1));
  return {
    img_w: meta.width, img_h: meta.height, img_mp: (meta.width * meta.height) / 1e6, img_aspect: meta.width / meta.height, img_bytes: fs.statSync(file).size,
    grey_mean: mean, contrast: Math.sqrt(v / n), otsu_t: t, ink: ink / n,
    lap_var: ln ? ls2 / ln - (ls / ln) ** 2 : 0,
    skew_abs: Math.abs(bestA),
    lines: bands(row, 6), columns: bands(col, 40),
    gutter_empty: colMean ? centralMin / colMean : 1, gutter_dark: colMean ? centralMax / colMean : 1,
    illus_share: blocks ? dense / blocks : 0,
  };
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { rows } = J('labels.json.gz');
  const out = {}; let missing = 0;
  for (const r of rows) {
    const f = [path.join(C66, 'img', `${r.page_id}.jpg`), path.join(SEVCAL, 'img', `${r.page_id}.jpg`)].find((p) => fs.existsSync(p));
    if (!f) { missing++; continue; }
    try { out[r.page_id] = await imageFeatures(f); } catch (e) { console.error(r.page_id, e.message); missing++; }
  }
  W('feat-images.json.gz', out);
  console.log(`${Object.keys(out).length} images measured, ${missing} missing`);
}
