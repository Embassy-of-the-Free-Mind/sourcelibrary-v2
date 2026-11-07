#!/usr/bin/env node
// PRIOR ART: scripts/lib/agy-cli.mjs gatedImageCall (takes a JPEG buffer, fetches nothing); the #5311 leaf check
// (fetched served images for 311 pages but kept no reusable script). This fetches the SERVED image of every item in a
// draw's manifest (the URL draw stored in `image`) to a local dir, downscaled so a judge can read it in one view.
//
//   node scripts/eval/translation-corpus-audit/fetch-images.mjs --dir <run dir> --out $JOB_SCRATCH/images [--max 1800]
// Writes <out>/<book_id>-<page_number>.jpg and <dir>/images.json ({ item id → { file, url, width, height, bytes } }).
// Controls share their source page's image (a swap keeps the source's leaf; only the translation is foreign).

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true] : []).filter(Boolean));
const DIR = args.dir, OUT = args.out, MAX = Number(args.max || 1800);
if (!DIR || !OUT) { console.error('--dir and --out required'); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });
const manifest = fs.readFileSync(path.join(DIR, 'manifest.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const mapFile = path.join(DIR, 'images.json');
const map = fs.existsSync(mapFile) ? JSON.parse(fs.readFileSync(mapFile, 'utf8')) : {};

const cache = {};
async function fetchOne(m) {
  const file = path.join(OUT, `${m.book_id}-${m.page_number}.jpg`);
  if (cache[file]) return cache[file];
  if (fs.existsSync(file)) { const meta = await sharp(file).metadata(); return (cache[file] = { file, url: m.image, width: meta.width, height: meta.height, bytes: fs.statSync(file).size }); }
  if (!m.image) return (cache[file] = { file: null, url: null, error: 'no image url' });
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await fetch(m.image, { headers: { 'User-Agent': 'SourceLibrary-eval/1.0 (+https://sourcelibrary.org; #5274)' }, signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      const img = sharp(buf).rotate().resize({ width: MAX, height: MAX, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 });
      const out = await img.toBuffer({ resolveWithObject: true });
      fs.writeFileSync(file, out.data);
      return (cache[file] = { file, url: m.image, width: out.info.width, height: out.info.height, bytes: out.data.length });
    } catch (e) {
      if (attempt === 3) return (cache[file] = { file: null, url: m.image, error: e.message });
      await new Promise((res) => setTimeout(res, 2000 * attempt));
    }
  }
}
let ok = 0, bad = 0;
const queue = manifest.filter((m) => !map[m.id]?.file);
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const m = queue.shift();
    const r = await fetchOne(m);
    map[m.id] = r;
    if (r.file) ok++; else { bad++; console.error('image failed', m.id, m.image, r.error); }
  }
}));
fs.writeFileSync(mapFile, JSON.stringify(map, null, 1));
console.error(`images: ${ok} fetched, ${bad} failed, ${Object.keys(map).length} mapped → ${mapFile}`);
