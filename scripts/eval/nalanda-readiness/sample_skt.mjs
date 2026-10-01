// PRIOR ART: sample_tib.mjs in this folder (same one-page-per-book draw) — this variant takes every Sanskrit/Pali book with OCR, visible and hidden.
// One page per book, served ocr.data as-is. Tibetan: 65 Kanjur-titled BL books + 25 other BL + all visible IA/BDRC w/ OCR.
import { MongoClient } from 'mongodb';
import fs from 'fs';
const rows = fs.readFileSync('holdings-books.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
let seed = 20260930; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const tib = rows.filter(r => (r.language === "Sanskrit" || r.language === "Pali") && r.ocr > 5);
const kanjur = [];
const other = [];
const print = tib;
const pick = [...kanjur.map(r => [r, 'bl-kanjur']), ...other.map(r => [r, 'bl-other']), ...print.map(r => [r, (r.visible ? 'visible' : 'hidden') + ':' + r.language])];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = fs.createWriteStream('skt-sample.jsonl');
let n = 0;
for (const [b, stratum] of pick) {
  const cand = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.model': 1 } }).toArray();
  const ok = cand.filter(p => (p.ocr.data || '').length >= 500).sort((a, b) => a.page_number - b.page_number);
  if (!ok.length) continue;
  const lo = Math.floor(ok.length * 0.2), hi = Math.max(lo + 1, Math.floor(ok.length * 0.8));
  const p = ok[lo + Math.floor(rnd() * (hi - lo))];
  out.write(JSON.stringify({ id: `${b.id}_${p.page_number}`, book_id: b.id, page_number: p.page_number, stratum, title: b.title, image_source: b.image_source,
    arm: p.ocr.model || p.ocr.source || 'unknown', text: p.ocr.data, has_en: !!(p.translation?.data), en_model: p.translation?.model || null }) + '\n');
  n++;
}
out.end(); console.log('sampled', n); await c.close();
