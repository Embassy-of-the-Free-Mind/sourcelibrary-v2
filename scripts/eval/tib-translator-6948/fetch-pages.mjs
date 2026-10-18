#!/usr/bin/env node
// PRIOR ART: scripts/eval/tengyur-ref/dump-pages.mjs dumps whole Derge volumes (text + folio) for #5497; this reads only
// the listed pages of #6948's sample, with the fields the arms, the reference cut and the judge packet need.
/**
 * fetch-pages.mjs — read-only, $0.
 *   node --env-file=… fetch-pages.mjs <ids.jsonl> <out.jsonl> [--full]
 * ids.jsonl rows carry page_id. Writes {id, book_id, page_number, ocr} per page; with --full also the book record
 * (units.mjs's projection), the text edition (Derge folio, Toh), ocr model/pipeline, translation_withheld, and the
 * withheld English from page_revisions (field translation, reason withhold-stale-translation-4523, latest row).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { WITHHOLD_REVISION_SOURCE } from '../../lib/stale-translation.mjs';

const [inp, outp] = process.argv.slice(2);
const FULL = process.argv.includes('--full');
const ids = fs.readFileSync(inp, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).page_id);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const out = [];
for (let i = 0; i < ids.length; i += 200) {
  const pages = await db.collection('pages').find({ id: { $in: ids.slice(i, i + 200) } }, { projection: {
    _id: 0, id: 1, book_id: 1, page_number: 1, page_label: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.text_edition': 1,
    translation_withheld: 1, 'translation.data': 1, archived_photo: 1, display_photo: 1 } }).toArray();
  for (const p of pages) {
    if (p.translation?.data) throw new Error(`${p.id} has English now: not a frame page`);
    const r = { id: p.id, book_id: p.book_id, page_number: p.page_number, ocr: p.ocr?.data || '' };
    if (FULL) Object.assign(r, { page_label: p.page_label || null, ocr_model: p.ocr?.model, ocr_pipeline: p.ocr?.pipeline || null,
      text_edition: p.ocr?.text_edition || null, withheld: p.translation_withheld || null, image: p.archived_photo || p.display_photo || null });
    out.push(r);
  }
}
if (FULL) {
  const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(out.map((r) => r.book_id))] } },
    { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
  for (const r of out) {
    r.book = books.get(r.book_id);
    if (!r.withheld) continue;
    const rev = await db.collection('page_revisions').find({ page_id: r.id, field: 'translation', reason: WITHHOLD_REVISION_SOURCE })
      .sort({ created_at: -1 }).limit(1).toArray();
    r.prod_en = rev[0]?.data || null;
    r.prod_meta = rev[0] ? { model: rev[0].model, prompt_version: rev[0].prompt_version, original_date: rev[0].original_date, content_hash: rev[0].content_hash } : null;
  }
}
fs.writeFileSync(outp, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(out.length, 'pages of', ids.length);
await c.close();
