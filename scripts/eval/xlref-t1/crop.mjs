#!/usr/bin/env node
// PRIOR ART: none — scripts/eval has no "cut a strip of a page image for a reader to zoom into" tool (benchmark-seal exports whole pages); looked in scripts/eval/INDEX.md and scripts/lib for sharp users. No Python imaging on this box (ARM64, no PIL), so this is sharp.
/** Download a page image and cut it into N horizontal strips (or one region) so an image-check reader can read the type at full resolution. */
//   node scripts/eval/xlref-t1/crop.mjs <url> <out-prefix> [strips=4]      → <out-prefix>-full.jpg (≤1600px) + -s1..sN.jpg
import sharp from 'sharp';
const [url, prefix, n = '4'] = process.argv.slice(2);
const buf = Buffer.from(await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).arrayBuffer());
const meta = await sharp(buf).metadata();
await sharp(buf).resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(`${prefix}-full.jpg`);
const N = Number(n); const h = Math.ceil(meta.height / N); const ov = Math.round(h * 0.08);
for (let i = 0; i < N; i++) {
  const top = Math.max(0, i * h - ov); const height = Math.min(meta.height - top, h + 2 * ov);
  await sharp(buf).extract({ left: 0, top, width: meta.width, height }).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(`${prefix}-s${i + 1}.jpg`);
}
console.log(`${meta.width}x${meta.height} → ${N} strips at ${prefix}-s*.jpg`);
