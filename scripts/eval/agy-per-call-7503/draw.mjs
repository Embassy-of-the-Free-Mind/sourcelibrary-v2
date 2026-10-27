#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook — one page per book, not a run of 4 consecutive pages
// from held SKQS books; scripts/eval/lib/paired-stats.mjs makeRng is the seeded stream used here.
/**
 * #7503 draw: 15 live books held as `paddle-zh-5600-ocr-only` or `gpu-backlog-5660`, not in the
 * skqs-flash-pilot-5600 pilot; from each, one run of 4 consecutive translatable pages whose OCR is Paddle
 * (`ocr.source: paddle`), starting at a seeded random point. Read only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/agy-per-call-7503/draw.mjs --pilot=F --out=DIR
 *
 * Writes DIR/draw.json (books, pages, OCR chars) and DIR/page-ids.json (a JSON array in page order, readPageIdsFile's format).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const SEED = 7503;
const N_BOOKS = 15, RUN = 4;
const REASONS = ['paddle-zh-5600-ocr-only', 'gpu-backlog-5660'];
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.dirname(new URL(import.meta.url).pathname));
const pilot = new Set(JSON.parse(fs.readFileSync(arg('pilot'), 'utf8')).map((b) => b.id));

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books').find({ 'pipeline_auto.hold.reason': { $in: REASONS }, visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, title: 1, pages_count: 1, work_id: 1, 'pipeline_auto.hold.reason': 1 } }).toArray();
const frame = books.filter((b) => b.id && !pilot.has(b.id)).sort((a, b) => (a.id < b.id ? -1 : 1));
const rng = makeRng(SEED);
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }

const picked = [], skipped = [];
for (const b of frame) {
  if (picked.length >= N_BOOKS) break;
  const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { id: 1, page_number: 1, page_type: 1, ocr: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const ok = (p) => p && p.ocr?.source === 'paddle' && isTranslatablePage(p).ok;
  const starts = pages.filter((p) => [0, 1, 2, 3].every((k) => ok(byNum.get(p.page_number + k)))).map((p) => p.page_number);
  if (!starts.length) { skipped.push({ id: b.id, why: 'no run of 4 translatable Paddle pages' }); continue; }
  const start = starts[Math.floor(rng() * starts.length)];
  const run = [0, 1, 2, 3].map((k) => byNum.get(start + k));
  picked.push({
    book_id: b.id, title: b.title, work_id: b.work_id ?? null, hold: b.pipeline_auto.hold.reason, pages_count: b.pages_count, start,
    pages: run.map((p) => ({ page_id: p.id, page_number: p.page_number, page_type: p.page_type ?? null, ocr_chars: p.ocr.data.length, ocr_model: p.ocr.model ?? null, image: getPageSource(p) })),
  });
}
await client.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, reasons: REASONS, frame_books: frame.length, pilot_excluded: pilot.size, drawn_at: new Date().toISOString(), skipped, books: picked }, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'page-ids.json'), JSON.stringify(picked.flatMap((b) => b.pages.map((p) => p.page_id))) + '\n');
console.log(`frame ${frame.length} books (pilot ${pilot.size} excluded); picked ${picked.length}, skipped ${skipped.length}; ${picked.length * RUN} pages`);
for (const b of picked) console.log(`  ${b.book_id} ${b.hold} p.${b.start}-${b.start + 3} chars ${b.pages.map((p) => p.ocr_chars).join('/')} ${b.title}`);
