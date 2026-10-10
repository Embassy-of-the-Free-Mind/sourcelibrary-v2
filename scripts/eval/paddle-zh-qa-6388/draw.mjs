#!/usr/bin/env node
// PRIOR ART: scripts/eval/ocr-prereg-6388/draw.mjs — the same seeded, exact-count, one-page-per-work draw, but its
// frame is a quality stratum of the served corpus, not "books the Paddle lane wrote"; and
// scripts/eval/ground-truth-5935/kanripo.mjs, whose interior rule (isInterior) and per-book seed are reused here.
//
// #6388 Paddle zh random-sample QA: the DRAW. Committed before any reviewer runs. READ-ONLY (Mongo reads), $0.
//
// RULE (fixed before drawing)
//   Frame ALL   = every book with a `book_events` row {type: 'paddle_zh_reocr', details.pages_written > 0},
//                 de-duplicated, sorted by book id. (One row per book; written by the #5600 and #5660 runs and by
//                 later runs of the same lane, e.g. job paddle-skqs-rest-6388, as each book is applied.)
//   Frame STALE = the subset whose event has details.translations_marked_stale > 0 (English exists and was marked
//                 stale by the lane).
//   Order       = exact Fisher–Yates over each sorted frame with makeRng(6388) for ALL and makeRng(6389) for STALE.
//   Take        = walk ALL in order and keep the first 50 books with an eligible page; then walk STALE and keep the
//                 first 10 eligible books not already kept. The next 5 eligible of each are spares (used only if an
//                 image cannot be fetched, in order).
//   Page        = among the book's pages whose ocr.pipeline is still 'paddle-zh-2026-10' and that are interior
//                 (isInterior: page_number in (15 %, 95 %] of pages_count), one chosen with makeRng(6388 ^ h(book id)).
//                 No content filter: a blank or plate page that Paddle wrote stays in. A book with no such page is
//                 logged as skipped.
//   Image       = ocr.engine.input.image_url (the exact image the lane read), else archived_photo.
//
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/paddle-zh-qa-6388/draw.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
import { isInterior } from '../ground-truth-5935/lib.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SEED = 6388, LANE = 'paddle-zh-2026-10', N_ALL = 50, N_STALE = 10, N_SPARE = 5;
const shuffle = (xs, seed) => { const a = [...xs], r = makeRng(seed); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const bookSeed = id => SEED ^ parseInt(createHash('sha256').update(String(id)).digest('hex').slice(0, 8), 16);

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const drawnAt = new Date().toISOString();
const events = await db.collection('book_events').find({ type: 'paddle_zh_reocr', 'details.pages_written': { $gt: 0 } }, { projection: { _id: 0, book_id: 1, 'details.issue': 1, 'details.translations_marked_stale': 1 } }).toArray();
const byBook = new Map();
for (const e of events) { const o = byBook.get(e.book_id) || { issues: new Set(), stale: 0 }; o.issues.add(e.details?.issue ?? null); o.stale += e.details?.translations_marked_stale || 0; byBook.set(e.book_id, o); }
const all = [...byBook.keys()].sort();
const stale = all.filter(id => byBook.get(id).stale > 0);
const byIssue = {}; for (const o of byBook.values()) for (const i of o.issues) byIssue[i] = (byIssue[i] || 0) + 1;
console.log(`frame ALL ${all.length} (${JSON.stringify(byIssue)}), STALE ${stale.length}; drawn at ${drawnAt}`);

const skipped = [];
async function pick(bookId, stratum) {
  const b = await db.collection('books').findOne({ id: bookId }, { projection: { _id: 0, id: 1, title: 1, pages_count: 1, visible: 1, 'pipeline_auto.hold.reason': 1 } });
  if (!b) { skipped.push({ book_id: bookId, stratum, why: 'book not found' }); return null; }
  const pages = await db.collection('pages').find({ book_id: bookId, 'ocr.pipeline': LANE }, { projection: { _id: 0, id: 1, page_number: 1 } }).toArray();
  const n = b.pages_count || Math.max(0, ...pages.map(p => p.page_number));
  const pool = pages.filter(p => isInterior(p.page_number, n)).sort((x, y) => x.page_number - y.page_number);
  if (!pool.length) { skipped.push({ book_id: bookId, stratum, why: `no interior lane page (${pages.length} lane pages)` }); return null; }
  const pg = pool[Math.floor(makeRng(bookSeed(bookId))() * pool.length)];
  const p = await db.collection('pages').findOne({ id: pg.id }, { projection: { _id: 0, id: 1, page_number: 1, archived_photo: 1, photo_original: 1, 'ocr.engine.input.image_url': 1, 'ocr.engine.run': 1, 'ocr.engine.issue': 1, 'ocr.content_hash': 1, 'ocr.qa_screen.status': 1, 'ocr.qa_screen.dice': 1 } });
  return {
    uid: `${stratum}|${bookId}|${p.page_number}`, stratum, book_id: bookId, title: String(b.title || '').slice(0, 80), pages_count: n, visible: !!b.visible,
    hold: b.pipeline_auto?.hold?.reason ?? null, lane_issue: p.ocr?.engine?.issue ?? null, run: p.ocr?.engine?.run ?? null,
    page_id: p.id, page_number: p.page_number, interior_pool: pool.length, ocr_hash: p.ocr?.content_hash ?? null,
    image: p.ocr?.engine?.input?.image_url || p.archived_photo, photo_original: p.photo_original ?? null,
    kanripo_screen: p.ocr?.qa_screen ? { status: p.ocr.qa_screen.status, dice: p.ocr.qa_screen.dice ?? null } : null,
    stale_translations_marked: byBook.get(bookId).stale,
  };
}
async function take(order, n, stratum, exclude) {
  const rows = [], spares = [];
  for (const id of order) {
    if (rows.length + spares.length >= n + N_SPARE) break;
    if (exclude.has(id)) continue;
    const r = await pick(id, stratum);
    if (!r) continue;
    (rows.length < n ? rows : spares).push(r);
  }
  return { rows, spares };
}
const A = await take(shuffle(all, SEED), N_ALL, 'all', new Set());
const S = await take(shuffle(stale, SEED + 1), N_STALE, 'stale', new Set(A.rows.map(r => r.book_id)));
await client.close();

const out = {
  issue: 6388, seed: SEED, lane: LANE, drawn_at: drawnAt,
  rule: 'see header of draw.mjs: frames from book_events paddle_zh_reocr (pages_written>0); exact Fisher-Yates makeRng(6388) ALL / makeRng(6389) STALE over sorted ids; 50 ALL + 10 STALE (not in ALL), +5 spares each; one interior lane page per book by makeRng(6388 ^ sha256(book_id)[0:8]); image = ocr.engine.input.image_url',
  frame: { all: all.length, stale: stale.length, by_issue: byIssue },
  rows: [...A.rows, ...S.rows], spares: [...A.spares, ...S.spares], skipped,
};
fs.writeFileSync(path.join(HERE, 'draw.json'), JSON.stringify(out, null, 1) + '\n');
console.log(`drawn ${out.rows.length} (+${out.spares.length} spares), skipped ${skipped.length}`);
