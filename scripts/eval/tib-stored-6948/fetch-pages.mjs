#!/usr/bin/env node
// PRIOR ART: scripts/eval/tib-translator-6948/fetch-pages.mjs — the same rows (id, book_id, page_number, ocr, book), but
// that script refuses a page that has English; here the stored English IS the arm under test, so it is read verbatim
// from pages.translation.data, with its provenance (model, prompt, context flags, date).
/**
 * fetch-pages.mjs — read-only, $0. Reads $JOB_SCRATCH/sample.jsonl, writes $JOB_SCRATCH/sample-pages.jsonl in the shape
 * tib-translator-6948/requests.mjs reads, plus `stored_en` and `stored_meta`.
 *   node --env-file=… scripts/eval/tib-stored-6948/fetch-pages.mjs
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const S = process.env.JOB_SCRATCH;
const sample = fs.readFileSync(`${S}/sample.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const pages = await db.collection('pages').find({ id: { $in: sample.map((s) => s.page_id) } }, { projection: {
  _id: 0, id: 1, book_id: 1, page_number: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.pipeline': 1, 'ocr.updated_at': 1, translation: 1 } }).toArray();
const books = new Map((await db.collection('books').find({ id: { $in: [...new Set(pages.map((p) => p.book_id))] } },
  { projection: { _id: 0, id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1 } }).toArray()).map((b) => [b.id, b]));
const by = new Map(pages.map((p) => [p.id, p]));
const out = sample.map((s) => {
  const p = by.get(s.page_id);
  if (!p?.translation?.data) throw new Error(`${s.page_id}: no stored English now`);
  const t = p.translation, e = t.engine || {};
  return { id: p.id, book_id: p.book_id, page_number: p.page_number, ocr: p.ocr?.data || '', book: books.get(p.book_id),
    stored_en: t.data, stored_meta: { model: t.model, prompt_version: t.prompt_version, prompt_hash: t.prompt_hash, updated_at: t.updated_at,
      job: e.run?.job_id || null, api: e.api || null, context: e.input?.context || null, source_text_hash: e.input?.source_text_hash || null,
      ocr_updated_at: p.ocr?.updated_at || null } };
});
fs.writeFileSync(`${S}/sample-pages.jsonl`, out.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(out.length, 'pages');
await c.close();
