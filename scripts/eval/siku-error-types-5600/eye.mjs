#!/usr/bin/env node
// PRIOR ART: scripts/eval/siku-error-types-5600/prep.mjs — packets for the judge; this prints a run of pages (OCR + stored English) and saves their images for a by-eye check.
/** #5600 by-eye helper, read only: node --env-file=… eye.mjs <book_id> <page> [page…] — images to $JOB_SCRATCH/eye. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
const [,, bookId, ...nums] = process.argv;
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const ps = await c.db('bookstore').collection('pages').find({ book_id: bookId, page_number: { $in: nums.map(Number) } }).sort({ page_number: 1 }).toArray();
for (const p of ps) {
  const f = `${process.env.JOB_SCRATCH}/eye/${bookId}-${p.page_number}.jpg`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, Buffer.from(await (await fetch(getPageSource(p))).arrayBuffer()));
  console.log(`===== p${p.page_number} ${p.id} img ${f} source=${p.translation?.source} edited=${!!p.translation?.edited_by}\n--- OCR\n${p.ocr?.data}\n--- EN\n${p.translation?.data}\n`);
}
await c.close();
