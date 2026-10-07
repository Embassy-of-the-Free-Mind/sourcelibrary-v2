#!/usr/bin/env node
// PRIOR ART: scripts/eval/spot-check/ (page-vs-text packs for one page at a time) — it has no before/after shape:
//   this pairs an archived SPREAD's old OCR/English with the two LEAVES cut from it (#6114 wave A by-eye review).
// Usage: node --env-file=… review.mjs <book_id> <bookdir> <outdir>   (reads <bookdir>/before.json; read-only on Mongo)
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
// Optional 4th/5th args: another snapshot file in before.json's shape (e.g. flagged.json from flagged.mjs) and a file prefix.
const [id, D, OUT, beforeFile, prefix = ''] = process.argv.slice(2);
const before = JSON.parse(fs.readFileSync(beforeFile || `${D}/before.json`, 'utf8'));
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const book = await db.collection('books').findOne({ id }, { projection: { title: 1, display_title: 1, slug: 1 } });
const live = await db.collection('pages').find({ book_id: id, page_number: { $gt: 0 } }).sort({ page_number: 1 }).toArray();
await c.close();
fs.mkdirSync(OUT, { recursive: true });
const H = 1400;
const fit = async (buf, label) => {
  const img = await sharp(buf).resize({ height: H }).toBuffer(); const m = await sharp(img).metadata();
  const svg = `<svg width="${m.width}" height="44"><rect width="100%" height="100%" fill="#222"/><text x="10" y="31" font-size="26" fill="white" font-family="sans-serif">${label}</text></svg>`;
  return { buf: await sharp({ create: { width: m.width, height: H + 44, channels: 3, background: 'white' } }).composite([{ input: Buffer.from(svg), top: 0, left: 0 }, { input: img, top: 44, left: 0 }]).jpeg().toBuffer(), w: m.width };
};
const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return Buffer.from(await r.arrayBuffer()); };
let txt = `# ${book.display_title || book.title}\nbook ${id} — https://sourcelibrary.org/book/${id} (hidden)\n`;
const rows = [];
for (const s of before.spreads) {
  const leaves = live.filter((p) => p.spread_source && p.spread_source.endsWith(`/${s.page_number}.jpg`));
  // Image order = as on the open book (left leaf, then right leaf); text order = reading order (page_number).
  const bySide = [...leaves].sort((a, b) => (a.split_side === 'left' ? 0 : 1) - (b.split_side === 'left' ? 0 : 1));
  const tiles = [await fit(fs.existsSync(`${D}/before/spread-${s.page_number}.jpg`) ? fs.readFileSync(`${D}/before/spread-${s.page_number}.jpg`) : await get(s.archived_photo || s.image_url), `BEFORE spread ${s.page_number} (cut at ${s.fold_pct}%)`)];
  for (const p of bySide) tiles.push(await fit(await get(p.archived_photo || p.photo), `AFTER leaf p.${p.page_number} (${p.split_side})`));
  let x = 0; const comp = tiles.map((t) => { const o = { input: t.buf, top: 0, left: x }; x += t.w + 16; return o; });
  const name = `${prefix}spread-${String(s.page_number).padStart(3, '0')}.jpg`;
  await sharp({ create: { width: x - 16, height: H + 44, channels: 3, background: 'white' } }).composite(comp).jpeg({ quality: 82 }).toFile(`${OUT}/${name}`);
  const newOcr = leaves.reduce((n, p) => n + (p.ocr?.data?.length || 0), 0), newTr = leaves.reduce((n, p) => n + (p.translation?.data?.length || 0), 0);
  rows.push({ spread: s.page_number, leaves: leaves.map((p) => p.page_number), old_ocr_model: s.ocr.model, old_ocr_chars: s.ocr.data.length, new_ocr_chars: newOcr, old_en_chars: s.translation.data.length, new_en_chars: newTr });
  txt += `\n${'='.repeat(100)}\nSPREAD ${s.page_number}  →  leaves ${leaves.map((p) => `p.${p.page_number} (${p.split_side})`).join(', ')}   image: ${name}\nspread image: ${s.archived_photo || s.image_url}\n${leaves.map((p) => `leaf p.${p.page_number} image: ${p.archived_photo || p.photo}`).join('\n')}\n${'='.repeat(100)}\n`;
  txt += `\n----- BEFORE: OCR of the whole spread (${s.ocr.model}, ${s.ocr.data.length} chars) -----\n${s.ocr.data}\n`;
  txt += `\n----- BEFORE: English of the whole spread (${s.translation.model}, ${s.translation.data.length} chars) -----\n${s.translation.data}\n`;
  for (const p of leaves) {
    txt += `\n----- AFTER: leaf p.${p.page_number} (${p.split_side}) OCR (${p.ocr?.model || 'none'}, ${p.ocr?.data?.length || 0} chars) — https://sourcelibrary.org/book/${id}?page=${p.page_number} -----\n${p.ocr?.data || '(no OCR)'}\n`;
    txt += `\n----- AFTER: leaf p.${p.page_number} (${p.split_side}) English (${p.translation?.model || 'none'}, ${p.translation?.data?.length || 0} chars) -----\n${p.translation?.data || '(no translation)'}\n`;
  }
}
fs.writeFileSync(`${OUT}/${prefix}before-after.txt`, txt);
fs.writeFileSync(`${OUT}/${prefix}summary.json`, JSON.stringify({ book_id: id, title: book.display_title || book.title, rows }, null, 1));
console.log(id, rows.map((r) => `s${r.spread}: ocr ${r.old_ocr_chars}→${r.new_ocr_chars}, en ${r.old_en_chars}→${r.new_en_chars}`).join(' | '));
