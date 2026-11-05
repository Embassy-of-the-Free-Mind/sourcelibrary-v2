#!/usr/bin/env node
// PRIOR ART: scripts/import/jcb-1600/nw-terms.mjs (the screen) — this is its recall control. Runs the
// same New World terms over OUR stored OCR (pages.ocr.data) for held pre-1600 books that came from
// the Archive, so the Archive's own hOCR of the same scan can be scored against it (#8049).
// node --env-file=... control-truth.mjs --books held.json --out DIR
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { pageHits, isStrong } from './nw-terms.mjs';
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const books = JSON.parse(fs.readFileSync(arg('--books'), 'utf8'));
const out = arg('--out'); fs.mkdirSync(out, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
for (const b of books) {
  const f = path.join(out, `${b.ia_identifier}.truth.json`);
  if (fs.existsSync(f)) continue;
  const pages = await db.collection('pages').find({ book_id: b.id }, { projection: { page_number: 1, 'ocr.data': 1 } }).sort({ page_number: 1 }).toArray();
  // Full text kept (scratch only) so the scorer can re-run the terms as they are tuned.
  const rows = pages.map(p => ({ n: p.page_number, text: p.ocr?.data || '', hits: pageHits(p.ocr?.data || '') }));
  const strong = rows.filter(r => isStrong(r.hits)).length;
  fs.writeFileSync(f, JSON.stringify({ ...b, rows }));
  console.log(b.ia_identifier, b.language, rows.length, 'strong pages', strong);
}
await c.close();
