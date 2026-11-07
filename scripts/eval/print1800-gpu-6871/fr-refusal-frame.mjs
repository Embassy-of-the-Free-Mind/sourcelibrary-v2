#!/usr/bin/env node
// PRIOR ART: scripts/eval/print1800-gpu-6871/census.mjs (the refusal predicate, copied) and scripts/workers/gpu-print-lane.mjs
// `plan` (the manifest row format and page filter, copied) — `plan` takes English only and places a hold, so it does not fit
// a files-only read of the French refusals the 10-29 record names as a follow-up ("French refusals: a 731-page route").
/**
 * fr-refusal-frame.mjs — #6871: the French 1800+ pages Flash-Lite refused (no text, a refusal/failure stamp), as a
 * gpu-print manifest (<bid>\t<pn>\t<pid>\t<url>) for scripts/gpu/gpu-print-gpu.sh with LANE_DIR set to the output dir.
 * READ-ONLY: no hold, no plan file in the lane, nothing written to Mongo. Applying the reads is a decision for a person.
 *   node --env-file=.env.production.local fr-refusal-frame.mjs --out=$JOB_SCRATCH/fr-refusals
 * Writes <out>/manifest.tsv and <out>/frame.json (per book: title, year, visible, hold, unsplit spread, pages).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { isUnsplitSpread } from '../../lib/pipeline-hold.mjs';
import { isHumanEdited } from '../../lib/gpu-print-lane.mjs';

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const OUT = arg('out'); if (!OUT) { console.error('--out=DIR required'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const hasText = (o) => typeof o?.data === 'string' && o.data.trim().length > 0;
const refused = (o) => (o?.recitation_count ?? 0) > 0 || o?.recitation_blocked === true || o?.fail_blocked === true
  || (typeof o?.fail_reason === 'string' && o.fail_reason.length > 0);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect(); const db = c.db('bookstore');
const books = await db.collection('books').find({ language: { $regex: '^French' }, year: { $gte: 1800, $lte: 2030 }, pages_count: { $gt: 0 } },
  { projection: { _id: 0, id: 1, title: 1, year: 1, visible: 1, pipeline_auto: 1, needs_splitting: 1, split_completed: 1 } }).toArray();
const frame = []; const rows = []; const tally = { books: books.length, refused: 0, human_edited: 0, no_image: 0, planned: 0 };
for (const b of books) {
  const pages = await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH,
    $or: [{ 'ocr.data': { $exists: false } }, { 'ocr.data': null }, { 'ocr.data': { $regex: /^\s*$/ } }] },
  { projection: { id: 1, page_number: 1, ocr: 1, photo: 1, archived_photo: 1, cropped_photo: 1, enhanced_photo: 1, photo_original: 1, split_from_spread: 1, crop: 1 } })
    .sort({ page_number: 1 }).toArray();
  const mine = [];
  for (const p of pages) {
    if (hasText(p.ocr) || !refused(p.ocr)) continue;
    tally.refused++;
    if (isHumanEdited(p.ocr)) { tally.human_edited++; continue; }
    const src = getPageSource(p)?.replace(/\s+/g, '') || null;
    if (!src) { tally.no_image++; continue; }
    mine.push({ pid: p.id, pn: p.page_number, src });
  }
  if (!mine.length) continue;
  frame.push({ bid: b.id, title: String(b.title).slice(0, 80), year: b.year, visible: !!b.visible,
    hold: b.pipeline_auto?.hold?.reason ?? null, status: b.pipeline_auto?.status ?? null, unsplit_spread: isUnsplitSpread(b), pages: mine.length });
  for (const r of mine) rows.push(`${b.id}\t${r.pn}\t${r.pid}\t${r.src}`);
  tally.planned += mine.length;
}
await c.close();
fs.writeFileSync(path.join(OUT, 'manifest.tsv'), rows.join('\n') + (rows.length ? '\n' : ''));
fs.writeFileSync(path.join(OUT, 'frame.json'), JSON.stringify({ built_at: new Date().toISOString(), tally, books: frame }, null, 1));
console.log(JSON.stringify({ ...tally, frame_books: frame.length, visible_books: frame.filter((f) => f.visible).length,
  held_books: frame.filter((f) => f.hold).length, unsplit_spread_books: frame.filter((f) => f.unsplit_spread).length }));
