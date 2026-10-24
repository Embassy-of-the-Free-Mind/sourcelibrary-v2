#!/usr/bin/env node
/**
 * flash-reread-5924/draw.mjs — 10 fresh lite-read Latin books × 25 spread body pages, for the Flash re-read test (#5924).
 *
 * PRIOR ART: scripts/eval/latin-repair-census-5924/draw.mjs (frame query, yearOf, Mulberry32 reused) and its
 *   analyze.mjs `spread` (v[floor((i + 0.5) · n / 25)], the rule PR #7173 found predicts the whole book). That draw is
 *   stratified by engine × century over ≥ 100-page books and is already used up (census, spot check, GPU arm); this one
 *   takes only lite-read books and excludes every id named in a prior #5924 eval file (EXCLUDE file).
 *
 * Frame: books {language Latin, visible, pages_count > 0, pages_ocr ≥ 100, first year 1500–1800 in `published`,
 *   not duplicate_of, not catalogued manuscript}, minus EXCLUDE. Mulberry32(SEED) order. A book is taken when ≥ 70% of
 *   its OCR'd pages are flash-lite reads, ≥ 50 pages are eligible body pages (page_type text/null, flash-lite, ≥ 400
 *   OCR letters, an image source), and the stopword classifier calls its eligible text Latin. Candidates are drawn
 *   until N_CAND are taken; the first 10 that the format screen (screen step, by eye) calls printed Latin are the sample.
 * Writes $JOB_SCRATCH/draw/{candidates.json, <slug>.jpg (≤ 2000 px), <slug>.full.jpg, <slug>.lite.txt}. Read only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { classifyPageSample } from '../../lib/language-content-classify.mjs';

const SEED = 51023, N_CAND = Number(process.env.N_CAND || 14), PER_BOOK = 25;
const OUT = path.join(process.env.JOB_SCRATCH || '/tmp', 'draw'); fs.mkdirSync(OUT, { recursive: true });
const EXCLUDE = new Set(fs.readFileSync(process.env.EXCLUDE, 'utf8').split('\n').filter(Boolean));
const yearOf = p => +((String(p ?? '').match(/1[4-8]\d\d/) || [])[0]) || null;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const letters = s => (String(s || '').match(/\p{L}/gu) || []).length;
const isLite = m => /flash-lite/.test(String(m || ''));
export const spread = v => Array.from({ length: PER_BOOK }, (_, i) => v[Math.floor((i + 0.5) * v.length / PER_BOOK)]);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const rows = await db.collection('books').find({ language: /latin|^lat$|^la$/i, visible: true, pages_count: { $gt: 0 }, pages_ocr: { $gte: 100 } },
  { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_ocr: 1, duplicate_of: 1, format: 1, content_type: 1, script_type: 1 } }).toArray();
const frame = rows.map(b => ({ ...b, book_id: b.id || String(b._id), year: yearOf(b.published) }))
  .filter(b => b.year >= 1500 && b.year <= 1800 && !b.duplicate_of && !/manuscri/i.test(`${b.format || ''} ${b.content_type || ''} ${b.script_type || ''}`) && !EXCLUDE.has(b.book_id))
  .sort((a, b) => a.book_id.localeCompare(b.book_id));
const rnd = mulberry32(SEED);
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }

const taken = [], why = {}; let checked = 0;
for (const b of frame) {
  if (taken.length >= N_CAND) break;
  checked++;
  const pages = await db.collection('pages').find({ book_id: b.book_id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
  const ocrd = pages.filter(p => String(p.ocr?.data || '').trim());
  const liteShare = ocrd.filter(p => isLite(p.ocr?.model)).length / (ocrd.length || 1);
  if (liteShare < 0.7) { why.not_lite = (why.not_lite || 0) + 1; continue; }
  const elig = ocrd.filter(p => (p.page_type == null || p.page_type === 'text') && isLite(p.ocr?.model) && letters(p.ocr.data) >= 400 && !EXCLUDE.has(p.id) && getPageSource(p));
  if (elig.length < 50) { why.lt50_eligible = (why.lt50_eligible || 0) + 1; continue; }
  const lang = classifyPageSample(elig.slice(0, 400).filter((_, i) => i % 8 === 0).map(p => p.ocr.data));
  if (lang.dominant !== 'latin') { why[`text_${lang.dominant}`] = (why[`text_${lang.dominant}`] || 0) + 1; continue; }
  const pick = spread(elig);
  const run = [];
  for (const p of pick) {
    const slug = `${b.book_id}-p${p.page_number}`, src = getPageSource(p);
    fs.writeFileSync(path.join(OUT, `${slug}.lite.txt`), p.ocr.data);
    const row = { slug, page_id: p.id, page_number: p.page_number, ocr_model: p.ocr.model, ocr_updated_at: p.ocr.updated_at || null, src };
    try {
      const r = await fetch(src, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      await sharp(buf).resize(2000, 2000, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toFile(path.join(OUT, `${slug}.jpg`));
      await sharp(buf).jpeg({ quality: 92 }).toFile(path.join(OUT, `${slug}.full.jpg`));
    } catch (e) { row.err = String(e.message || e); }
    run.push(row);
  }
  taken.push({ book_id: b.book_id, title: String(b.title || '').slice(0, 140), author: b.author || null, year: b.year, pages_count: b.pages_count, lite_share: +liteShare.toFixed(3), eligible: elig.length, lang_score: +lang.score.toFixed(3), order: taken.length, pages: run });
  console.log(`${taken.length}. ${b.book_id} ${b.year} ${String(b.title).slice(0, 60)} — ${elig.length} eligible, errs ${run.filter(r => r.err).length}`);
}
fs.writeFileSync(path.join(OUT, 'candidates.json'), JSON.stringify({ seed: SEED, frame_n: frame.length, checked, rejected: why, candidates: taken }, null, 1));
console.log(JSON.stringify({ frame_n: frame.length, checked, rejected: why, taken: taken.length }));
await c.close();
