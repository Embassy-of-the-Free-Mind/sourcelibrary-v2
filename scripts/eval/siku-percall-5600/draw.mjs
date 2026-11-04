#!/usr/bin/env node
// PRIOR ART: scripts/eval/agy-per-call-7503/draw.mjs — 15 books x a run of 4 Paddle pages, frame = two hold reasons on
// 2026-10-27. It does not fit as is: this frame is the lane's cohort as siku-translate-lane.mjs picks it today (three
// hold reasons, rung, OCR share, residue/#7090 exclusions, untranslated pages only), and the unit is ONE drawn page
// per book, set at a seeded position inside its 4-page block. rankBooks / HOLD_REASONS are imported from the lane.
/**
 * #5600 draw for the Siku per-call / prompt-line test: 30 books, uniform from the lane's cohort; from each, one page
 * uniform among its untranslated translatable Paddle pages that sit inside a run of 4 such consecutive pages, and the
 * 4-page block that holds it (the drawn page's position in the block is uniform among the valid offsets). Read only.
 *
 *   node --env-file=/data/scratch/sl/sourcelibrary/.env.production.local scripts/eval/siku-percall-5600/draw.mjs [--out=DIR]
 *
 * Writes draw.json (seed, frame size, books, block, drawn page) and block-ids.json (all 120 block pages in book/page order).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isTranslatablePage } from '../../lib/translate-core.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { UNTRANSLATED } from '../../batch/cli-translate-lane.mjs';
import { HOLD_REASONS, RUNGS, ISSUE_7090_BOOKS, CHAT_REPLY_RE, rankBooks } from '../../batch/siku-translate-lane.mjs';

const SEED = 5600;
const N_BOOKS = 30, BLOCK = 4;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = path.resolve(arg('out') || HERE);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const rows = await db.collection('books').find(
  { 'pipeline_auto.status': 'held', 'pipeline_auto.hold.reason': { $in: [...HOLD_REASONS] }, 'translation_state.rung': { $in: [...RUNGS] }, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, language: 1, visible: 1, pages_count: 1, work_id: 1, translation_state: 1, pipeline_auto: 1 } },
).toArray();
// The lane's exclusions that define the cohort (residue classes, seal titles, #7090). Other jobs' lane_job_books lists
// are not applied: they keep two WRITERS apart, and this draw writes nothing.
const classes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/eval/zh-residue-refs-6871/classes.json'), 'utf8'));
const exclude = new Set(ISSUE_7090_BOOKS);
for (const k of ['table', 'mixed', 'seal']) for (const id of classes[k]?.bids || []) exclude.add(id);
const sealRe = classes.seal?.pattern ? new RegExp(classes.seal.pattern) : null;
const frame = rankBooks(rows, { exclude, sealRe }).sort((a, b) => (a.id < b.id ? -1 : 1));
const rng = makeRng(SEED);
for (let i = frame.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [frame[i], frame[j]] = [frame[j], frame[i]]; }

const picked = [], skipped = [];
for (const b of frame) {
  if (picked.length >= N_BOOKS) break;
  const pages = await db.collection('pages').find({ book_id: b.id, ...UNTRANSLATED }, { projection: { id: 1, book_id: 1, page_number: 1, page_type: 1, ocr: 1, archived_photo: 1, display_photo: 1, photo: 1, photo_original: 1, cropped_photo: 1, enhanced_photo: 1, split_from_spread: 1 } }).sort({ page_number: 1 }).toArray();
  const byNum = new Map(pages.map((p) => [p.page_number, p]));
  const ok = (p) => p && p.ocr?.source === 'paddle' && isTranslatablePage(p).ok && !CHAT_REPLY_RE.test(p.ocr?.data || '');
  const starts = new Set(pages.filter((p) => [0, 1, 2, 3].every((k) => ok(byNum.get(p.page_number + k)))).map((p) => p.page_number));
  // Pages inside at least one valid run, each with the offsets it can take.
  const cands = pages.filter((p) => ok(p)).map((p) => ({ p, offsets: [0, 1, 2, 3].filter((k) => starts.has(p.page_number - k)) })).filter((c) => c.offsets.length);
  if (!cands.length) { skipped.push({ id: b.id, title: b.title, why: 'no run of 4 untranslated translatable Paddle pages' }); continue; }
  const c = cands[Math.floor(rng() * cands.length)];
  const k = c.offsets[Math.floor(rng() * c.offsets.length)];
  const start = c.p.page_number - k;
  const block = [0, 1, 2, 3].map((i) => byNum.get(start + i));
  picked.push({
    book_id: b.id, title: b.title, work_id: b.work_id ?? null, hold: b.pipeline_auto.hold.reason, visible: !!b.visible, pages_count: b.pages_count,
    eligible_pages: cands.length, drawn_page_id: c.p.id, drawn_page_number: c.p.page_number, position: k + 1,
    block: block.map((p) => ({ page_id: p.id, page_number: p.page_number, page_type: p.page_type ?? null, ocr_chars: p.ocr.data.length, ocr_model: p.ocr.model ?? null, image: getPageSource(p) })),
  });
}
await client.close();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'draw.json'), JSON.stringify({ seed: SEED, hold_reasons: HOLD_REASONS, frame_books: frame.length, drawn_at: new Date().toISOString(), skipped, books: picked }, null, 1) + '\n');
fs.writeFileSync(path.join(OUT, 'block-ids.json'), JSON.stringify(picked.flatMap((b) => b.block.map((p) => p.page_id))) + '\n');
console.log(`frame ${frame.length} books; picked ${picked.length}, skipped ${skipped.length}`);
for (const b of picked) console.log(`  ${b.book_id} ${b.hold} p.${b.block[0].page_number}-${b.block[3].page_number} drawn p.${b.drawn_page_number} (pos ${b.position}) chars ${b.block.map((p) => p.ocr_chars).join('/')} ${b.title}`);
