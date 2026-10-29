#!/usr/bin/env node
// PRIOR ART: scripts/eval/euro-gpu-correct-7567/e5-draw.mjs (the lite-draft page frame, copied: LITE_MODELS, interior,
// not handwritten, not edited, idle unheld visible books; there 1470-1800 and 25 pages a book) and e5-fetch-nb.mjs
// (neighbour leaves for the judge's bleed check, copied).
/**
 * draw-judged.mjs — #6871: the JUDGED panels, library pages from books dated 1800+ (`year`), ONE page per book.
 *   --set=a   fr, it, de: an interior page whose stored OCR is a Flash-Lite draft of 300+ chars (use a: replace lite).
 *   --set=b   en, de, fr: an interior page with NO text that lite refused or returned empty (ocr.recitation_count > 0,
 *             recitation_blocked, fail_blocked, fail_reason, or a lite ocr.model with no text) (use b: fill refusals).
 * Books in a seeded order (sha256 "6871p1800:<id>"), --per=40. Writes <out>/panel.json, img/<slug>.jpg,
 * nb/<slug>.{prev,next}.jpg, L.jsonl (the stored text; empty for set b). Read-only on Mongo.
 *   node --env-file=… draw-judged.mjs --set=a --out=$JOB_SCRATCH/judged-a [--per=40] [--langs=fr,it,de]
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { LITE_MODELS, IDLE_STATUSES, isInterior } from '../../batch/cli-ocr-lane.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const SET = arg('set'); const OUT = arg('out'); const PER = Number(arg('per', '40'));
const L = { en: 'English', de: 'German', fr: 'French', it: 'Italian', la: 'Latin' };
const LANGS = arg('langs', SET === 'a' ? 'fr,it,de' : 'en,de,fr').split(',');
const rank = (id) => crypto.createHash('sha256').update(`6871p1800:${id}`).digest('hex');
for (const d of ['img', 'nb']) fs.mkdirSync(`${OUT}/${d}`, { recursive: true });
const PROJ = { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, crop: 1 };
async function fetchTo(url, f) {
  if (fs.existsSync(f)) return true;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url, { headers: { 'User-Agent': 'sourcelibrary-eval-6871' } }); if (r.ok) { fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return true; } } catch { /* retry */ }
    await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
  }
  return false;
}
const pageMatch = SET === 'a'
  ? { 'ocr.model': { $in: LITE_MODELS }, 'ocr.data': { $type: 'string' } }
  : { $and: [{ $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': '' }] },
      { $or: [{ 'ocr.recitation_count': { $gt: 0 } }, { 'ocr.recitation_blocked': true }, { 'ocr.fail_blocked': true }, { 'ocr.fail_reason': { $exists: true, $nin: [null, ''] } }, { 'ocr.model': { $in: LITE_MODELS } }] }] };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const panel = { issue: 6871, set: SET, drawn_at: new Date().toISOString(), rule: 'see header', pages: [] }; const lite = [];
for (const lang of LANGS) {
  const books = (await db.collection('books').find(
    { visible: true, pages_count: { $gte: 20 }, language: { $regex: `^${L[lang]}` }, year: { $gte: 1800, $lte: 2030 },
      'pipeline_auto.status': { $in: IDLE_STATUSES }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true } },
    { projection: { id: 1, title: 1, year: 1, pages_count: 1 } }).toArray()).sort((a, b) => rank(a.id).localeCompare(rank(b.id)));
  let got = 0;
  for (const b of books) {
    if (got >= PER) break;
    const rows = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 }, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, withheld: { $ne: true }, ...pageMatch },
      { projection: { ...PROJ, 'ocr.data': 1, 'ocr.model': 1, 'ocr.recitation_count': 1, 'ocr.fail_reason': 1 } }).sort({ page_number: 1 }).toArray();
    const ok = rows.filter((p) => (SET === 'b' || isInterior(p.page_number, b.pages_count))
      && (SET === 'b' || ((p.ocr.data.length >= 300) && !/<script>\s*(handwrit|manuscript)/i.test(p.ocr.data))));
    if (!ok.length) continue;
    const p = ok[parseInt(rank(b.id).slice(0, 8), 16) % ok.length];
    const slug = `${lang}-${b.id.slice(-8)}-p${p.page_number}`;
    const u = getPageSource(p); if (!u || !(await fetchTo(u, `${OUT}/img/${slug}.jpg`))) { console.error('no image', slug); continue; }
    for (const [d, side] of [[-1, 'prev'], [1, 'next']]) {
      const n = await db.collection('pages').findOne({ book_id: b.id, page_number: p.page_number + d }, { projection: PROJ });
      const nu = n ? getPageSource(n) : null; if (nu) await fetchTo(nu, `${OUT}/nb/${slug}.${side}.jpg`);
    }
    panel.pages.push({ slug, lang, book_id: b.id, page_id: p.id, page_number: p.page_number, title: b.title, year: b.year,
      stored: SET === 'a' ? 'lite' : { recitation_count: p.ocr?.recitation_count ?? 0, fail_reason: p.ocr?.fail_reason ?? null, model: p.ocr?.model ?? null } });
    lite.push({ page_id: slug, text: SET === 'a' ? p.ocr.data : '' });
    got++;
  }
  console.log(`${lang}: ${got} pages (${books.length} books in frame)`);
}
await c.close();
fs.writeFileSync(`${OUT}/panel.json`, JSON.stringify(panel, null, 1));
fs.writeFileSync(`${OUT}/L.jsonl`, lite.map((r) => JSON.stringify(r)).join('\n') + '\n');
