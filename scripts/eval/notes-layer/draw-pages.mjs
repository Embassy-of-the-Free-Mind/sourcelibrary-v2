#!/usr/bin/env node
// PRIOR ART: scripts/audit/translation-page-boundary.mjs and scripts/audit/translation-bridging.mjs draw one page
// per book, but each joins it to neighbours and its own detector and neither keeps the stored markup; the 793-page
// measure behind src/lib/term-definitions.ts (#5700 comment, 2026-10-06) left no script on main. This one only
// draws and saves, read-only.
/** Seeded one-page-per-book draw of live translated pages for the #5942 parser measurement (read-only). */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/notes-layer/draw-pages.mjs [--n 800] [--seed 5942]
 *
 * Books: visible, pages_count > 0, pages_translated > 0, not Tibetan (#5942 brief). Sorted by id, shuffled with
 * mulberry32(seed); the first n that have a page with a non-empty translation give one page each, chosen by the same
 * stream from the book's translated page numbers in ascending order.
 * Output: results/notes-layer-2026-10/parser/draw.jsonl (ids and hashes, committed) and work/pages.jsonl (the
 * stored markup, not committed).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 800)); const SEED = Number(opt('seed', 5942));
const DIR = new URL('../results/notes-layer-2026-10/parser/', import.meta.url).pathname;
fs.mkdirSync(`${DIR}work`, { recursive: true });

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } })
  .project({ _id: 0, id: 1, language: 1, title: 1 }).toArray();
const pool = books.filter((b) => b.id && !/tibet/i.test(String(b.language || ''))).sort((a, b) => (a.id < b.id ? -1 : 1));
console.log(`live books with a translation: ${books.length}; after dropping Tibetan: ${pool.length}`);
const rng = makeRng(SEED);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

const draw = []; const pages = []; let tried = 0;
for (const b of pool) {
  if (draw.length >= N) break;
  tried++;
  const nums = (await db.collection('pages').find({ book_id: b.id, 'translation.data': { $type: 'string', $ne: '' } }).project({ _id: 0, page_number: 1 }).toArray())
    .map((p) => p.page_number).sort((x, y) => x - y);
  const pick = nums.length ? nums[Math.floor(rng() * nums.length)] : null;
  if (pick == null) continue;
  const p = await db.collection('pages').findOne({ book_id: b.id, page_number: pick }, { projection: { _id: 0, id: 1, page_number: 1, page_type: 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.prompt_name': 1, 'translation.model': 1, 'translation.updated_at': 1, 'translation.source': 1 } });
  const t = p.translation;
  if (!t?.data?.trim()) continue;
  const row = { book_id: b.id, page_number: pick, page_id: p.id, language: b.language ?? null, page_type: p.page_type ?? null, prompt_version: t.prompt_version ?? null, prompt_name: t.prompt_name ?? null, model: t.model ?? null, source: t.source ?? null, updated_at: t.updated_at ?? null, chars: t.data.length, sha16: crypto.createHash('sha256').update(t.data).digest('hex').slice(0, 16) };
  draw.push(row); pages.push({ ...row, data: t.data });
  if (draw.length % 100 === 0) console.log(`${draw.length} pages (${tried} books tried)`);
}
await c.close();
fs.writeFileSync(`${DIR}draw.jsonl`, draw.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${DIR}work/pages.jsonl`, pages.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(`drew ${draw.length} pages from ${tried} books tried (seed ${SEED}) -> ${DIR}draw.jsonl`);
