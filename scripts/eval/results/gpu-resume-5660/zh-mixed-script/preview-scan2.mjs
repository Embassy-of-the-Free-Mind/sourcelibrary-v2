// #5660 resume A2 (v2): per book, from the stored preview OCR: <language> tags naming a non-Chinese language, and
// non-Han script characters in the BODY (meta/warning/notes stripped, so a seal described in a note does not count)
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const ids = Object.keys(JSON.parse(fs.readFileSync('../../zh/books.json', 'utf8')));
const NONHAN = /[᠀-᢯\u{11660}-\u{1167F}ༀ-࿿؀-ۿऀ-ॿ\u{17000}-\u{18AFF}]/gu;
const out = fs.createWriteStream('preview-scan2.jsonl');
for (let i = 0; i < ids.length; i += 50) {
  const pages = await db.collection('pages').find({ book_id: { $in: ids.slice(i, i + 50) }, 'ocr.data': { $exists: true, $ne: '' } }, { projection: { book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1 } }).toArray();
  const by = {};
  for (const p of pages) (by[p.book_id] ??= []).push(p);
  for (const bid of ids.slice(i, i + 50)) {
    const ps = by[bid] || []; const langPages = []; const bodyPages = [];
    for (const p of ps) {
      const t = String(p.ocr.data);
      const lang = (t.match(/<language>([^<]*)<\/language>/) || [])[1] || '';
      if (lang && /manchu|mongol|tibet|sanskrit|arabic|persian|uyghur|uighur|tangut|siddham|devanagari|滿|蒙|藏|梵/i.test(lang)) langPages.push([p.page_number, lang, p.ocr.model]);
      const body = t.replace(/<(meta|warning|note|notes|header|margin)>[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>[^<]*<\/[^>]+>/g, m => /^<(language|script|page-type|columns|page-num|scan-quality)>/.test(m) ? '' : m);
      const n = (body.match(NONHAN) || []).length;
      if (n >= 10) bodyPages.push([p.page_number, n, p.ocr.model]);
    }
    out.write(JSON.stringify({ bid, n: ps.length, langPages, bodyPages }) + '\n');
  }
}
out.end(); await new Promise(r => out.on('finish', r)); await c.close();
