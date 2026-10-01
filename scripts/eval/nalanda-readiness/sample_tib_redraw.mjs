// PRIOR ART: scripts/eval/nalanda-readiness/sample_tib.mjs (the 2026-09-30 draw: one served page per book, 65 Kanjur
// + 25 other BL + 15 print, seed 20260930, from a holdings file). This is the CONFIRMATORY re-draw of 2026-10-01:
// fresh seed, 100 Kanjur books, the 105 pages of the 09-30 draw EXCLUDED, books queried directly (no holdings
// file), and two extra fields the first draw lacked — the page's OCR line count against the book's median, as a
// proxy for the dropped-line defect that order-free identity cannot see (EXPERIMENTS 2026-09-25, Yigdzin).
//   cd /root/sourcelibrary && node --env-file=.env.production.local /root/tibetan-eval/redraw-2026-10-01/sample_tib_redraw.mjs
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire('/root/sourcelibrary/package.json');
const { MongoClient } = require('mongodb');
const OUT = '/root/tibetan-eval/redraw-2026-10-01/';
const PREV = '/root/tibetan-eval/nalanda-2026-09-30/tib-sample.jsonl';
let seed = 20261001; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shuffle = (a) => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const prevIds = new Set(fs.readFileSync(PREV, 'utf8').trim().split('\n').map((l) => JSON.parse(l).id));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ language: 'Tibetan', visible: true, pages_count: { $gt: 20 } }, { projection: { id: 1, title: 1, display_title: 1, image_source: 1, pages_count: 1 } }).toArray();
const srcOf = (b) => b.image_source?.provider || b.image_source?.type || (typeof b.image_source === 'string' ? b.image_source : null);
const bl = books.filter((b) => /^bl$/i.test(srcOf(b) || '') || /\bbl\b/i.test(srcOf(b) || ''));
const kanjur = shuffle(bl.filter((b) => /kanjur|kangyur|bka'? ?'?gyur/i.test(b.display_title || b.title || ''))).slice(0, 100);
const other = shuffle(bl.filter((b) => !/kanjur|kangyur|bka'? ?'?gyur/i.test(b.display_title || b.title || ''))).slice(0, 25);
const print = shuffle(books.filter((b) => !bl.includes(b))).slice(0, 15);
console.error(`tibetan visible books ${books.length}; bl ${bl.length}; kanjur-titled ${bl.filter((b) => /kanjur|kangyur/i.test(b.display_title || b.title || '')).length}`);
const pick = [...kanjur.map((b) => [b, 'bl-kanjur']), ...other.map((b) => [b, 'bl-other']), ...print.map((b) => [b, 'print'])];
const pages = db.collection('pages');
const out = fs.createWriteStream(OUT + 'tib-sample.jsonl');
let n = 0, excluded = 0;
const lineCount = (t) => (t || '').split('\n').filter((l) => l.trim() && !/^<[^>]+>$/.test(l.trim())).length;
for (const [b, stratum] of pick) {
  const cand = await pages.find({ book_id: b.id, 'ocr.data': { $exists: true } }, { projection: { id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'ocr.updated_at': 1 } }).sort({ page_number: 1 }).toArray();
  const ok = cand.filter((p) => (p.ocr.data || '').length >= 600);
  if (!ok.length) continue;
  const lo = Math.floor(ok.length * 0.2), hi = Math.max(lo + 1, Math.floor(ok.length * 0.8));
  let p = ok[lo + Math.floor(rnd() * (hi - lo))];
  if (prevIds.has(`${b.id}_${p.page_number}`)) { excluded++; p = ok[lo + Math.floor(rnd() * (hi - lo))]; if (prevIds.has(`${b.id}_${p.page_number}`)) continue; }
  const lines = ok.map((q) => lineCount(q.ocr.data)).sort((x, y) => x - y);
  const med = lines[Math.floor(lines.length / 2)];
  out.write(JSON.stringify({ id: `${b.id}_${p.page_number}`, book_id: b.id, page_number: p.page_number, stratum, title: b.display_title || b.title, image_source: srcOf(b),
    arm: p.ocr.model || p.ocr.source || 'unknown', text: p.ocr.data, lines: lineCount(p.ocr.data), book_median_lines: med, leaf_breaks: ((p.ocr.data || '').match(/<leaf-break\/>/g) || []).length }) + '\n');
  n++;
}
out.end(); console.error(`sampled ${n} (previous-draw collisions re-rolled: ${excluded})`); await c.close();
