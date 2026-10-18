#!/usr/bin/env node
/**
 * PRIOR ART: /mnt/.../jobs/mongol-argon-5664/fetch.mjs (same lookup for the 10 probe pages, scratch only, not
 * committed); scripts/lib/page-image-url.mjs getPageSource (used).
 *
 * Mongolian Kanjur page fetch for the frozen evaluation (#5664). Reads Mongo (books, pages) ONLY; writes nothing to
 * Mongo. Input: a JSON list of {key, vol, folio, side}; it finds the book by catalog_ids.bdrc_volume (campaign
 * mongol-5664), the page by its stored label "f. <folio><side>", and saves the archived image.
 *
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/mongol-synth-5664/fetch-pages.mjs want.json outdir > found.json
 */
import fs from 'fs';
import path from 'path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const [wantPath, outDir] = process.argv.slice(2);
const want = JSON.parse(fs.readFileSync(wantPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const out = [];
for (const w of want) {
  const book = await db.collection('books').findOne({ acquisition_campaign: 'mongol-5664', 'catalog_ids.bdrc_volume': w.vol }, { projection: { id: 1, title: 1 } });
  if (!book) { out.push({ ...w, error: 'no book' }); continue; }
  const label = `f. ${w.folio}${w.side}`;
  const pg = await db.collection('pages').findOne({ book_id: book.id, page_label: label }, { projection: { page_number: 1, page_label: 1, archived_photo: 1, photo: 1, photo_original: 1, crop: 1, book_id: 1 } });
  if (!pg) { out.push({ ...w, book_id: book.id, error: `no page ${label}` }); continue; }
  const src = getPageSource(pg);
  // the file name carries the leaf, so a re-selection can never reuse another leaf's cached image
  const file = path.join(outDir, `${w.key}_v${w.vol}_${w.folio}${w.side}.jpg`);
  if (!fs.existsSync(file)) {
    const r = await fetch(src);
    if (!r.ok) { out.push({ ...w, book_id: book.id, page_number: pg.page_number, error: `fetch ${r.status}` }); continue; }
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  }
  out.push({ ...w, book_id: book.id, page_number: pg.page_number, page_label: pg.page_label, image: file, src });
  process.stderr.write(`${w.key} ${label} p${pg.page_number}\n`);
}
await c.close();
console.log(JSON.stringify(out, null, 1));
