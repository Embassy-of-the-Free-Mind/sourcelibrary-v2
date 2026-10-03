#!/usr/bin/env node
// PRIOR ART: none — where I looked: scripts/eval/lib/ (no image helpers), scripts/lib/ (sharp is used inside pipeline writers, not as a CLI). A reader needs to zoom into a page image to check an OCR reading by eye (#5695 addendum 3).
/** Crop a region of a page image (fractions 0–1) and upscale it, for reading a line by eye. */
//   node scripts/eval/xlref-t4/crop.mjs <in.jpg> <out.jpg> <x0> <y0> <x1> <y1> [scale=2]
import sharp from 'sharp';
const [IN, OUT, x0, y0, x1, y1, scale = 2] = process.argv.slice(2);
const m = await sharp(IN).metadata();
const left = Math.round(m.width * x0), top = Math.round(m.height * y0);
const width = Math.min(m.width - left, Math.round(m.width * (x1 - x0))), height = Math.min(m.height - top, Math.round(m.height * (y1 - y0)));
await sharp(IN).extract({ left, top, width, height }).resize({ width: Math.round(width * scale) }).jpeg({ quality: 90 }).toFile(OUT);
console.log(`${OUT}: ${width}x${height} ×${scale}`);
