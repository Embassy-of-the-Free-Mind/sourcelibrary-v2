#!/usr/bin/env node
/**
 * spotcheck-latin-5924/draw.mjs — the 36 served pages of the 2026-10-22 by-eye spot check (#5924).
 *
 * PRIOR ART: scripts/eval/latin-repair-census-5924/{draw,leaves}.mjs — its seeded 60-book draw and Opus format labels
 *   are the frame here (restricted to visible, 1500–1800, printed), and its getPageSource fetch is reused. It drew
 *   single leaves for detectors; this needs runs of 3 consecutive body pages with the English, the served image and
 *   both neighbours' OCR, which it does not keep.
 *
 * Frame: census draw ∩ visible ∩ first year 1500–1800 ∩ printed (format labels). Cells typeface × columns:
 *   roman-1, roman-2, italic-1, gothic-1; 3 books each, Mulberry32(1022) order.
 * Run: per book, the first start (Mulberry32 position in 20–80% of the book, then walking forward) where 3 consecutive
 *   pages each have ≥ 400 OCR letters and a stored translation, none a census by-eye page.
 * Writes $JOB_SCRATCH/sc/<book>-p<n>.{jpg,served.jpg?,ocr.txt,en.txt} + neighbours' OCR, and sc/draw.json. Read only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';

const CEN = process.env.CENSUS || '/data/scratch/sl/jobs/latin-repair-census';
const OUT = path.join(process.env.JOB_SCRATCH || '/tmp', 'sc'); fs.mkdirSync(OUT, { recursive: true });
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(1022);
const draw = JSON.parse(fs.readFileSync(path.join(CEN, 'draw.json'), 'utf8'));
const labels = new Map(fs.readdirSync(path.join(CEN, 'agents')).filter(f => /^format-\d\.out\.json$/.test(f))
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(CEN, 'agents', f), 'utf8'))).map(x => [x.book_id, x]));
const censusEye = new Set(JSON.parse(fs.readFileSync(path.join(CEN, 'leaves.json'), 'utf8')).map(x => `${x.book_id}-p${x.page_number}`));
const frame = draw.filter(b => { const f = labels.get(b.book_id); return b.visible && f && !/MANUSCRIPT|NOT PRINTED/i.test(f.notes) && b.year >= 1500 && b.year <= 1800; })
  .map(b => ({ ...b, fmt: labels.get(b.book_id), cell: `${labels.get(b.book_id).typeface}-${labels.get(b.book_id).columns}` }))
  .sort((a, b) => a.book_id.localeCompare(b.book_id));
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const letters = s => (String(s || '').match(/\p{L}/gu) || []).length;
const picked = [], per = {};
for (const b of frame) {
  if ((per[b.cell] || 0) >= 3) continue;
  const pages = await db.collection('pages').find({ book_id: b.book_id }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'translation.data': 1, 'translation.model': 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1, display_photo: 1 } }).sort({ page_number: 1 }).toArray();
  const ok = p => p && (p.page_type == null || p.page_type === 'text') && letters(p.ocr?.data) >= 400 && letters(p.translation?.data) >= 200 && !censusEye.has(`${b.book_id}-p${p.page_number}`);
  const n = pages.length, s0 = Math.floor(n * (0.2 + 0.6 * rnd()));
  let start = -1;
  for (let k = 0; k < n && start < 0; k++) { const i = (s0 + k) % (n - 2); if (ok(pages[i]) && ok(pages[i + 1]) && ok(pages[i + 2]) && pages[i + 2].page_number - pages[i].page_number === 2) start = i; }
  if (start < 0) continue;
  per[b.cell] = (per[b.cell] || 0) + 1;
  const run = [];
  for (let i = start; i < start + 3; i++) {
    const p = pages[i], slug = `${b.book_id}-p${p.page_number}`;
    const src = getPageSource(p), served = p.display_photo || null;  // image-pick-ok: by-eye check opens the SERVED display_photo beside the OCR source on purpose (5699)
    fs.writeFileSync(path.join(OUT, `${slug}.ocr.txt`), p.ocr?.data || '');
    fs.writeFileSync(path.join(OUT, `${slug}.en.txt`), p.translation?.data || '');
    for (const [d, q] of [['prev', pages[i - 1]], ['next', pages[i + 1]]]) fs.writeFileSync(path.join(OUT, `${slug}.${d}.ocr.txt`), q?.ocr?.data || '');
    const row = { slug, page_number: p.page_number, ocr_model: p.ocr?.model, translation_model: p.translation?.model, src, served, photo: p.photo };
    for (const [u, f] of [[src, `${slug}.jpg`], [served && served !== src ? served : null, `${slug}.served.jpg`]]) {
      if (!u) continue;
      try { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
        await sharp(Buffer.from(await r.arrayBuffer())).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(OUT, f)); }
      catch (e) { row.err = `${f}: ${e.message}`; }
    }
    run.push(row);
  }
  picked.push({ book_id: b.book_id, title: b.title, year: b.year, cell: b.cell, engine: b.engine, fmt: b.fmt, run });
}
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify(picked, null, 1));
console.log(JSON.stringify({ frame: frame.length, books: picked.length, per, errs: picked.flatMap(p => p.run).filter(r => r.err).length }));
await c.close();
