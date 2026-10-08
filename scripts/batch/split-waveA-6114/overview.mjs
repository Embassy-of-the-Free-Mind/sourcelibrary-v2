#!/usr/bin/env node
/**
 * Whole-page thumbnail sheets for one unsplit book (#6114): the fold band sheets of spread-folds.mjs cannot show
 * whether a page is a cover, a board or a double-page plate, so the reviewer also gets every page small.
 * PRIOR ART: scripts/batch/spread-folds.mjs (band sheets only). Read-only.
 * Usage: node --env-file=… overview.mjs <book_id> <outdir> [only-pages.json] [positions.json]
 *   with positions.json the fold is drawn red on each thumbnail (null = "WHOLE" label).
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import { pageImageUrl } from '../../eval/spot-check/lib.mjs';
const [bookId, OUT, onlyF, posF] = process.argv.slice(2);
fs.mkdirSync(OUT, { recursive: true });
const ONLY = onlyF && onlyF !== '-' ? new Set(JSON.parse(fs.readFileSync(onlyF, 'utf8')).map(String)) : null;
const POS = posF ? JSON.parse(fs.readFileSync(posF, 'utf8')) : null;
const client = await MongoClient.connect(process.env.MONGODB_URI);
const pages = (await client.db('bookstore').collection('pages').find({ book_id: bookId, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } }).sort({ page_number: 1 }).toArray())
  .filter((p) => !ONLY || ONLY.has(String(p.page_number)));
await client.close();
const TW = POS ? 400 : 250, TH = POS ? 330 : 210, COLS = POS ? 4 : 6, PER = POS ? 16 : 36;
const tile = async (p) => {
  let img;
  try {
    const r = await fetch(pageImageUrl(p), { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(r.status);
    img = await sharp(Buffer.from(await r.arrayBuffer())).resize({ width: TW, height: TH, fit: 'fill' }).toBuffer();
  } catch { img = await sharp({ create: { width: TW, height: TH, channels: 3, background: '#f00' } }).jpeg().toBuffer(); }
  let svg = `<rect x="0" y="0" width="70" height="24" fill="white"/><text x="3" y="19" font-size="19" font-weight="bold" font-family="sans-serif">p${p.page_number}</text>`;
  if (POS) {
    const f = POS[p.page_number];
    svg += f == null ? `<rect x="${TW - 90}" y="0" width="90" height="24" fill="yellow"/><text x="${TW - 86}" y="19" font-size="18" font-family="sans-serif">WHOLE</text>`
      : `<line x1="${f / 100 * TW}" y1="0" x2="${f / 100 * TW}" y2="${TH}" stroke="red" stroke-width="1.5"/>`;
  }
  return sharp(img).composite([{ input: Buffer.from(`<svg width="${TW}" height="${TH}">${svg}</svg>`), top: 0, left: 0 }]).png().toBuffer();
};
const index = [];
for (let s = 0; s * PER < pages.length; s++) {
  const chunk = pages.slice(s * PER, (s + 1) * PER); const tiles = [];
  for (let i = 0; i < chunk.length; i += 6) tiles.push(...await Promise.all(chunk.slice(i, i + 6).map(tile)));
  const name = `ov-${String(s + 1).padStart(3, '0')}.jpg`;
  await sharp({ create: { width: COLS * (TW + 4), height: Math.ceil(tiles.length / COLS) * (TH + 4), channels: 3, background: 'white' } })
    .composite(tiles.map((t, i) => ({ input: t, left: (i % COLS) * (TW + 4), top: Math.floor(i / COLS) * (TH + 4) }))).jpeg({ quality: 78 }).toFile(`${OUT}/${name}`);
  index.push({ sheet: name, pages: chunk.map((p) => p.page_number) });
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index));
console.log(`${index.length} overview sheets -> ${OUT}`);
