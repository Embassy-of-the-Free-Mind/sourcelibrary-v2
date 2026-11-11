#!/usr/bin/env node
// PRIOR ART: none — the #5924 spot check's readers zoomed by hand; this gives the by-eye readers one command for it.
// crop.mjs <image> <x0> <y0> <x1> <y1> <out.jpg> — fractions 0–1 of width/height; writes the region at ≤ 1600 px.
import sharp from 'sharp';
const [img, x0, y0, x1, y1, out] = process.argv.slice(2);
const m = await sharp(img).metadata();
const L = Math.round(+x0 * m.width), T = Math.round(+y0 * m.height);
await sharp(img).extract({ left: L, top: T, width: Math.round((+x1 - +x0) * m.width), height: Math.round((+y1 - +y0) * m.height) })
  .resize(1600, 1600, { fit: 'inside' }).jpeg({ quality: 90 }).toFile(out);
console.log(out);
