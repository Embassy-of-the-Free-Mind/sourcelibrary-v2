#!/usr/bin/env node
// PRIOR ART: scripts/import/jcb-1600/nw-terms.mjs (terms), fetch-ia-text.mjs (input). No existing
// content screen over third-party OCR in scripts/{analysis,eval,import}. #8049, Derek 2026-11-04.
//
// Runs the New World terms over each campaign book's locator text (IA hOCR, mapped to our page order
// by fetch-ia-text.mjs) and writes:
//   OUT/hits.jsonl   one row per hit page: { book_id, ia, page_id, page_number, idx, strong, hits }
//   OUT/books.jsonl  one row per book: { book_id, ia, language, pages, status, strong_pages, weak_pages,
//                    families, density }
// Text is LOCATOR ONLY: hits name pages to read; nothing here is written to a page or a book.
//
// node --env-file=... scripts/import/jcb-1600/screen.mjs --text-dir $S/s5/iatext --out $S/s5/screen
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { pageHits, isStrong, normNW } from './nw-terms.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dir = arg('--text-dir'); const out = arg('--out');
// --lexicon: JSON array of words (normNW spelling) seen in >=3 held books' stored OCR. The share of a
// book's locator-text words found in it measures how readable that text is: on the 69 held controls,
// books under ~0.70 had page recall from 0 to 0.67 (Columbus 1493: 0.42 share, 0/5 pages found).
const lex = arg('--lexicon') ? new Set(JSON.parse(fs.readFileSync(arg('--lexicon'), 'utf8'))) : null;
function lexShare(pages) {
  let tot = 0, inl = 0;
  for (const t of pages) for (const w of normNW(t).match(/[a-z]+/g) || []) { if (w.length < 3) continue; tot++; if (lex.has(w)) inl++; }
  return tot ? +(inl / tot).toFixed(3) : 0;
}
fs.mkdirSync(out, { recursive: true });
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db(process.env.MONGODB_DB || 'bookstore');
const hitsF = fs.createWriteStream(path.join(out, 'hits.jsonl'));
const booksF = fs.createWriteStream(path.join(out, 'books.jsonl'));
for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json')).sort()) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const row = { book_id: r.book_id, ia: r.ia, language: r.language, pages: r.n_ours, status: r.status };
  if (r.status === 'ok') {
    const pages = await db.collection('pages').find({ book_id: r.book_id }, { projection: { id: 1, page_number: 1 } })
      .sort({ page_number: 1 }).toArray();
    if (pages.length !== r.pages.length) { row.status = 'mismatch-db'; }
    else {
      let strong = 0, weak = 0; const fam = {};
      r.pages.forEach((t, i) => {
        const h = pageHits(t); if (!h) return;
        const s = isStrong(h); s ? strong++ : weak++;
        for (const k in h) fam[k] = (fam[k] || 0) + 1;
        hitsF.write(JSON.stringify({ book_id: r.book_id, ia: r.ia, page_id: pages[i].id || String(pages[i]._id), page_number: pages[i].page_number, idx: i, strong: s, hits: h }) + '\n');
      });
      // Empty locator text is its own signal: a scan IA could not read gives no hits whatever it says.
      const empty = r.pages.filter(t => t.replace(/\s/g, '').length < 40).length;
      Object.assign(row, { lex_share: lex ? lexShare(r.pages) : null, strong_pages: strong, weak_pages: weak, families: fam, density: +(strong / r.pages.length).toFixed(4), empty_pages: empty });
    }
  }
  booksF.write(JSON.stringify(row) + '\n');
}
hitsF.end(); booksF.end();
await c.close();
