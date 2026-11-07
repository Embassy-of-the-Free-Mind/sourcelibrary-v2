#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/draw.mjs (PR #7518) — the same shape (15 books x 4 consecutive pages,
// seeded), but over held Siku books whose pages carry Paddle OCR for a translation test; this one draws German and
// Latin print whose pages have no OCR or only a Flash-Lite read, for an OCR test. scripts/eval/lib/paired-stats.mjs
// makeRng is the seeded stream.
/**
 * #7522 draw: 15 visible German or Latin books that readers open (human_read_count > 0), idle in the pipeline (not
 * held, not mid-lane), printed (no manuscript record type or category; the first draw took two BPH Kurrent
 * manuscripts with no OCR yet, which carry no script_type), 8 German and 7 Latin; from each, one run of 4 consecutive pages that have no OCR or only a
 * Flash-Lite read (and no human edit), starting at a seeded random point, never among the first or last 4 images. Read only.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/ocr-per-call-7522/draw.mjs [--out=DIR]
 *
 * Writes DIR/draw.json (books, pages, the OCR each page had) and DIR/page-ids.json (a JSON array in page order,
 * readPageIdsFile's format). Fraktur or roman type is recorded afterwards, by eye from the drawn images (script.json).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';

const SEED = 7522;
const RUN = 4;
const STRATA = { German: 8, Latin: 7 };
// Statuses with no OCR lane in flight: a lane writing these pages mid-test would race the eval's own apply.
const IDLE = ['complete', 'archive_complete', 'failed', 'parked', 'ocr_complete'];
const LITE = /flash-lite/;
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || path.dirname(new URL(import.meta.url).pathname));

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const books = await db.collection('books').find(
  { visible: true, pages_count: { $gt: 20 }, language: { $in: Object.keys(STRATA) }, human_read_count: { $gt: 0 }, 'pipeline_auto.status': { $in: IDLE }, 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.held': { $ne: true },
    // Print only: a manuscript (metadata.record_type, or the manuscripts category) is a different reading task.
    'metadata.record_type': { $ne: 'manuscript' }, categories: { $ne: 'manuscripts' } },
  { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, pages_count: 1, human_read_count: 1, 'pipeline_auto.status': 1 } },
).toArray();
const rng = makeRng(SEED);
const frame = books.filter((b) => b.id).sort((a, b) => (a.id < b.id ? -1 : 1));
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }

const PROJ = { id: 1, page_number: 1, page_type: 1, script_type: 1, 'ocr.model': 1, 'ocr.data': 1, 'ocr.edited_by': 1, 'ocr.source': 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 };
// Not the first or last 4 images: covers, spine and edges (the second draw took Atlas minor's spine and edges, the
// last 4 images of the book, which carry no OCR because there is nothing to read).
const eligible = (p, last) => p && p.page_number > 4 && p.page_number <= last - 4 && getPageSource(p) && !p.ocr?.edited_by && p.ocr?.source !== 'manual' && p.script_type !== 'handwritten'
  && (!p.ocr?.data?.trim() || LITE.test(p.ocr?.model || ''));
const picked = [], skipped = [], need = { ...STRATA };
for (const b of frame) {
  if (!Object.values(need).some((n) => n > 0)) break;
  if (!(need[b.language] > 0)) continue;
  const pages = await db.collection('pages').find({ book_id: b.id }, { projection: PROJ }).sort({ page_number: 1 }).toArray();
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  if (pages.some((p) => p.script_type === 'handwritten')) { skipped.push({ id: b.id, why: 'handwritten pages' }); continue; }
  const starts = pages.filter((p) => Array.from({ length: RUN }, (_, k) => byNum.get(p.page_number + k)).every((q) => eligible(q, pages[pages.length - 1].page_number))).map((p) => p.page_number);
  if (!starts.length) { skipped.push({ id: b.id, why: 'no run of 4 pages without OCR or with only a Flash-Lite read' }); continue; }
  const start = starts[Math.floor(rng() * starts.length)];
  const run = Array.from({ length: RUN }, (_, k) => byNum.get(start + k));
  need[b.language]--;
  picked.push({
    book_id: b.id, title: b.title, author: b.author ?? null, published: b.published ?? null, language: b.language, human_read_count: b.human_read_count, status: b.pipeline_auto.status, pages_count: b.pages_count, start,
    pages: run.map((p) => ({ page_id: p.id, page_number: p.page_number, page_type: p.page_type ?? null, ocr_model: p.ocr?.data?.trim() ? p.ocr.model : null, ocr_chars: p.ocr?.data?.length ?? 0, image: getPageSource(p) })),
  });
}
await client.close();
picked.sort((a, b) => (a.language === b.language ? (a.book_id < b.book_id ? -1 : 1) : a.language < b.language ? -1 : 1));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, strata: STRATA, idle_statuses: IDLE, frame_books: frame.length, drawn_at: new Date().toISOString(), skipped, books: picked }, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'page-ids.json'), JSON.stringify(picked.flatMap((b) => b.pages.map((p) => p.page_id))) + '\n');
console.log(`frame ${frame.length} books; picked ${picked.length}, skipped ${skipped.length}; ${picked.length * RUN} pages`);
for (const b of picked) console.log(`  ${b.language} ${b.book_id} p.${b.start}-${b.start + RUN - 1} ${b.pages.map((p) => p.ocr_model ? 'lite' : 'none').join('/')} ${b.published ?? ''} ${String(b.title).slice(0, 70)}`);
