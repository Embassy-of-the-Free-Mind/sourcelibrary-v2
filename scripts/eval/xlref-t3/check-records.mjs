#!/usr/bin/env node
// PRIOR ART: scripts/eval/translation-vs-reference/common.mjs validateRecord checks the record contract only; nothing
// checks that a cutter's source_text is still the page's OCR. This verifies each T3 record against Mongo (read-only)
// and normalises source_text to the stored OCR, so every arm translates exactly what production translated.
/** Verify T3 reference records against pages.ocr.data and rewrite source_text to the stored OCR (#5695 T3). */
import { MongoClient } from 'mongodb';
import { readJsonl, writeJsonl, validateRecord } from '../translation-vs-reference/common.mjs';
const [IN, OUT] = process.argv.slice(2);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages'); const books = c.db('bookstore').collection('books');
const out = []; let drift = 0;
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
for (const [i, r] of readJsonl(IN).entries()) {
  const p = await pages.findOne({ book_id: r.book_id, page_number: Number(r.page_number) }, { projection: { 'ocr.data': 1, 'ocr.model': 1, display_photo: 1, photo: 1 } });
  const b = await books.findOne({ id: r.book_id }, { projection: { language: 1, title: 1, author: 1, year: 1, 'image_source.provider': 1, 'image_source.license': 1 } });
  if (!p || !b) { console.log('MISSING', r.book_id, r.page_number); continue; }
  const ocr = p.ocr?.data || '';
  const a = norm(r.source_text), o = norm(ocr);
  if (a !== o && !o.includes(a.slice(20, 220))) { drift++; console.log('DRIFT', r.book_id, r.page_number, a.length, o.length); }
  const rec = { ...r, lang: b.language, page_number: Number(r.page_number), source_text: ocr, candidates: [{ arm: '_placeholder', text: 'x' }] };
  rec.book_meta = { ...(r.book_meta || {}), title: b.title, author: b.author, year: b.year, scan_provider: b.image_source?.provider ?? r.book_meta?.scan_provider ?? null, scan_licence: b.image_source?.license ?? r.book_meta?.scan_licence ?? null, text_licence: 'CC-BY-SA-4.0', ocr_model: p.ocr?.model ?? null, image: p.display_photo || p.photo || null };
  validateRecord(rec, i + 1);
  rec.candidates = [];
  out.push(rec);
}
await c.close();
writeJsonl(OUT, out);
console.log(`${out.length} records, source drift ${drift}`);
const tally = {}; for (const r of out) tally[r.lang] = (tally[r.lang] || 0) + 1; console.log(tally);
