#!/usr/bin/env node
// PRIOR ART: scripts/eval/router-confirm/confirm.mjs pageOf + exclusions (the page rule, the block, the evidence books,
// restated: its model list is Flash-Lite) and evidenceSources (imported); scripts/eval/queue-routes-7853/frame.mjs (books
// weighted by pages owed, sequential Poisson PPS); scripts/eval/route-judge-6740/judge.mjs drawGerman (the German
// translation frame). New: the drawn page sits at a seeded place in its 4-page block, so position in the block can be measured.
/**
 * The panel's fixed page list. Read-only on Mongo (readonly-mongo preload through confirm.mjs).
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/route-panel-7263/draw.mjs --cell=latin
 * Writes OUT/<cell>/selected.json, the stored texts, and prints the list's sha256 (the freeze).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { MongoClient } from 'mongodb';
import { evidenceSources, wordCount } from '../router-confirm/confirm.mjs';
import { isInterior, lastPageNumber } from '../../batch/cli-ocr-lane.mjs';
import { VISIBLE_PAGE_MATCH } from '../../lib/page-counts.mjs';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { SKIP_TRANSLATION_PAGE_TYPES, isTranslatablePage } from '../../lib/translate-core.mjs';
import { scriptClass } from '../lane-judge-sampler.mjs';
import { verdictQuery } from '../lib/judge-rows.mjs';
import { arg, cellOf, sha, unit, writeJ, writeText, pool, SEED, SURPLUS } from './lib.mjs';

const cell = cellOf(arg('cell'));
const FLASH3 = /^gemini-3-flash/, LITE = /flash-lite/;
const notHeld = cell.task === 'ocr'
  ? { 'pipeline_auto.hold': { $exists: false }, 'pipeline_auto.status': { $ne: 'held' } }
  // a book held only for the CLI translation lane (translate-cli-7075) is waiting for exactly this kind of read
  : { $or: [{ 'pipeline_auto.hold': { $exists: false } }, { 'pipeline_auto.hold.reason': 'translate-cli-7075' }], 'pipeline_auto.status': { $ne: 'held' } };
const pageMatch = cell.task === 'ocr'
  ? { ...VISIBLE_PAGE_MATCH, 'ocr.model': FLASH3, 'ocr.edited_by': { $exists: false }, 'ocr.source': { $ne: 'manual' }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' } }
  : { ...VISIBLE_PAGE_MATCH, page_number: { $gt: 0 }, 'translation.model': LITE, 'translation.edited_by': { $exists: false }, 'translation.source': { $ne: 'manual' }, translation_stale: { $exists: false }, translation_withheld: { $ne: true }, page_type: { $nin: SKIP_TRANSLATION_PAGE_TYPES }, 'ocr.data': { $type: 'string' }, 'translation.data': { $type: 'string' } };
const toDate = (f) => ({ $convert: { input: f, to: 'date', onError: null, onNull: null } });

async function evidenceBooks(db) {
  const ids = new Set();
  for (const f of evidenceSources(cell.base).files) {
    let t = fs.readFileSync(f); if (f.endsWith('.gz')) t = zlib.gunzipSync(t);
    for (const x of String(t).match(/[0-9a-f]{24}/g) || []) ids.add(x);
  }
  const all = [...ids], books = new Set(all);
  for (let i = 0; i < all.length; i += 1000) for (const p of await db.collection('pages').find({ id: { $in: all.slice(i, i + 1000) } }, { projection: { book_id: 1 } }).toArray()) books.add(p.book_id);
  return { books, ids: all.length };
}

/** One eligible page of a book, its block of 4 with the page at a seeded place, its stored text; or {skip}. */
async function pageOf(db, b) {
  const rows0 = await db.collection('pages').aggregate([
    { $match: { book_id: b.id, ...pageMatch } },
    { $project: { _id: 0, id: 1, page_number: 1, n: { $cond: [{ $eq: [{ $type: '$ocr.data' }, 'string'] }, { $strLenCP: '$ocr.data' }, 0] }, hw: { $regexMatch: { input: '$ocr.data', regex: '<script>\\s*handwritten', options: 'i' } },
      fresh: cell.task === 'ocr' ? { $literal: true } : { $gte: [toDate('$translation.updated_at'), toDate('$ocr.updated_at')] } } },
    { $match: { n: { $gte: 300 }, hw: false, fresh: true } }, { $sort: { page_number: 1 } }]).toArray();
  if (!rows0.length) return { skip: 'no page waiting' };
  const last = await lastPageNumber(db, b.id);
  const owed = rows0.filter((p) => isInterior(p.page_number, last));
  if (!owed.length) return { skip: 'no interior page waiting' };
  const pick = owed[Math.floor(unit(`${SEED}:page:${b.id}`) * owed.length)];
  const all = await db.collection('pages').find({ book_id: b.id, ...VISIBLE_PAGE_MATCH }, { projection: { id: 1, book_id: 1, page_number: 1, script_type: 1, page_type: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, photo: 1, enhanced_photo: 1, photo_original: 1, crop: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.unreadable': 1, translation: 1 } }).sort({ page_number: 1 }).toArray();
  const i = all.findIndex((x) => x.id === pick.id);
  if (i < 0) return { skip: 'page gone' };
  const p = all[i], sc = scriptClass(p.ocr?.data, p.script_type, null);
  if (sc.script_type !== 'print') return { skip: `script ${sc.script_type}` };
  // the drawn page's place in its block is seeded; a window that leaves the book or skips a number slides to the nearest that fits
  const want = Math.floor(unit(`${SEED}:pos:${p.id}`) * 4);
  const okWindow = (s) => { const w = all.slice(s, s + 4); return s >= 0 && w.length === 4 && w.every((x, k) => x.page_number === w[0].page_number + k && getPageSource(x) && (cell.task === 'ocr' || isTranslatablePage(x).ok)); };
  const pos = [want, ...[0, 1, 2, 3].filter((k) => k !== want)].find((k) => okWindow(i - k));
  if (pos == null) return { skip: 'no block of 4 consecutive usable pages' };
  const image = getPageSource(p);
  try { const r = await fetch(image); const n = (await r.arrayBuffer()).byteLength; if (!r.ok || n < 2000) return { skip: `image ${r.ok ? 'under 2 KB' : `HTTP ${r.status}`}` }; } catch (e) { return { skip: 'image fetch failed' }; }
  const block = all.slice(i - pos, i - pos + 4);
  return { p, pos, want, block, image, owed: owed.length };
}

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const yearQ = cell.task === 'translation' ? { year: { $gte: 1500, $lte: 1800 } } : {};
const books = (await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, language: { $regex: cell.re }, ...yearQ, ...notHeld }, { projection: { id: 1, title: 1, language: 1, year: 1, pages_count: 1 } }).toArray()).sort((a, b) => a.id.localeCompare(b.id));
console.log(`${cell.id}: ${books.length} books in the book frame`);
const ev = await evidenceBooks(db);
const census = [];
await pool(books.filter((b) => !ev.books.has(b.id)), 8, async (b) => {
  const n = await db.collection('pages').countDocuments({ book_id: b.id, ...pageMatch });
  if (n) census.push({ b, n });
  if (census.length % 500 === 0 && n) console.log(`  census ${census.length}`);
});
const total = census.reduce((a, x) => a + x.n, 0);
console.log(`census: ${census.length} books, ${total} pages by the stored model (before the page rule); evidence books left out: ${books.filter((b) => ev.books.has(b.id)).length}`);
// sequential Poisson PPS (Efraimidis): key -ln(U)/w ascending. One page a book, uniform within it, so the page list reads as a draw of the queue's pages.
const order = census.map((x) => ({ ...x, k: -Math.log(unit(`${SEED}:book:${cell.name}:${x.b.id}`)) / x.n })).sort((a, b) => a.k - b.k);
const sel = [], skipped = {};
let tried = 0;
for (const { b, n } of order) {
  if (sel.length >= SURPLUS) break;
  tried++;
  const g = await pageOf(db, b);
  if (g.skip) { skipped[g.skip] = (skipped[g.skip] ?? 0) + 1; continue; }
  const key = `P${g.p.id}`;
  writeText(cell, key, 'stored', cell.task === 'ocr' ? g.p.ocr.data : g.p.translation.data);
  if (cell.task === 'translation') writeText(cell, key, 'source', g.p.ocr.data);
  sel.push({ order: sel.length, key, book_id: b.id, title: String(b.title || '').slice(0, 80), language: b.language, year: b.year ?? null, pages_count: b.pages_count, weight: n, page_id: g.p.id, page_number: g.p.page_number, image: g.image, block: g.block.map((x) => x.id), block_images: g.block.map((x) => getPageSource(x)), block_pos: g.pos, block_pos_seeded: g.want, stored_model: cell.task === 'ocr' ? g.p.ocr.model : g.p.translation.model, stored_sha: sha(cell.task === 'ocr' ? g.p.ocr.data : g.p.translation.data).slice(0, 16), words: wordCount(cell.task === 'ocr' ? g.p.ocr.data : g.p.translation.data), owed: g.owed });
  console.log(`  ${sel.length}/${SURPLUS} ${b.id} p.${g.p.page_number} pos ${g.pos} (${n} waiting) ${String(b.title || '').slice(0, 40)}`);
}
await c.close();
const frame = { books_in_frame: books.length, evidence_books_left_out: books.filter((b) => ev.books.has(b.id)).length, census_books: census.length, census_pages: total, books_tried: tried, skipped, evidence_ids: ev.ids };
const list = sel.map(({ order, key, book_id, page_id, page_number, block, block_pos, weight, stored_sha, words }) => ({ order, key, book_id, page_id, page_number, block, block_pos, weight, stored_sha, words }));
const hash = sha(JSON.stringify(list));
writeJ(path.join(cell.dir, 'selected.json'), { at: new Date().toISOString(), cell: cell.id, seed: SEED, frame, list_sha256: hash, selected: sel });
writeJ(path.join(cell.dir, 'panel-list.json'), { cell: cell.id, seed: SEED, frame, list_sha256: hash, pages: list });
console.log(JSON.stringify(frame)); console.log(`FROZEN ${cell.name} ${sel.length} pages sha256 ${hash}`);
