// PRIOR ART: src/lib image-crop helpers crop by stored bboxes (gallery/deep-zoom), not by finding the printed area of
// an uncropped leaf; render.mjs had no cropping at all. This finds the plate or text block on a scanned leaf.
//
// Crop a scanned leaf to the printed image: drop the paper margins, the binding edge and the library's stamp area.
//
//   autoCrop(srcPath, outPath, { pad = 0.015 }) -> { left, top, width, height }
//
// How: mark "ink" pixels (clearly darker than the paper), measure ink density per column and per row, and keep the
// longest dense band in each direction. Paper margins have almost no ink; the binding edge or a neighbouring leaf is a
// separate, narrower band, so the longest band is the plate. Small gaps inside the plate (white sky, blank cartouche)
// are bridged. Always LOOK at the result: a leaf with two separate images, or a stamp touching the plate, can fool it.
import sharp from 'sharp';

function longestBand(density, threshold, maxGap) {
  let best = [0, density.length - 1], bestLen = 0, start = -1, lastHit = -1;
  for (let i = 0; i <= density.length; i++) {
    const hit = i < density.length && density[i] > threshold;
    if (hit) {
      if (start < 0) start = i;
      lastHit = i;
    } else if (start >= 0 && (i - lastHit > maxGap || i === density.length)) {
      if (lastHit - start > bestLen) { bestLen = lastHit - start; best = [start, lastHit]; }
      start = -1;
    }
  }
  return best;
}

export async function autoCrop(src, out, { pad = 0.015 } = {}) {
  const meta = await sharp(src).metadata();
  const W = 600, scale = meta.width / W;
  const { data, info } = await sharp(src).resize(W).greyscale().blur(1.5).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const sorted = Float32Array.from(data).sort();
  const paper = sorted[Math.floor(sorted.length * 0.9)]; // the bright end of the leaf is paper
  const ink = (v) => v < paper - 45;
  const cols = new Float32Array(w), rows = new Float32Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(data[y * w + x])) { cols[x]++; rows[y]++; }
  for (let x = 0; x < w; x++) cols[x] /= h;
  for (let y = 0; y < h; y++) rows[y] /= w;
  const [x0, x1] = longestBand(cols, 0.04, Math.round(w * 0.03));
  const [y0, y1] = longestBand(rows, 0.04, Math.round(h * 0.03));
  const p = Math.round(pad * w);
  const box = {
    left: Math.max(0, Math.round((x0 - p) * scale)),
    top: Math.max(0, Math.round((y0 - p) * scale)),
  };
  box.width = Math.min(meta.width - box.left, Math.round((x1 - x0 + 2 * p) * scale));
  box.height = Math.min(meta.height - box.top, Math.round((y1 - y0 + 2 * p) * scale));
  await sharp(src).extract(box).jpeg({ quality: 92 }).toFile(out);
  return box;
}

// CLI: node crop.mjs in.jpg out.jpg
if (import.meta.url === `file://${process.argv[1]}`) {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: crop.mjs <in.jpg> <out.jpg>'); process.exit(2); }
  console.log(JSON.stringify(await autoCrop(src, out)));
}
