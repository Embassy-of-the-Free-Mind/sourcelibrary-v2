#!/usr/bin/env node
// PRIOR ART: scripts/eval/flash-reread-5924/fc-draw.mjs (reads stored ocr.data for a drawn page list; tied to its draw).
// fetch-stored.mjs — #7567: the STORED OCR of the panel's library pages (eebo-tcp-5488, latin-period-5126), read-only.
// It is the judge's "what readers get today" candidate and the bar a write-back must beat (Derek, inbox 2026-10-27T21:15Z).
//   node --env-file=<main checkout>/.env.production.local fetch-stored.mjs > $J/drafts/S.jsonl
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const panel = JSON.parse(fs.readFileSync(path.join(HERE, 'panel.json'), 'utf8')).pages.filter((p) => p.book_id && p.page_number != null);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const pages = c.db('bookstore').collection('pages');
for (const p of panel) {
  const doc = await pages.findOne({ book_id: p.book_id, page_number: Number(p.page_number) },
    { projection: { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, enhanced_photo: 1, photo_original: 1, 'ocr.data': 1, 'ocr.model': 1, 'ocr.updated_at': 1, 'ocr.edited_by': 1, 'ocr.source': 1, 'ocr.pipeline': 1, held: 1, withheld: 1 } });
  process.stdout.write(JSON.stringify({ page_id: p.slug, sl_page_id: doc?.id ?? null, text: doc?.ocr?.data ?? '', model: doc?.ocr?.model ?? null,
    updated_at: doc?.ocr?.updated_at ?? null, edited_by: doc?.ocr?.edited_by ?? null, source: doc?.ocr?.source ?? null, pipeline: doc?.ocr?.pipeline ?? null, served_image: doc ? getPageSource(doc) : null }) + '\n');
}
await c.close();
