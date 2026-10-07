#!/usr/bin/env node
/**
 * Wave-1 triage for #6114 step 3: per candidate book, read the fields that decide "skip" (already
 * split, held, hidden_reason) and draw a 4-page contact strip for the by-eye "is this a spread book" call.
 * PRIOR ART: scripts/audit/spread-screen.mjs (the screen that produced the candidates; no images);
 *   scripts/batch/spread-folds.mjs (fold band sheets, not whole pages). Read-only.
 * Usage: node --env-file=… scripts/batch/split-wave1-6114/triage.mjs <wave1.tsv> <outdir>
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import { pageImageUrl } from '../../eval/spot-check/lib.mjs';

const [tsv, OUT] = process.argv.slice(2);
fs.mkdirSync(`${OUT}/strips`, { recursive: true });
const rows = fs.readFileSync(tsv, 'utf8').trim().split('\n').slice(1).map((l) => l.split('\t'));
const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const done = new Set(fs.existsSync(`${OUT}/triage.jsonl`) ? fs.readFileSync(`${OUT}/triage.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).id) : []);
const TW = 480, TH = 400;
const get = async (url) => { const r = await fetch(url, { signal: AbortSignal.timeout(40000) }); if (!r.ok) throw new Error(`${r.status}`); return Buffer.from(await r.arrayBuffer()); };

let n = 0;
const one = async ([id, provider, language, , medianAr]) => {
  if (done.has(id)) return;
  const book = await db.collection('books').findOne({ id }, { projection: { id: 1, title: 1, language: 1, visible: 1, hidden: 1, hidden_reason: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, split_completed: 1, needs_splitting: 1, 'pipeline_auto.status': 1, 'pipeline_auto.hold': 1, 'publication.state': 1, read_count: 1 } });
  const pages = await db.collection('pages').find({ book_id: id, page_number: { $gt: 0 }, page_type: { $ne: 'archived-spread' } }, { projection: { page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, split_from: 1, crop: 1, image_width: 1, image_height: 1, 'ocr.data': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
  const split = pages.some((p) => p.split_from_spread || p.split_from || p.crop || p.cropped_photo);
  const hosts = {}; for (const p of pages) { const u = pageImageUrl(p); const h = u ? new URL(u).host : 'none'; hosts[h] = (hosts[h] || 0) + 1; }
  const row = { id, provider, language, medianAr: +medianAr, title: (book?.title || '').slice(0, 90), pages: pages.length, pages_count: book?.pages_count, visible: book?.visible, hidden_reason: book?.hidden_reason || null, held: !!book?.pipeline_auto?.hold, status: book?.pipeline_auto?.status, split, hosts,
    ocr_pages: pages.filter((p) => p.ocr?.data).length, tr_pages: pages.filter((p) => p.translation?.data).length, ocr_chars: pages.reduce((a, p) => a + (p.ocr?.data?.length || 0), 0), read_count: book?.read_count || 0 };
  // 4 pages spread through the book (not the covers)
  const pick = [0.2, 0.4, 0.6, 0.8].map((f) => pages[Math.min(pages.length - 1, Math.floor(pages.length * f))]).filter(Boolean);
  const tiles = [];
  for (const p of pick) {
    try {
      const buf = await get(pageImageUrl(p));
      tiles.push(await sharp(buf).resize({ width: TW, height: TH, fit: 'contain', background: '#888' }).toBuffer());
    } catch (e) { row.img_err = (row.img_err || 0) + 1; tiles.push(await sharp({ create: { width: TW, height: TH, channels: 3, background: '#f00' } }).png().toBuffer()); }
  }
  const label = `<svg width="${TW * 4}" height="34"><rect width="100%" height="100%" fill="white"/><text x="6" y="25" font-size="22" font-family="sans-serif">${id} · ${provider} · ${language} · ${pages.length}pp · AR ${medianAr} · p${pick.map((p) => p.page_number).join(',')}</text></svg>`;
  await sharp({ create: { width: TW * 4, height: TH + 34, channels: 3, background: 'white' } })
    .composite([{ input: Buffer.from(label), top: 0, left: 0 }, ...tiles.map((t, i) => ({ input: t, left: i * TW, top: 34 }))]).jpeg({ quality: 80 }).toFile(`${OUT}/strips/${id}.jpg`);
  fs.appendFileSync(`${OUT}/triage.jsonl`, JSON.stringify(row) + '\n');
  if (++n % 20 === 0) console.log(n);
};
for (let i = 0; i < rows.length; i += 6) await Promise.all(rows.slice(i, i + 6).map((r) => one(r).catch((e) => console.log('ERR', r[0], e.message))));
await client.close();
// sheets of 5 books
const ids = fs.readFileSync(`${OUT}/triage.jsonl`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id).filter((id) => fs.existsSync(`${OUT}/strips/${id}.jpg`));
const index = [];
for (let s = 0; s * 5 < ids.length; s++) {
  const chunk = ids.slice(s * 5, s * 5 + 5);
  const name = `triage-${String(s + 1).padStart(2, '0')}.jpg`;
  const full = await sharp({ create: { width: TW * 4, height: chunk.length * (TH + 40), channels: 3, background: 'white' } })
    .composite(chunk.map((id, i) => ({ input: `${OUT}/strips/${id}.jpg`, left: 0, top: i * (TH + 40) }))).png().toBuffer();
  await sharp(full).resize({ width: 1600 }).jpeg({ quality: 78 }).toFile(`${OUT}/${name}`);
  index.push({ sheet: name, ids: chunk });
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1));
console.log(`${ids.length} books, ${index.length} sheets`);
