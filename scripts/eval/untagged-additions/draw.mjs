#!/usr/bin/env node
// PRIOR ART: scripts/eval/notes-layer/draw-pages.mjs (#5942, on PR #5958's branch, not on main) draws one translated
// page per live book with a seeded shuffle and saves the translation only. This is the same draw with a new seed,
// and it also saves the page's OCR and the neighbouring pages' OCR edges, which a source-grounded check needs.
/** #5982 seeded one-page-per-book draw of live translated pages with their OCR source (read-only). */
/**
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/untagged-additions/draw.mjs [--n 450] [--seed 5982]
 * Books: visible, pages_count > 0, pages_translated > 0; Tibetan dropped and counted. Sorted by id, shuffled with
 * mulberry32(seed); one page per book, chosen by the same stream from the pages that hold both a translation and an OCR text.
 * Output: results/untagged-additions-2026-10/draw.jsonl (ids, hashes; committed) and work/draw-items.jsonl (texts).
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const N = Number(opt('n', 450)); const SEED = Number(opt('seed', 5982));
const DIR = new URL('../results/untagged-additions-2026-10/', import.meta.url).pathname;
fs.mkdirSync(`${DIR}work`, { recursive: true });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex').slice(0, 16);

const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const books = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 }, pages_translated: { $gt: 0 } }).project({ _id: 0, id: 1, language: 1, title: 1 }).toArray();
const isTibetan = (b) => /tibet/i.test(String(b.language || ''));
const pool = books.filter((b) => b.id && !isTibetan(b)).sort((a, b) => (a.id < b.id ? -1 : 1));
const tibetan = books.filter(isTibetan).length;
console.log(`live books with a translation: ${books.length}; Tibetan excluded: ${tibetan}; pool ${pool.length}`);
const rng = makeRng(SEED);
for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }

const draw = []; const items = []; let tried = 0, noPage = 0;
const P = db.collection('pages');
for (const b of pool) {
  if (draw.length >= N) break;
  tried++;
  const nums = (await P.find({ book_id: b.id, 'translation.data': { $type: 'string', $ne: '' }, 'ocr.data': { $type: 'string', $ne: '' } }).project({ _id: 0, page_number: 1 }).toArray()).map((p) => p.page_number).sort((x, y) => x - y);
  const pick = nums.length ? nums[Math.floor(rng() * nums.length)] : null;
  if (pick == null) { noPage++; continue; }
  const around = await P.find({ book_id: b.id, page_number: { $in: [pick - 1, pick, pick + 1] } }).project({ _id: 0, id: 1, page_number: 1, page_type: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.source': 1, 'translation.data': 1, 'translation.prompt_version': 1, 'translation.prompt_name': 1, 'translation.model': 1, 'translation.updated_at': 1, 'translation.source': 1 }).toArray();
  const p = around.find((x) => x.page_number === pick); const t = p?.translation;
  if (!t?.data?.trim() || !p.ocr?.data?.trim()) { noPage++; continue; }
  const prev = around.find((x) => x.page_number === pick - 1)?.ocr?.data || ''; const next = around.find((x) => x.page_number === pick + 1)?.ocr?.data || '';
  const id = `${b.id}_${String(pick).padStart(5, '0')}`;
  const row = { id, book_id: b.id, page_number: pick, page_id: p.id, language: b.language ?? null, page_type: p.page_type ?? null, model: t.model ?? null, prompt_version: t.prompt_version == null ? null : String(t.prompt_version), prompt_name: t.prompt_name ?? null, translation_source: t.source ?? null, updated_at: t.updated_at ?? null, ocr_model: p.ocr.model ?? null, ocr_source: p.ocr.source ?? null, translation_chars: t.data.length, ocr_chars: p.ocr.data.length, translation_sha16: sha(t.data), ocr_sha16: sha(p.ocr.data) };
  draw.push(row); items.push({ id, source: p.ocr.data, translation: t.data, prev: prev.slice(-1500), next: next.slice(0, 1500) });
  if (draw.length % 100 === 0) console.log(`${draw.length} pages (${tried} books tried)`);
}
await c.close();
fs.writeFileSync(`${DIR}draw.jsonl`, draw.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${DIR}work/draw-items.jsonl`, items.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(`${DIR}draw.meta.json`, JSON.stringify({ seed: SEED, n: draw.length, live_books_with_translation: books.length, tibetan_books_excluded: tibetan, pool: pool.length, books_tried: tried, books_without_a_page_holding_both_texts: noPage, drawn_at: new Date().toISOString() }, null, 1));
console.log(`drew ${draw.length} pages from ${tried} books tried (${noPage} without a usable page), seed ${SEED}`);
