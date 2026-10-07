#!/usr/bin/env node
// PRIOR ART: scripts/eval/nalanda-readiness/sample_skt.mjs — the same one-interior-page-per-book draw
// (20–80% of the book, OCR ≥ 500 chars, seeded); it takes ONE page per book from a holdings file.
// Here a page is only usable if a published English can be located for it, so K seeded candidates
// per book are dumped and the aligners (align-pali.py, the Sanskrit/Chinese reference cuts) keep
// the first one that locates — still one page per book.
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/translation-ab-5606/draw-candidates.mjs \
 *        --books <books.tsv: lang<TAB>book_id[<TAB>note[<TAB>pages=lo-hi]]> --out <candidates.jsonl> [--k 6] [--seed 5606] [--min-chars 600] [--script-filter]
 * Read-only. Writes one row per candidate: {lang, book_id, page_number, title, ocr_chars, ocr_model, ocr_source, ocr}.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] != null ? args[i + 1] : d; };
const BOOKS = opt('books'); const OUT = opt('out');
const K = Number(opt('k', 6)); const SCRIPT_FILTER = args.includes('--script-filter'); const MIN = Number(opt('min-chars', 600));
if (!BOOKS || !OUT) { console.error('--books and --out required'); process.exit(1); }
let seed = Number(opt('seed', 5606)) >>> 0;
const rnd = () => { seed += 0x6D2B79F5; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const rows = fs.readFileSync(BOOKS, 'utf8').split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.split('\t'));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const out = fs.createWriteStream(OUT);
for (const [lang, bookId, note, range] of rows) {
  // optional 4th column pages=lo-hi: draw only from that page range (a chapter the English covers)
  const [rlo, rhi] = (range || '').startsWith('pages=') ? range.slice(6).split('-').map(Number) : [null, null];
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { title: 1, display_title: 1, language: 1 } });
  const ps = await db.collection('pages').find({ book_id: bookId, 'ocr.data': { $exists: true } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1 } }).sort({ page_number: 1 }).toArray();
  const script = !SCRIPT_FILTER ? null : lang === 'Sanskrit' ? /[\u0900-\u097f]/g : lang === 'Chinese' ? /[\u3400-\u9fff]/g : null;
  // --script-filter (round 2): a page counts only if ≥ 30% of it is the source script — bilingual
  // editions carry English pages (round 1 drew without it and lost two pages to that)
  const ok = ps.filter((p) => (p.ocr?.data || '').length >= MIN && (rlo == null || (p.page_number >= rlo && p.page_number <= rhi))
    && (!script || ((p.ocr.data.match(script) || []).length / p.ocr.data.replace(/\s|<[^>]+>/g, '').length) >= 0.3));
  if (!ok.length) { console.log(`${bookId}: no page ≥ ${MIN} chars`); continue; }
  const lo = rlo == null ? Math.floor(ok.length * 0.2) : 0, hi = rlo == null ? Math.max(lo + 1, Math.floor(ok.length * 0.8)) : ok.length;
  const pool = ok.slice(lo, hi);
  const picks = new Set();
  while (picks.size < Math.min(K, pool.length)) picks.add(Math.floor(rnd() * pool.length));
  for (const i of picks) {
    const p = pool[i];
    out.write(JSON.stringify({ lang, book_id: bookId, note: note || null, page_number: p.page_number, title: book?.display_title || book?.title, ocr_chars: p.ocr.data.length, ocr_model: p.ocr.model || null, ocr_source: p.ocr.source || null, ocr: p.ocr.data }) + '\n');
  }
  console.log(`${lang} ${bookId}: ${ok.length} pages ≥ ${MIN}, ${picks.size} candidates`);
}
out.end();
await c.close();
