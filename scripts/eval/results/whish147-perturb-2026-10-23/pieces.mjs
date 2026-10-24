// Whish 147 perturbation / preprocessing test (#7119): the leaf geometry every variant is cut from.
// For each of the 9 verse leaves: the leaf box, the two string holes and the column pieces, computed exactly as the
// stability test does, written to pieces.json; the plain colour crops go to $JOB_SCRATCH/crops/plain and are checked
// byte for byte (SHA-256) against the images the stored Opus reads saw (control/opus-1/<leaf>.meta.json).
//   JOB_SCRATCH=<dir with img/> node pieces.mjs
// PRIOR ART: ../whish147-stability-recall-2026-10-23/run.mjs (PR #7203) — holes() and the column cut are copied
// unchanged from its leafPieces(); that script also makes the sealed calls, which variants.py/read.mjs do here.
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCRATCH, HERE, boxes, sha } from './lib.mjs';

export const VERSE = ['4-b', '5-t', '5-b', '6-t', '6-b', '7-t', '8-t', '8-b', '9-t'];
const MAXW = 1600, OV = 60;

async function holes(img, box) {
  const [x0, y0, x1, y1] = box;
  const W = x1 - x0, H = y1 - y0;
  const band = { left: x0, top: y0 + Math.round(H * 0.3), width: W, height: Math.round(H * 0.4) };
  const k = 4;
  const { data, info } = await sharp(img).extract(band).greyscale().resize({ width: Math.round(W / k) }).raw().toBuffer({ resolveWithObject: true });
  const col = new Float64Array(info.width);
  for (let x = 0; x < info.width; x++) { let s = 0; for (let y = 0; y < info.height; y++) s += data[y * info.width + x]; col[x] = s / info.height; }
  const sm = col.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - 6); j <= Math.min(col.length - 1, i + 6); j++) { s += col[j]; n++; } return s / n; });
  const argmin = (a, b) => { let bi = a; for (let i = a; i < b; i++) if (sm[i] < sm[bi]) bi = i; return bi; };
  const w = info.width;
  const h1 = argmin(Math.round(w * 0.2), Math.round(w * 0.45)), h2 = argmin(Math.round(w * 0.55), Math.round(w * 0.8));
  return [x0 + h1 * k, x0 + h2 * k];
}

/** Column pieces of a box with holes at h1, h2: cut at the holes, a column over MAXW split in two. */
export function cutPieces(box, h1, h2) {
  const cols = [[box[0], h1 + OV], [h1 - OV, h2 + OV], [h2 - OV, box[2]]];
  const pieces = [];
  for (const [a, b] of cols) {
    if (b - a <= MAXW) pieces.push([a, b]);
    else { const m = Math.round((a + b) / 2); pieces.push([a, m + OV], [m - OV, b]); }
  }
  return pieces;
}

async function main() {
  const B = boxes(), out = {};
  const dir = path.join(SCRATCH, 'crops', 'plain');
  fs.mkdirSync(dir, { recursive: true });
  for (const key of VERSE) {
    const [n, leaf] = key.split('-');
    const img = path.join(SCRATCH, 'img', `${n}.jpg`);
    const bx = B[n].leaves[leaf];
    const box = [bx.L[0], bx.L[1], bx.R[2], bx.L[3]];
    const [h1, h2] = await holes(img, box);
    const pieces = cutPieces(box, h1, h2);
    const ref = JSON.parse(fs.readFileSync(path.join(HERE, 'control', 'opus-1', `${key}.meta.json`), 'utf8')).images;
    const shas = [];
    for (let i = 0; i < pieces.length; i++) {
      const f = path.join(dir, `${key}-${i + 1}.jpg`);
      await sharp(img).extract({ left: pieces[i][0], top: box[1], width: pieces[i][1] - pieces[i][0], height: box[3] - box[1] }).jpeg({ quality: 92 }).toFile(f);
      shas.push(sha(fs.readFileSync(f)));
    }
    const same = ref.length === shas.length && ref.every((r, i) => r.sha256 === shas[i]);
    const { width, height } = await sharp(img).metadata();
    out[key] = { page: Number(n), leaf, img_size: [width, height], box, holes: [h1, h2], pieces, plain_matches_control: same };
    console.log(key, box, [h1, h2], pieces.length, 'pieces', same ? 'SHA match' : 'SHA MISMATCH');
  }
  fs.writeFileSync(path.join(HERE, 'pieces.json'), JSON.stringify(out, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
