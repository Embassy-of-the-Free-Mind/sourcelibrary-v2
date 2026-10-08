#!/usr/bin/env node
// PRIOR ART: scripts/eval/lib/sampling.mjs sampleOnePagePerBook draws from a corpus registry, not a fixed book list, and gives one page with no fallback order; benchmark-seal.mjs seals OCR strata. Here the books are fixed by "a public English translation exists", and the alignment agent needs a seeded FALLBACK ORDER (the first page the reference covers), so the draw is not the agent's choice.
/** Seeded page order per book for the #5695 T1 reference set: eligible body pages (OCR ≥ 600 chars, served English ≥ 400), shuffled with mulberry32(5695 ^ hash(book_id)). Read-only. */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { makeRng } from '../lib/paired-stats.mjs';
const books = JSON.parse(fs.readFileSync(new URL('./books.json', import.meta.url)));
const OUT = process.argv[2] || 'draw.json';
const strip = (s) => (s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const h = (s) => [...s].reduce((a, ch) => (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0, 7);
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const out = {};
try {
  for (const [grp, ids] of Object.entries(books)) for (const id of ids) {
    const b = await db.collection('books').findOne({ id }, { projection: { title: 1, author: 1, year: 1, pages_count: 1, image_source: 1 } });
    const ps = await db.collection('pages').find({ book_id: id }, { projection: { page_number: 1, page_type: 1, 'ocr.data': 1, 'translation.data': 1 } }).toArray();
    const max = Math.max(...ps.map((p) => p.page_number));
    const elig = ps.filter((p) => strip(p.ocr?.data).length >= 600 && (p.translation?.data || '').length >= 400
      && p.page_number > 0.08 * max && p.page_number <= 0.95 * max && (!p.page_type || p.page_type === 'text')).map((p) => p.page_number).sort((a, b) => a - b);
    const rng = makeRng((5695 ^ h(id)) >>> 0);
    const order = [...elig]; for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    out[id] = { group: grp, title: b?.title, author: b?.author, year: b?.year, pages_count: b?.pages_count, scan_licence: b?.image_source?.license || null, scan_rights_class: b?.image_source?.rights_normalized?.class || null, scan_provider: b?.image_source?.provider_name || b?.image_source?.provider || null, n_eligible: elig.length, order };
    console.log(grp, id, b?.year, (b?.title || '').slice(0, 40), elig.length);
  }
} finally { await c.close(); }
fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
