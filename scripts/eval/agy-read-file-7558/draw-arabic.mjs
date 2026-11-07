#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-per-call-7522/draw.mjs — the seeded runs-of-4 draw for German/Latin print; its frame is
// visible books with human reads, and the Arabic books this lane reads are all hidden and held (cli-ocr-lane count,
// 2026-10-27: 439 Arabic books, 0 visible). Same run rule, different frame.
/**
 * #7558 step 3: the Arabic 4-pages-a-call check. Frame: books held for the CLI OCR lane (ocr-flash-cli-7075) whose
 * language is Arabic script and that the lane would read (not a spread book). From each of 5 seeded books, one run of 4
 * consecutive unread pages, never among the first or last 4 images. Writes draw-arabic.json and arabic-ids.json here.
 *
 *   node --env-file=... scripts/eval/agy-read-file-7558/draw-arabic.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { CLI_FLASH_OCR_HOLD } from '../../lib/ocr-routing.mjs';
import { HOLD_STATUS } from '../../lib/pipeline-hold.mjs';
import { scriptFamily } from '../../lib/quality-gate-screens.mjs';
import { UNREAD, spreadReason } from '../../batch/cli-ocr-lane.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = 7558, N_BOOKS = 5, RUN = 4;
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const books = (await db.collection('books').find({ 'pipeline_auto.status': HOLD_STATUS, 'pipeline_auto.hold.reason': CLI_FLASH_OCR_HOLD.reason },
  { projection: { id: 1, title: 1, language: 1, published: 1, pages_count: 1, needs_splitting: 1, 'pipeline_auto.split_checked': 1 } }).toArray())
  .filter((b) => scriptFamily(b.language) === 'arabic').sort((a, b) => a.id.localeCompare(b.id));
const rng = makeRng(SEED);
const order = books.map((b) => [rng(), b]).sort((x, y) => x[0] - y[0]).map(([, b]) => b);
const drawn = [], skipped = [];
for (const b of order) {
  if (drawn.length >= N_BOOKS) break;
  const unread = await db.collection('pages').find({ book_id: b.id, ...UNREAD }, { projection: { id: 1, page_number: 1, crop: 1, cropped_photo: 1 } }).sort({ page_number: 1 }).toArray();
  if (spreadReason(b, unread)) { skipped.push({ id: b.id, why: 'spread book' }); continue; }
  const max = b.pages_count || Math.max(0, ...unread.map((p) => p.page_number));
  const starts = unread.filter((p, i) => p.page_number > 4 && p.page_number + RUN - 1 <= max - 4
    && unread.slice(i, i + RUN).length === RUN && unread[i + RUN - 1].page_number === p.page_number + RUN - 1);
  if (!starts.length) { skipped.push({ id: b.id, why: 'no interior run of 4 unread pages' }); continue; }
  const i0 = unread.indexOf(starts[Math.floor(rng() * starts.length)]);
  drawn.push({ book_id: b.id, title: b.title, language: b.language, published: b.published ?? null, pages: unread.slice(i0, i0 + RUN).map((p) => ({ page_id: p.id, page_number: p.page_number })) });
}
await client.close();
fs.writeFileSync(path.join(HERE, 'draw-arabic.json'), JSON.stringify({ seed: SEED, frame_books: books.length, drawn_at: new Date().toISOString(), skipped, books: drawn }, null, 1));
fs.writeFileSync(path.join(HERE, 'arabic-ids.json'), JSON.stringify(drawn.flatMap((b) => b.pages.map((p) => p.page_id))));
console.log(`frame ${books.length} books; drew ${drawn.length}, skipped ${skipped.length}`);
for (const b of drawn) console.log(`  ${b.book_id} ${b.language} ${String(b.title).slice(0, 50)} pp.${b.pages.map((p) => p.page_number).join(',')}`);
