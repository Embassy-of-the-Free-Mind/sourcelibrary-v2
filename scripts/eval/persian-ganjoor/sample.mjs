// PRIOR ART: scripts/eval/nalanda-readiness/sample_skt.mjs (same one-page-per-book interior draw, same seeded LCG) —
// this variant reads the Persian poetry book list for #5525 and keeps the OCR header tags (<language>, <script>,
// <scan-quality>) the stratification needs.
// Usage: node --env-file=.env.production.local scripts/eval/persian-ganjoor/sample.mjs  → persian-sample.jsonl (cwd)
import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
const here = path.dirname(new URL(import.meta.url).pathname);
const books = fs.readFileSync(path.join(here, 'poetry-books.tsv'), 'utf8').trim().split('\n').filter(l => !l.startsWith('#')).map(l => l.split('\t'));
let seed = 20261001; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const tag = (t, n) => (t.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`)) || [])[1]?.trim() || null;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const out = fs.createWriteStream('persian-sample.jsonl');
let n = 0;
for (const [id, title, poets] of books) {
  const b = await db.collection('books').findOne({ $or: [{ id }, { _id: id }] }, { projection: { published: 1, image_source: 1, language: 1 } });
  const cand = await db.collection('pages').find({ book_id: id, 'ocr.data': { $exists: true } },
    { projection: { page_number: 1, ocr: 1, archived_photo: 1, photo: 1 } }).toArray();
  // A text page with ≥ 400 Arabic-script letters in the BODY (meta/vocab/image-desc stripped), so a title page,
  // a colophon medallion grid or a miniature is not drawn (the first draw took a 2009 title page whose <vocab> passed).
  const body = t => (t || '').replace(/<(meta|vocab|image-desc|summary|keywords|warning)[^>]*>[\s\S]*?<\/\1>/g, ' ');
  const ok = cand.filter(p => !/<page-type>(?!text)/.test(p.ocr.data || '') && (body(p.ocr.data).match(/[ء-ۿ]/g) || []).length >= 400)
    .sort((a, b) => a.page_number - b.page_number);
  if (!ok.length) { console.log('no usable OCR page', id, title, cand.length); continue; }
  const lo = Math.floor(ok.length * 0.2), hi = Math.max(lo + 1, Math.floor(ok.length * 0.8));
  const p = ok[lo + Math.floor(rnd() * (hi - lo))];
  const t = p.ocr.data;
  out.write(JSON.stringify({ id: `${id}_${p.page_number}`, book_id: id, ganjoor_poets: poets === '-' ? [] : poets.split(',').map(Number), page_number: p.page_number, title, published: b?.published,
    provider: b?.image_source?.provider || null, image: p.archived_photo || p.photo, arm: p.ocr.model || p.ocr.source || 'unknown',
    ocr_source: p.ocr.source || null, tag_language: tag(t, 'language'), tag_script: tag(t, 'script'), tag_scan_quality: tag(t, 'scan-quality'),
    tag_warning: tag(t, 'warning'), text: t }) + '\n');
  n++;
}
out.end(); console.log('sampled', n); await c.close();
