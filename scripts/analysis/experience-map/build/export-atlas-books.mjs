#!/usr/bin/env node
/**
 * Export the books behind the aliveness atlas (#6652) for dating: catalogue fields from Mongo (READ-ONLY), any existing
 * source_work_dates with its run metadata, and the first title-page-like leaves from the local mirror (~/sl-corpus), so a
 * dater can read the imprint. Writes <data-dir>/atlas-books.jsonl. No writes to Mongo.
 * PRIOR ART: scripts/_archived/2026-09-unmetered/enrichment/enrich-source-work-dates.mjs — same inputs (title, author,
 * published, language, early OCR); it does not fit because it reads and writes Mongo in one pass on the paid API.
 *   node --env-file=<main>/.env.production.local build/export-atlas-books.mjs <data-dir>
 */
import fs from 'node:fs'; import path from 'node:path'; import { createRequire } from 'node:module';
const D = process.argv[2]; if (!D) { console.error('usage: export-atlas-books.mjs <data-dir>'); process.exit(2); }
const { MongoClient } = createRequire(path.join(process.env.HOME, 'sourcelibrary', 'package.json'))('mongodb');
const CORPUS = process.env.SL_CORPUS || path.join(process.env.HOME, 'sl-corpus');

const P = JSON.parse(fs.readFileSync(path.join(D, 'aliveness-data.json'), 'utf8'));
const ids = [...new Set(P.map((p) => (p.u.match(/book\/([^?]+)/) || [])[1]).filter(Boolean))];
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const docs = await c.db(process.env.MONGODB_DB || 'bookstore').collection('books').find(
  { $or: [{ id: { $in: ids } }, { _id: { $in: ids } }] },
  { projection: { id: 1, title: 1, display_title: 1, author: 1, published: 1, language: 1, categories: 1, source_work_dates: 1, source_work_dates_meta: 1 } }).toArray();
await c.close();

// the first leaves that carry text, up to ~2,500 characters of OCR: title pages, imprints, prefaces
const strip = (s) => (s || '').replace(/<image-desc>[\s\S]*?<\/image-desc>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const out = fs.createWriteStream(path.join(D, 'atlas-books.jsonl')); let withText = 0;
for (const d of docs) {
  const id = d.id || String(d._id); let lead = '';
  const f = path.join(CORPUS, 'books', `${id}.jsonl`);
  if (fs.existsSync(f)) {
    const pages = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).sort((a, b) => a.p - b.p);
    for (const pg of pages) { const t = strip(pg.ocr); if (t.length > 40) lead += `[page ${pg.p}] ${t.slice(0, 900)}\n`; if (lead.length > 2500) break; }
  }
  if (lead) withText++;
  out.write(JSON.stringify({ book_id: id, title: d.display_title || d.title, original_title: d.title, author: d.author, published: d.published ?? null,
    language: d.language, categories: d.categories || [], prior_layers: d.source_work_dates ?? null, prior_meta: d.source_work_dates_meta ?? null, lead: lead.slice(0, 2600) }) + '\n');
}
out.end();
console.log(`${ids.length} atlas books, ${docs.length} found in Mongo, ${withText} with opening text → atlas-books.jsonl`);
