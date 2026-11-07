#!/usr/bin/env node
/**
 * latin-repair-census-5924/draw.mjs — the frame and the seeded draw for the Latin OCR repair census (#5924).
 *
 * PRIOR ART: scripts/eval/latin-refs-5924.mjs — its yearOf / Mulberry32 / Latin-language regex are reused here
 *   (the frame there is one leaf per book for references; this one wants whole books with stored OCR, stratified
 *   by century AND by the engine that read them, which that draw does not record).
 *
 * Frame: books whose `language` is Latin, a first 14xx–18xx year in `published` within 1450–1800, `pages_ocr` ≥ 100,
 *   not `duplicate_of`, hidden books included. A drawn book is then checked against its pages: ≥ 100 pages carry
 *   non-empty `ocr.data`, and its engine is the majority `ocr.model` over those pages.
 * Draw: Mulberry32(5924) shuffle; take books in that order into century × engine cells (cap 5 per cell, 12 cells =
 *   60); a cell that runs dry leaves its slots to a second pass in the same order.
 * Writes: $JOB_SCRATCH/frame.json (counts), $JOB_SCRATCH/draw.json (the 60), $JOB_SCRATCH/pages/<book>.jsonl.gz
 *   (page_number, model, text) — read only. NO writes to Mongo.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const OUT = process.env.JOB_SCRATCH || '/data/scratch/sl/jobs/latin-repair-census';
const SEED = 5924, PER_CELL = 5, TARGET = 60;
fs.mkdirSync(path.join(OUT, 'pages'), { recursive: true });

const yearOf = p => +((String(p ?? '').match(/1[4-8]\d\d/) || [])[0]) || null;
const century = y => (y >= 1450 && y < 1500 ? '1450-99' : y >= 1500 && y < 1600 ? '1500s' : y >= 1600 && y < 1700 ? '1600s' : y >= 1700 && y <= 1800 ? '1700s' : null);
export const engineOf = m => { m = String(m || ''); return /flash-lite/.test(m) ? 'lite' : /flash/.test(m) ? 'flash' : 'other'; };
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const rows = await db.collection('books').find({ language: /latin|^lat$|^la$/i, pages_ocr: { $gte: 100 } },
  { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_ocr: 1, visible: 1, duplicate_of: 1, language: 1, format: 1, content_type: 1, script_type: 1 } }).toArray();
const frame = []; const excl = { year: 0, duplicate: 0, manuscript: 0 };
for (const b of rows) {
  const y = yearOf(b.published), cen = century(y);
  if (!cen) { excl.year++; continue; }
  if (b.duplicate_of) { excl.duplicate++; continue; }
  if (/manuscri/i.test(`${b.format || ''} ${b.content_type || ''} ${b.script_type || ''}`)) { excl.manuscript++; continue; }
  frame.push({ book_id: b.id || String(b._id), year: y, century: cen, title: String(b.title || '').slice(0, 120), author: b.author || null, pages_count: b.pages_count, pages_ocr: b.pages_ocr, visible: !!b.visible, language: b.language });
}
frame.sort((a, b) => a.book_id.localeCompare(b.book_id));
const rnd = mulberry32(SEED);
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }
const byCentury = {}; for (const b of frame) byCentury[b.century] = (byCentury[b.century] || 0) + 1;

const cells = {}; const drawn = []; const checked = []; const rejected = { lt100_ocr: 0 };
async function loadBook(b) {
  const pages = await db.collection('pages').find({ book_id: b.book_id }, { projection: { page_number: 1, 'ocr.data': 1, 'ocr.model': 1, page_type: 1 } }).sort({ page_number: 1 }).toArray();
  const withText = pages.filter(p => String(p.ocr?.data || '').trim());
  const models = {}; for (const p of withText) { const m = p.ocr?.model || 'none'; models[m] = (models[m] || 0) + 1; }
  const major = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0];
  return { pages, withText: withText.length, models, engine: engineOf(major), major };
}
const loaded = new Map();
for (const pass of [1, 2]) {
  for (const b of frame) {
    if (drawn.length >= TARGET) break;
    if (drawn.some(d => d.book_id === b.book_id)) continue;
    if (pass === 1 && checked.length > 900) break;
    let L = loaded.get(b.book_id);
    if (!L) {
      if (pass === 2) {
        // pass 2 only fills slots; it must still check the book, but never re-check one rejected in pass 1
        if (checked.includes(b.book_id)) continue;
      }
      L = await loadBook(b); checked.push(b.book_id);
      if (L.withText < 100) { rejected.lt100_ocr++; loaded.set(b.book_id, { reject: true }); continue; }
      loaded.set(b.book_id, { engine: L.engine, major: L.major, models: L.models, withText: L.withText, pages: L.pages });
      L = loaded.get(b.book_id);
    }
    if (L.reject) continue;
    const cell = `${b.century}|${L.engine}`;
    if (pass === 1 && (cells[cell] || 0) >= PER_CELL) continue;
    cells[cell] = (cells[cell] || 0) + 1;
    drawn.push({ ...b, engine: L.engine, major_model: L.major, models: L.models, pages_with_text: L.withText, cell, pass });
    const lines = L.pages.map(p => JSON.stringify({ page_number: p.page_number, model: p.ocr?.model || null, page_type: p.page_type || null, text: p.ocr?.data || '' })).join('\n');
    fs.writeFileSync(path.join(OUT, 'pages', `${b.book_id}.jsonl.gz`), zlib.gzipSync(lines));
  }
  // pass 1 checks ≤ 900 books; cells still empty after that are taken as rare in the frame
}
// engine share among checked, accepted books (an estimate of the frame's engine mix, from the seeded order)
const mix = {}; for (const [id, L] of loaded) if (!L.reject) { const b = frame.find(f => f.book_id === id); const k = `${b.century}|${L.engine}`; mix[k] = (mix[k] || 0) + 1; }
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify({ seed: SEED, built_at: new Date().toISOString(), frame_query: 'books {language:/latin|^lat$|^la$/i, pages_ocr>=100}, year 1450-1800 from published, not duplicate_of, not manuscript', n_rows: rows.length, excluded: excl, frame_n: frame.length, by_century: byCentury, checked: checked.length, rejected, accepted_mix_in_checked_order: mix, cells }, null, 1));
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify(drawn, null, 1));
console.log(JSON.stringify({ frame_n: frame.length, by_century: byCentury, excluded: excl, checked: checked.length, rejected, cells, drawn: drawn.length }));
await c.close();
