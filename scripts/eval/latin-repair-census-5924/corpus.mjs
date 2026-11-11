#!/usr/bin/env node
/**
 * latin-repair-census-5924/corpus.mjs — the reference corpus the text-only detectors learn from (#5924).
 *
 * PRIOR ART: none for a Latin ſ-lexicon in the repo — longs-pass-5924 (sibling job) had not merged when this ran
 *   (checked `gh pr list --search longs-pass`, `git branch -r`); scripts/eval/latin-bakeoff-5924/score.mjs `longS`
 *   counts ſ→f against a REFERENCE, which a stored page does not have.
 *
 * Source: Latin books 1450–1800 with stored OCR that are NOT in the census draw, Mulberry32(59240) order; from each,
 *   up to 40 body pages read by a non-lite engine (gemini-*-flash*, not lite; claude-*). A page enters the corpus
 *   only if it keeps the long s (≥ 15 ſ), so the corpus separates printed f from printed ſ.
 * Writes $JOB_SCRATCH/corpus.jsonl.gz (book_id, page_number, model, text). Read only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import zlib from 'node:zlib'; import path from 'node:path';
const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const drawn = new Set(JSON.parse(fs.readFileSync(path.join(OUT, 'draw.json'), 'utf8')).map(b => b.book_id));
const yearOf = p => +((String(p ?? '').match(/1[4-8]\d\d/) || [])[0]) || null;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const books = (await db.collection('books').find({ language: /latin|^lat$|^la$/i, pages_ocr: { $gte: 100 } }, { projection: { id: 1, published: 1 } }).toArray())
  .map(b => ({ id: b.id || String(b._id), y: yearOf(b.published) })).filter(b => b.y >= 1450 && b.y <= 1800 && !drawn.has(b.id)).sort((a, b) => a.id.localeCompare(b.id));
const rnd = mulberry32(59240); for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
const out = []; let used = 0, tried = 0;
for (const b of books) {
  if (out.length >= 6000 || tried >= 600) break; tried++;
  const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gte: 15 } }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1 } }).sort({ page_number: 1 }).limit(60).toArray();
  let k = 0;
  for (const p of pages) {
    const m = String(p.ocr?.model || ''); const t = String(p.ocr?.data || '');
    if (/flash-lite/.test(m) || !/flash|claude/.test(m)) continue;
    if ((t.match(/ſ/g) || []).length < 15) continue;
    out.push(JSON.stringify({ book_id: b.id, page_number: p.page_number, model: m, text: t })); k++;
    if (k >= 40) break;
  }
  if (k) used++;
}
fs.writeFileSync(path.join(OUT, 'corpus.jsonl.gz'), zlib.gzipSync(out.join('\n')));
console.log(JSON.stringify({ books_tried: tried, books_used: used, pages: out.length }));
await c.close();
