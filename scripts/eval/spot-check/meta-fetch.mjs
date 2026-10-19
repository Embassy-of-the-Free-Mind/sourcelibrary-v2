#!/usr/bin/env node
/**
 * Fetch a page image and write a reader-sized JPEG (long edge 1600 px) for a metadata reviewer to open.
 * No Mongo, no model.
 *
 * PRIOR ART: none for this shape — draw.mjs leaves reviewers to open images by URL; on this box there is
 * no ImageMagick, and full IIIF masters (1.5–8 MB) are too large to read, so this resizes with sharp.
 *
 *   node scripts/eval/spot-check/meta-fetch.mjs <image-url> <out.jpg> [--edge 1600]
 */
import sharp from 'sharp';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, out] = process.argv.slice(2);
const i = process.argv.indexOf('--edge');
const EDGE = i > 0 ? Number(process.argv[i + 1]) : 1600;
if (!url || !out) { console.error('usage: meta-fetch.mjs <url> <out.jpg>'); process.exit(2); }
const res = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'SourceLibrary-metadata-check/1.0' } });
if (!res.ok) { console.error(`HTTP ${res.status} ${url}`); process.exit(1); }
const buf = Buffer.from(await res.arrayBuffer());
mkdirSync(dirname(out), { recursive: true });
const img = await sharp(buf).rotate().resize({ width: EDGE, height: EDGE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
writeFileSync(out, img);
const m = await sharp(img).metadata();
console.log(`${out} ${m.width}x${m.height} ${(img.length / 1024).toFixed(0)}KB`);
