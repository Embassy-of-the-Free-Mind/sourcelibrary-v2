// PRIOR ART: ops eval-tibetan/mss_sample.mjs (one page per book, but BL manuscripts only, and it samples pre-Yigdzin text); this samples the SERVED text as-is across Kanjur/other/print strata.
// One page per book, served ocr.data as-is. Tibetan: 65 Kanjur-titled BL books + 25 other BL + all visible IA/BDRC w/ OCR.
import { MongoClient } from 'mongodb';
import fs from 'fs';
const rows = fs.readFileSync('holdings-books.jsonl', 'utf8').trim().split('\n').map(JSON.parse);
let seed = 20260930; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const tib = rows.filter(r => r.language === 'Tibetan' && r.visible && r.ocr > 20);
const kanjur = shuffle(tib.filter(r => r.image_source === 'bl' && /kanjur/i.test(r.title || ''))).slice(0, 65);
const other = shuffle(tib.filter(r => r.image_source === 'bl' && !/kanjur/i.test(r.title || ''))).slice(0, 25);
const print = shuffle(tib.filter(r => r.image_source !== 'bl')).slice(0, 15);
const pick = [...kanjur.map(r => [r, 'bl-kanjur']), ...other.map(r => [r, 'bl-other']), ...print.map(r => [r, 'print'])];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
const out = fs.createWriteStream('tib-sample.jsonl');
let n = 0;
for (const [b, stratum] of pick) {
  const cand = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1, 'translation.data': 1, 'translation.model': 1 } }).toArray();
  const ok = cand.filter(p => (p.ocr.data || '').length >= 600).sort((a, b) => a.page_number - b.page_number);
  if (!ok.length) continue;
  const lo = Math.floor(ok.length * 0.2), hi = Math.max(lo + 1, Math.floor(ok.length * 0.8));
  const p = ok[lo + Math.floor(rnd() * (hi - lo))];
  out.write(JSON.stringify({ id: `${b.id}_${p.page_number}`, book_id: b.id, page_number: p.page_number, stratum, title: b.title, image_source: b.image_source,
    arm: p.ocr.model || p.ocr.source || 'unknown', text: p.ocr.data, has_en: !!(p.translation?.data), en_model: p.translation?.model || null }) + '\n');
  n++;
}
out.end(); console.log('sampled', n); await c.close();
