#!/usr/bin/env node
// PRIOR ART: draw.mjs (this directory; reads the same pages read-only). Nothing here read a page's STORED OCR as an eval
// arm: the 7243 Flash arm was agy only. The confirmation brief (CONFIRM.md) defines F as the stored Flash read where
// there is one, else agy Flash; this exports the stored reads. Read-only: nothing is written to Mongo.
/**
 *   node --env-file=.env.production.local confirm-stored.mjs <pages-confirm.json> <out dir>
 * Writes <out>/stored.jsonl: {page_id: slug, text, model, source, updated_at} for every test page with stored OCR text
 * (any model; the arm builder decides which models count as Flash).
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';

const [pagesFile, outDir] = process.argv.slice(2);
const pages = JSON.parse(fs.readFileSync(pagesFile, 'utf8')).pages;
const c = await MongoClient.connect(process.env.MONGODB_URI);
const col = c.db('bookstore').collection('pages');
const rows = [];
for (const p of pages) {
  const r = await col.findOne({ id: p.page_id }, { projection: { ocr: 1 } });
  const o = r?.ocr;
  if (o?.data?.trim()) rows.push({ page_id: p.slug, text: o.data, model: o.model ?? null, source: o.source ?? null, updated_at: o.updated_at ?? null });
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'stored.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(`${rows.length} of ${pages.length} pages have stored OCR:`, Object.entries(rows.reduce((m, x) => ({ ...m, [x.model]: (m[x.model] || 0) + 1 }), {})));
await c.close();
