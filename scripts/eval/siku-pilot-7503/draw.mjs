#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/draw.mjs — the same frame (books held `paddle-zh-5600-ocr-only`, seeded
// shuffle with paired-stats makeRng), but it draws one run of 4 pages per book; this draws WHOLE books, 5 per size
// quartile, and leaves out every book another job has listed (lane_job_books) or that already carries English.
/**
 * #7503 Siku translation pilot draw: 20 books held `paddle-zh-5600-ocr-only` with Paddle OCR and no English, 5 from
 * each quartile of pages_count, seeded. Read only.
 *
 *   node --env-file=.env.production.local scripts/eval/siku-pilot-7503/draw.mjs --out=DIR [--exclude=F.json]
 *
 * A book is eligible when: hold reason paddle-zh-5600-ocr-only; pages_count > 0; 0 pages with translation; OCR on
 * >= 80% of pages and >= 85% of the OCR from Paddle (the skqs-flash-pilot-5600 rule); no work_id sibling with any
 * translated page; not in any lane_job_books list touched since 2026-10-20 (another job's books), nor in --exclude
 * (a JSON array of book ids). Writes DIR/draw.json and DIR/page-ids.json (every translatable page, book by book,
 * page order).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';

const SEED = 7503;
const PER_QUARTILE = 5;
const REASON = 'paddle-zh-5600-ocr-only';
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out'));
const exclude = new Set(arg('exclude') ? JSON.parse(fs.readFileSync(arg('exclude'), 'utf8')) : []);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const taken = new Map();
for (const j of await db.collection('lane_job_books').find({ last_at: { $gte: new Date('2026-10-20') } }, { projection: { job: 1, book_ids: 1 } }).toArray()) for (const id of j.book_ids || []) taken.set(id, j.job);
const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': REASON, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, pages_count: 1, work_id: 1, visible: 1, pages_translated: 1 } }).toArray();
const frame = books.filter((b) => b.id && !taken.has(b.id) && !exclude.has(b.id)).sort((a, b) => a.pages_count - b.pages_count || (a.id < b.id ? -1 : 1));
const q = (f) => frame[Math.min(frame.length - 1, Math.floor(f * frame.length))].pages_count;
const cuts = [q(0.25), q(0.5), q(0.75)];
const quart = (n) => cuts.filter((c) => n > c).length;
const strata = [[], [], [], []];
for (const b of frame) strata[quart(b.pages_count)].push(b);
const rng = makeRng(SEED);
for (const s of strata) for (let i = s.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }

const picked = [], skipped = [];
for (const [qi, s] of strata.entries()) {
  let got = 0;
  for (const b of s) {
    if (got >= PER_QUARTILE) break;
    const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.source': 1, 'translation.data': 1 } }).sort({ page_number: 1 }).toArray();
    const withOcr = pages.filter((p) => p.ocr?.data?.trim());
    const why = pages.some((p) => p.translation?.data) ? 'has English'
      : withOcr.length < 0.8 * pages.length ? `OCR on ${withOcr.length}/${pages.length}`
      : withOcr.filter((p) => p.ocr.source === 'paddle').length < 0.85 * withOcr.length ? 'OCR under 85% Paddle' : null;
    if (why) { skipped.push({ id: b.id, why }); continue; }
    if (b.work_id) {
      const sib = await db.collection('books').find({ work_id: b.work_id, id: { $ne: b.id } }, { projection: { id: 1 } }).toArray();
      if (sib.length && await db.collection('pages').findOne({ book_id: { $in: sib.map((x) => x.id) }, 'translation.data': { $exists: true } }, { projection: { _id: 1 } })) { skipped.push({ id: b.id, why: 'sibling translated' }); continue; }
    }
    const tr = pages.filter((p) => isTranslatablePage(p).ok);
    picked.push({ book_id: b.id, title: b.title, quartile: qi + 1, pages_count: b.pages_count, visible: !!b.visible, translatable: tr.length, page_ids: tr.map((p) => p.id) });
    got++;
  }
}
await client.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, reason: REASON, frame_books: frame.length, held_books: books.length, excluded_other_jobs: books.filter((b) => taken.has(b.id)).length, quartile_cuts: cuts, drawn_at: new Date().toISOString(), skipped, books: picked.map(({ page_ids, ...b }) => b) }, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'page-ids.json'), JSON.stringify(picked.flatMap((b) => b.page_ids)) + '\n');
console.log(`held ${books.length}, frame ${frame.length} (other jobs' books out: ${books.filter((b) => taken.has(b.id)).length}); quartile cuts ${cuts.join('/')}; picked ${picked.length}, skipped ${skipped.length}; ${picked.reduce((a, b) => a + b.translatable, 0)} translatable pages`);
for (const b of picked) console.log(`  Q${b.quartile} ${b.book_id} ${b.pages_count}p ${b.translatable} tr ${b.visible ? 'visible' : 'hidden'} ${b.title}`);
