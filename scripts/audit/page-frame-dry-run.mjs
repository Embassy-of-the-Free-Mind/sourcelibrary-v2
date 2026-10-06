#!/usr/bin/env node
/**
 * Page-frame dry run (#5876): what would the dark-border detector store, and
 * does it look right? READ-ONLY — never writes to Mongo or R2.
 *
 * Samples up to --per-provider books per image provider (one random page per
 * book: pages in a book are one observation), runs detectPageFrame on the
 * page's display image, and writes:
 *   <out>/results.jsonl     one row per sampled page
 *   <out>/summary.json      counts by provider × verdict
 *   <out>/sheet-<n>.jpg     contact sheets of 'frame' verdicts, box drawn in red
 *   <out>/sheet-skip.jpg    the pages it refused (multi-leaf / too-much)
 * Spot-check the sheets by eye before any sweep writes a frame.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/page-frame-dry-run.mjs \
 *     [--per-provider=20] [--out=scratchpad/page-frame] [--provider=bl]
 *
 * PRIOR ART: scripts/auto-crop-black-borders.mjs — single-book writer that
 * rewrites images; this is a read-only, cross-provider sample with sheets.
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { detectPageFrame, toPageFrame } from '../../src/lib/page-frame.ts';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? d;
const PER = Number(arg('per-provider', '20'));
const OUT = arg('out', 'scratchpad/page-frame');
const ONLY = arg('provider', null);
const R2 = /^https:\/\/images\.sourcelibrary\.org\//;
const ANALYSIS = 256;
const TILE = 240;

fs.mkdirSync(OUT, { recursive: true });
const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

const providers = ONLY ? [ONLY] : (await db.collection('books').aggregate([
  { $match: { visible: true, pages_count: { $gt: 4 } } },
  { $group: { _id: '$image_source.provider', n: { $sum: 1 } } },
  { $match: { n: { $gte: 5 } } },
  { $sort: { n: -1 } },
]).toArray()).map(p => p._id).filter(Boolean);

const sample = [];
for (const provider of providers) {
  const books = await db.collection('books').aggregate([
    { $match: { visible: true, pages_count: { $gt: 4 }, 'image_source.provider': provider } },
    { $sample: { size: PER } },
    { $project: { _id: 0, id: 1, pages_count: 1 } },
  ]).toArray();
  for (const b of books) sample.push({ ...b, provider });
}
console.log(`providers ${providers.length}, books ${sample.length}`);

async function analyse(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`http ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).greyscale()
    .resize(ANALYSIS, ANALYSIS, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  return { buf, verdict: detectPageFrame(data, info.width, info.height), w: info.width, h: info.height };
}

const rows = [];
let next = 0;
await Promise.all(Array.from({ length: 10 }, async () => {
  while (next < sample.length) {
    const b = sample[next++];
    const pn = 1 + Math.floor(Math.random() * b.pages_count);
    const p = await db.collection('pages').findOne(
      { book_id: b.id, page_number: pn },
      { projection: { _id: 0, display_photo: 1, archived_photo: 1, crop: 1, split_from_spread: 1 } },
    );
    const url = [p?.display_photo, p?.archived_photo].find(u => u && R2.test(u));
    if (!url) { rows.push({ ...b, pn, verdict: 'no-r2-image' }); continue; }
    try {
      const { verdict, w, h } = await analyse(url);
      rows.push({
        ...b, pn, url, w, h,
        split: !!(p.crop || p.split_from_spread),
        verdict: verdict.kind === 'skip' ? `skip:${verdict.reason}` : verdict.kind,
        box: verdict.kind === 'frame' ? verdict.box : undefined,
        frame: verdict.kind === 'frame' ? toPageFrame(verdict.box, w, h) : undefined,
      });
    } catch (e) {
      rows.push({ ...b, pn, url, verdict: 'error', error: String(e.message || e) });
    }
  }
}));
await client.close();

fs.writeFileSync(path.join(OUT, 'results.jsonl'), rows.map(r => JSON.stringify(r)).join('\n') + '\n');
const summary = {};
for (const r of rows) {
  summary[r.provider] ??= {};
  summary[r.provider][r.verdict] = (summary[r.provider][r.verdict] || 0) + 1;
}
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 1));

/** Contact sheet, 6 across; each tile labelled with its index (see the key file). */
async function sheet(items, file) {
  if (!items.length) return;
  const tiles = [];
  let key = '';
  for (const [i, r] of items.entries()) {
    try {
      const buf = Buffer.from(await (await fetch(r.url, { signal: AbortSignal.timeout(20000) })).arrayBuffer());
      const base = await sharp(buf).resize(r.w, r.h, { fit: 'fill' }).png().toBuffer();
      const rect = r.box ? `<rect x="${r.box.x}" y="${r.box.y}" width="${r.box.w}" height="${r.box.h}" fill="none" stroke="red" stroke-width="2"/>` : '';
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r.w}" height="${r.h}">${rect}<rect x="0" y="0" width="${r.w}" height="15" fill="black" opacity="0.6"/><text x="3" y="11" font-size="11" fill="#7f7">${i} ${r.provider}</text></svg>`;
      const tile = await sharp(await sharp(base).composite([{ input: Buffer.from(svg) }]).png().toBuffer())
        .resize(TILE, TILE, { fit: 'contain', background: '#777' }).png().toBuffer();
      tiles.push({ input: tile, left: (i % 6) * TILE, top: Math.floor(i / 6) * TILE });
      key += `${i}\t${r.provider}\t${r.id}\tp${r.pn}\t${r.verdict}\t${r.frame ? `kept=${(r.frame.w * r.frame.h).toFixed(2)}` : ''}\thttps://sourcelibrary.org/book/${r.id}?page=${r.pn}\n`;
    } catch { key += `${i}\t(fetch failed)\n`; }
  }
  await sharp({ create: { width: 6 * TILE, height: Math.ceil(items.length / 6) * TILE, channels: 3, background: '#777' } })
    .composite(tiles).jpeg({ quality: 82 }).toFile(path.join(OUT, file));
  fs.writeFileSync(path.join(OUT, file.replace(/\.jpg$/, '.txt')), key);
}

const framed = rows.filter(r => r.verdict === 'frame');
for (let s = 0; s * 36 < framed.length; s++) await sheet(framed.slice(s * 36, s * 36 + 36), `sheet-${s + 1}.jpg`);
await sheet(rows.filter(r => r.verdict.startsWith('skip:') && r.url && r.w).slice(0, 36), 'sheet-skip.jpg');

const tally = rows.reduce((a, r) => (a[r.verdict] = (a[r.verdict] || 0) + 1, a), {});
console.log('verdicts', JSON.stringify(tally));
console.log(`wrote ${OUT}/results.jsonl, summary.json, ${Math.ceil(framed.length / 36)} frame sheet(s), sheet-skip.jpg`);
