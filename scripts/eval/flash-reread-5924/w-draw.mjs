#!/usr/bin/env node
/**
 * flash-reread-5924/w-draw.mjs — #7568: the #5924 draw for another language. 10 lite-read books × 25 spread body pages.
 *
 * PRIOR ART: ./draw.mjs (the Latin draw: frame query, Mulberry32 shuffle, the `spread` rule v[floor((i + 0.5) · n / 25)],
 *   the ≥ 70% lite / ≥ 50 eligible gates, image download) — it is hardwired to Latin 1500–1800 and the Latin stopword
 *   check, and running it would redraw the Latin sample. Same logic here, parametrised by LANG; no year window (most
 *   Chinese and Greek editions carry no 1400–1899 year), only books in terminal pipeline status `complete`.
 *
 *   LANG=zh|de|el|sa|ar JOB_SCRATCH=… node --env-file=… scripts/eval/flash-reread-5924/w-draw.mjs
 *
 * Writes $JOB_SCRATCH/<LANG>/draw/{candidates.json, <slug>.jpg (≤ 2000 px), <slug>.full.jpg, <slug>.lite.txt}. Read only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs'; import path from 'node:path';
import sharp from 'sharp';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { classifyPageSample } from '../../lib/language-content-classify.mjs';

const share = (re) => (texts) => { const t = texts.join('\n'), all = (t.match(/\p{L}/gu) || []).length; return all ? (t.match(re) || []).length / all : 0; };
export const LANGS = {
  zh: { seed: 75681, names: ['Chinese', 'Classical Chinese', 'zh'], minLetters: 150, check: (tx) => share(/\p{Script=Han}/gu)(tx) >= 0.6 },
  de: { seed: 75682, names: ['German', 'de'], minLetters: 400, check: (tx) => classifyPageSample(tx).dominant === 'german' },
  el: { seed: 75683, names: ['Greek', 'Ancient Greek', 'grc'], minLetters: 400, check: (tx) => share(/\p{Script=Greek}/gu)(tx) >= 0.6 },
  sa: { seed: 75684, names: ['Sanskrit', 'sa'], minLetters: 300, check: (tx) => share(/\p{Script=Devanagari}/gu)(tx) >= 0.6 },
  ar: { seed: 75685, names: ['Arabic', 'ar'], minLetters: 300, check: (tx) => share(/\p{Script=Arabic}/gu)(tx) >= 0.6 },
};
const LANG = process.env.LANG_CODE || process.env.LANG7568;
const C = LANGS[LANG];
const N_CAND = Number(process.env.N_CAND || 14), PER_BOOK = 25;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const letters = s => (String(s || '').match(/\p{L}/gu) || []).length;
const isLite = m => /flash-lite/.test(String(m || ''));
const spread = v => Array.from({ length: PER_BOOK }, (_, i) => v[Math.floor((i + 0.5) * v.length / PER_BOOK)]);

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (!C) { console.error('set LANG7568 to one of ' + Object.keys(LANGS).join(', ')); process.exit(2); }
  const OUT = path.join(process.env.JOB_SCRATCH, LANG, 'draw'); fs.mkdirSync(OUT, { recursive: true });
  const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
  const db = c.db('bookstore');
  const rows = await db.collection('books').find({ language: { $in: C.names }, visible: true, pages_count: { $gt: 0 }, 'pipeline_auto.status': 'complete' },
    { projection: { id: 1, title: 1, author: 1, published: 1, pages_count: 1, pages_ocr: 1, duplicate_of: 1, format: 1, content_type: 1, script_type: 1 } }).toArray();
  const frame = rows.map(b => ({ ...b, book_id: b.id || String(b._id) }))
    .filter(b => !b.duplicate_of && (b.pages_ocr ?? b.pages_count) >= 50 && !/manuscri/i.test(`${b.format || ''} ${b.content_type || ''} ${b.script_type || ''}`))
    .sort((a, b) => a.book_id.localeCompare(b.book_id));
  const rnd = mulberry32(C.seed);
  for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }
  const taken = [], why = {}; let checked = 0;
  for (const b of frame) {
    if (taken.length >= N_CAND) break;
    checked++;
    const pages = await db.collection('pages').find({ book_id: b.book_id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, cropped_photo: 1, split_from_spread: 1, photo: 1, archived_photo: 1, enhanced_photo: 1, photo_original: 1 } }).sort({ page_number: 1 }).toArray();
    const ocrd = pages.filter(p => String(p.ocr?.data || '').trim());
    const liteShare = ocrd.filter(p => isLite(p.ocr?.model)).length / (ocrd.length || 1);
    if (liteShare < 0.7) { why.not_lite = (why.not_lite || 0) + 1; continue; }
    const elig = ocrd.filter(p => (p.page_type == null || p.page_type === 'text') && isLite(p.ocr?.model) && letters(p.ocr.data) >= C.minLetters && getPageSource(p));
    if (elig.length < 50) { why.lt50_eligible = (why.lt50_eligible || 0) + 1; continue; }
    if (!C.check(elig.slice(0, 400).filter((_, i) => i % 8 === 0).map(p => p.ocr.data))) { why.text_not_lang = (why.text_not_lang || 0) + 1; continue; }
    const run = [];
    for (const p of spread(elig)) {
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
    taken.push({ book_id: b.book_id, title: String(b.title || '').slice(0, 140), author: b.author || null, published: b.published || null, pages_count: b.pages_count, lite_share: +liteShare.toFixed(3), eligible: elig.length, order: taken.length, pages: run });
    console.log(`${taken.length}. ${b.book_id} ${String(b.published || '').slice(0, 12)} ${String(b.title).slice(0, 60)} — ${elig.length} eligible, errs ${run.filter(r => r.err).length}`);
  }
  fs.writeFileSync(path.join(OUT, 'candidates.json'), JSON.stringify({ lang: LANG, seed: C.seed, frame_n: frame.length, checked, rejected: why, candidates: taken }, null, 1));
  console.log(JSON.stringify({ lang: LANG, frame_n: frame.length, checked, rejected: why, taken: taken.length }));
  await c.close();
}
