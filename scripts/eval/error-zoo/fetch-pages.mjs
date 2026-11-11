#!/usr/bin/env node
/**
 * PRIOR ART: scripts/eval/error-zoo/feats2.py — reads text and images from the spare-audit PACKETS on disk, so it can
 * only feature the pages that audit drew. This pulls the live text and book facts for every page in labels.jsonl
 * (plus a seam from each neighbour) so the same feature code can run over all sources. scripts/eval/lib/ has no
 * page-text fetcher keyed by page_id.
 *
 * fetch-pages.mjs — for every distinct page_id in <dir>/labels.jsonl, write <dir>/pages.jsonl:
 *   { page_id, book_id, page_number, ocr_text, ocr_model, ocr_prompt_version, ocr_updated_at, translation,
 *     tr_model, tr_updated_at, page_type, script_type, image_width, image_height, withheld, prev: {ocr_tail, tr_tail},
 *     next: {ocr_head, tr_head}, book: { language, year, published, script, book_class, provider, pages_count,
 *     quality_score, visible, hidden, text_role } }
 * Read-only. Usage: node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/error-zoo/fetch-pages.mjs <dir>
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const dir = process.argv[2];
if (!dir) { console.error('usage: fetch-pages.mjs <dir>'); process.exit(1); }
const want = new Map(); // page_id -> {book_id, page_number}
const rl = readline.createInterface({ input: fs.createReadStream(path.join(dir, 'labels.jsonl')) });
for await (const line of rl) { const r = JSON.parse(line); if (r.page_id) want.set(r.page_id, { book_id: r.book_id, page_number: r.page_number }); }
console.log('distinct pages', want.size);

const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const db = client.db('bookstore');
const PROJ = { id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.prompt_version': 1, 'ocr.updated_at': 1, 'ocr.source': 1, 'translation.data': 1, 'translation.model': 1, 'translation.updated_at': 1, page_type: 1, script_type: 1, image_width: 1, image_height: 1, translation_withheld: 1, split_from_spread: 1 };
const iso = (d) => (d instanceof Date ? d.toISOString() : d ? String(d) : null);

const ids = [...want.keys()];
const pages = new Map();
for (let i = 0; i < ids.length; i += 1000) {
  const b = ids.slice(i, i + 1000);
  for (const d of await db.collection('pages').find({ $or: [{ id: { $in: b } }, { _id: { $in: b } }] }, { projection: PROJ }).toArray()) pages.set(d.id ?? String(d._id), d);
}
console.log('fetched pages', pages.size);

// neighbours: one query per (book, page±1), heads and tails only
const nb = new Map();
const nkeys = [];
for (const d of pages.values()) for (const dn of [-1, 1]) nkeys.push({ book_id: d.book_id, page_number: d.page_number + dn });
for (let i = 0; i < nkeys.length; i += 500) {
  // strlen-safe: every $strLenCP operand below is wrapped in $ifNull with '' so it is a string by construction
  const docs = await db.collection('pages').aggregate([
    { $match: { $or: nkeys.slice(i, i + 500) } },
    { $project: { book_id: 1, page_number: 1, ocr_head: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, 0, 500] }, ocr_len: { $strLenCP: { $ifNull: ['$ocr.data', ''] } }, tr_head: { $substrCP: [{ $ifNull: ['$translation.data', ''] }, 0, 400] }, tr_len: { $strLenCP: { $ifNull: ['$translation.data', ''] } },
      // strlen-safe: operands are $ifNull'd to '' (see above)
      ocr_tail: { $substrCP: [{ $ifNull: ['$ocr.data', ''] }, { $max: [0, { $subtract: [{ $strLenCP: { $ifNull: ['$ocr.data', ''] } }, 500] }] }, 500] },
      tr_tail: { $substrCP: [{ $ifNull: ['$translation.data', ''] }, { $max: [0, { $subtract: [{ $strLenCP: { $ifNull: ['$translation.data', ''] } }, 400] }] }, 400] } } },
  ]).toArray();
  for (const d of docs) nb.set(`${d.book_id}|${d.page_number}`, d);
}
console.log('neighbours', nb.size);

const bookIds = [...new Set([...pages.values()].map((d) => d.book_id))];
const books = new Map();
for (let i = 0; i < bookIds.length; i += 500) {
  const b = bookIds.slice(i, i + 500);
  for (const d of await db.collection('books').find({ $or: [{ id: { $in: b } }, { _id: { $in: b } }] }, { projection: { id: 1, language: 1, year: 1, published: 1, 'ai_metadata.script': 1, 'ai_metadata.estimated_year': 1, book_class: 1, 'image_source.provider': 1, pages_count: 1, quality_score: 1, visible: 1, hidden: 1, text_role: 1, script_type: 1, content_type: 1 } }).toArray()) books.set(d.id ?? String(d._id), d);
}
console.log('books', books.size);

const w = fs.createWriteStream(path.join(dir, 'pages.jsonl'));
for (const [pid, d] of pages) {
  const bk = books.get(d.book_id) || {};
  const prev = nb.get(`${d.book_id}|${d.page_number - 1}`); const next = nb.get(`${d.book_id}|${d.page_number + 1}`);
  w.write(JSON.stringify({ page_id: pid, book_id: d.book_id, page_number: d.page_number, ocr_text: d.ocr?.data ?? null, ocr_model: d.ocr?.model ?? null, ocr_prompt_version: d.ocr?.prompt_version ?? null, ocr_source: d.ocr?.source ?? null, ocr_updated_at: iso(d.ocr?.updated_at),
    translation: d.translation?.data ?? null, tr_model: d.translation?.model ?? null, tr_updated_at: iso(d.translation?.updated_at), page_type: d.page_type ?? null, script_type: d.script_type ?? null, image_width: d.image_width ?? null, image_height: d.image_height ?? null,
    withheld: d.translation_withheld?.reason ?? null, split_from_spread: d.split_from_spread ?? null,
    prev: prev ? { ocr_tail: prev.ocr_tail, tr_tail: prev.tr_tail, ocr_len: prev.ocr_len, tr_len: prev.tr_len } : null, next: next ? { ocr_head: next.ocr_head, tr_head: next.tr_head, ocr_len: next.ocr_len, tr_len: next.tr_len } : null,
    book: { language: bk.language ?? null, year: bk.year ?? null, published: bk.published ?? null, script: bk.ai_metadata?.script ?? bk.script_type ?? null, est_year: bk.ai_metadata?.estimated_year ?? null, book_class: bk.book_class?.class ?? null, script_family: bk.book_class?.script_family ?? null, provider: bk.image_source?.provider ?? null, pages_count: bk.pages_count ?? null, quality_score: bk.quality_score ?? null, visible: bk.visible ?? null, hidden: bk.hidden ?? null, text_role: bk.text_role ?? null, content_type: bk.content_type ?? null } }) + '\n');
}
await new Promise((r) => w.end(r));
await client.close();
console.log('wrote', path.join(dir, 'pages.jsonl'));
