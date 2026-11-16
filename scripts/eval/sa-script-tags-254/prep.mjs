#!/usr/bin/env node
// PRIOR ART: scripts/eval/sanskrit-gex45-7243/confirm-classify.py and classify.py (the by-eye sort of 346 Sanskrit
// pages into print / manuscript-or-lithograph / other: contact sheet first, full page where unclear; kept as code, it
// tags PAGES of a draw, not BOOKS of a frame); scripts/eval/book-class-5768.mjs (books.book_class for every book, from
// OCR <script> tags, Unicode blocks of the OCR text and CLIP — it reads the transcription, which #95 showed misleads on
// Śāradā, and its family vocabulary stops at `indic`). Neither tags a Sanskrit book's script from its leaves.
//
// prep — the #254 frame and the leaves each tagger sees (#254, finding on #95 2026-11-12).
//
// Frame: hidden Sanskrit books at translation rung `transcribed` that wait for translation (pipeline_next.step
// `translate`) or are held `sarada-ocr-invented-95` — the population #95 counted (721 books, 24,203 pages). Frame order
// is a seeded shuffle (seed 20261113) so the first 100, which the Sonnet arm also reads, are a random draw.
// Leaves: three evenly spaced pages in the middle third of the book (by page_number). The image comes from R2
// (archived_photo) and falls back to the provider URL; a fetch failure moves to the next page of the middle third. A
// book with no fetchable leaf is recorded with its reason. No transcription and no stored tag is read here.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/sa-script-tags-254/prep.mjs --out $JOB_SCRATCH/w
// Writes <out>/frame.json (books in frame order, with the picked leaves) and <out>/img/<book>/<page>.jpg (≤1568 px).
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', process.env.JOB_SCRATCH ? path.join(process.env.JOB_SCRATCH, 'w') : null);
if (!OUT) throw new Error('--out <dir> required');
const SEED = 20261113;
const FRAME_FILTER = {
  language: { $regex: '^sanskrit$', $options: 'i' },
  visible: { $ne: true },
  'translation_state.rung': 'transcribed',
  $or: [{ 'pipeline_next.step': 'translate' }, { 'pipeline_auto.hold.reason': 'sarada-ocr-invented-95' }],
};
export { FRAME_FILTER };

const urls = (p) => [p.cropped_photo, p.split_from_spread ? p.photo : null, p.archived_photo, p.photo_original, p.photo]
  .filter((u, i, a) => typeof u === 'string' && /^https?:\/\//.test(u) && a.indexOf(u) === i);

async function fetchImage(u) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 60000);
  try {
    const r = await fetch(u, { signal: ctl.signal, headers: { 'User-Agent': 'SourceLibrary-script-tags/1.0' } });
    if (!r.ok) return { err: `HTTP ${r.status}` };
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 2000) return { err: `tiny body ${buf.length}` };
    return { buf };
  } catch (e) { return { err: e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 80) }; } finally { clearTimeout(t); }
}

/** Order the middle-third pages: the three evenly spaced targets first, then the rest nearest-first as substitutes. */
export function middleOrder(pages) {
  const n = pages.length; if (!n) return [];
  const lo = Math.floor(n / 3), hi = Math.max(lo + 1, Math.ceil((2 * n) / 3));
  const mid = pages.slice(lo, hi);
  const m = mid.length;
  const targets = m <= 3 ? mid.map((_, i) => i) : [0, 1, 2].map((k) => Math.round(((k + 0.5) * m) / 3 - 0.5));
  const rest = mid.map((_, i) => i).filter((i) => !targets.includes(i));
  const out = targets.map((i) => mid[i]);
  // substitutes: nearest to any target
  rest.sort((a, b) => Math.min(...targets.map((t) => Math.abs(t - a))) - Math.min(...targets.map((t) => Math.abs(t - b))));
  for (const i of rest) out.push(mid[i]);
  // a book of 1–2 pages: whatever there is
  if (n < 3) return pages.slice();
  return out;
}

async function main() {
  fs.mkdirSync(path.join(OUT, 'img'), { recursive: true });
  const c = await MongoClient.connect(process.env.MONGODB_URI);
  const db = c.db('bookstore');
  const books = await db.collection('books').find(FRAME_FILTER, { projection: { _id: 0, id: 1, pages_count: 1, 'pipeline_auto.hold.reason': 1, 'pipeline_auto.status': 1 } }).sort({ id: 1 }).toArray();
  const rng = makeRng(SEED);
  for (let i = books.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [books[i], books[j]] = [books[j], books[i]]; }
  console.error(`frame: ${books.length} books, ${books.reduce((s, b) => s + (b.pages_count || 0), 0)} pages (pages_count)`);
  const prev = fs.existsSync(path.join(OUT, 'frame.json')) ? new Map(JSON.parse(fs.readFileSync(path.join(OUT, 'frame.json'))).books.map((b) => [b.id, b])) : new Map();
  const out = [];
  let k = 0;
  const work = books.map((b, idx) => ({ b, idx }));
  async function one({ b, idx }) {
    const p0 = prev.get(b.id);
    if (p0 && p0.leaves?.length >= Math.min(3, p0.n_pages || 3)) { out[idx] = { ...p0, order: idx }; return; }
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 0, id: 1, page_number: 1, photo: 1, archived_photo: 1, photo_original: 1, cropped_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
    const rec = { order: idx, id: b.id, n_pages: pages.length, hold: b.pipeline_auto?.hold?.reason ?? null, status: b.pipeline_auto?.status ?? null, leaves: [], failures: [] };
    if (!pages.length) { rec.reason = 'no page records'; out[idx] = rec; return; }
    for (const p of middleOrder(pages)) {
      if (rec.leaves.length >= 3) break;
      const us = urls(p);
      if (!us.length) { rec.failures.push({ page: p.page_number, err: 'no image url' }); continue; }
      let got = null; const errs = [];
      for (const u of us) { const r = await fetchImage(u); if (r.buf) { got = { u, buf: r.buf }; break; } errs.push(`${new URL(u).host}: ${r.err}`); }
      if (!got) { rec.failures.push({ page: p.page_number, err: errs.join('; ') }); continue; }
      const dir = path.join(OUT, 'img', b.id); fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${p.page_number}.jpg`);
      try {
        await sharp(got.buf).rotate().resize(1568, 1568, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file);
      } catch (e) { rec.failures.push({ page: p.page_number, err: `decode: ${String(e.message).slice(0, 60)}` }); continue; }
      rec.leaves.push({ page: p.page_number, page_id: p.id, file, src: new URL(got.u).host });
      if (rec.failures.length > 12) break;
    }
    if (!rec.leaves.length) rec.reason = `no leaf of the middle third could be fetched (${rec.failures.length} tried): ${rec.failures[0]?.err ?? ''}`;
    out[idx] = rec;
    if (++k % 50 === 0) console.error(`${k}/${books.length}`);
  }
  const q = work.slice();
  await Promise.all(Array.from({ length: 6 }, async () => { while (q.length) await one(q.shift()); }));
  fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify({ at: new Date().toISOString(), seed: SEED, filter: String(JSON.stringify(FRAME_FILTER)), books: out }, null, 1));
  const short = out.filter((b) => b.leaves.length < 3);
  console.error(`done: ${out.length} books; ${out.length - short.length} with 3 leaves; ${short.length} short (${short.filter((b) => !b.leaves.length).length} with none)`);
  await c.close();
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
