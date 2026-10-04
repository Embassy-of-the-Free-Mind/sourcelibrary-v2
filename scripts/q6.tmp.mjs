import { MongoClient } from 'mongodb';
import fs from 'fs';
import sharp from 'sharp';
const OUT = '/root/ocr-bakeoff-5660c/supp/eebo-tcp-latin-r3'; fs.mkdirSync(OUT + '/preview', { recursive: true });
const c = await MongoClient.connect(process.env.MONGODB_URI); const db = c.db('bookstore');
const rows = fs.readFileSync('/root/ocr-bakeoff-5660c/tcp/chosen.tsv','utf8').trim().split('\n').map(l=>l.split('\t'));
const reg = [];
for (const [b, id, pn] of rows) {
  const slug0 = `ed-${b.replace(/[^0-9a-z]/gi,'')}-p${pn}`; let buf, meta, p, book;
  try {
  book = await db.collection('books').findOne({ $or: [{ id: b }, { _id: b }] }, { projection: { title:1, year:1, published:1, language:1, author:1 } });
  p = await db.collection('pages').findOne({ book_id: b, page_number: Number(pn) }, { projection: { photo:1, 'ocr.data':1 } });
  var slug = `ed-${b.replace(/[^0-9a-z]/gi,'')}-p${pn}`;
  const res = await fetch(p.photo, { signal: AbortSignal.timeout(180000) }); buf = Buffer.from(await res.arrayBuffer());
  meta = await sharp(buf).metadata(); if (fs.existsSync(`${OUT}/${slug}.jpg`)) buf = fs.readFileSync(`${OUT}/${slug}.jpg`);
  if (meta.width > 2400) buf = await sharp(buf).resize({ width: 2400 }).jpeg({ quality: 92 }).toBuffer(); else if (meta.format !== 'jpeg') buf = await sharp(buf).jpeg({ quality: 92 }).toBuffer();
  } catch (e) { console.log('FETCH-FAIL', slug0, e.message); continue; }
  fs.writeFileSync(`${OUT}/${slug}.jpg`, buf);
  await sharp(buf).resize({ width: 1100, withoutEnlargement: true }).jpeg({ quality: 80 }).toFile(`${OUT}/preview/${slug}.jpg`);
  const ref = fs.readFileSync(`scripts/eval/benchmark/refs/${slug}.txt`, 'utf8').replace(/\s+/g, ' ').trim();
  const y = Number(book.year || String(book.published).slice(0,4));
  reg.push({ slug, book_id: b, page_number: Number(pn), tcp: id, title: book.title, year: y, language: 'Latin', image_url: p.photo, width: Math.min(2400, meta.width), bytes: buf.length });
  console.log(`\n## ${slug} ${y} ${id} | ${book.title.slice(0,60)}\n  START: ${ref.slice(0,110)}\n  END:   ${ref.slice(-110)}`);
}
fs.writeFileSync(`${OUT}/registry.json`, JSON.stringify(reg, null, 1));
await c.close();
