#!/usr/bin/env node
/**
 * PRIOR ART: scripts/audit/detect-fabricated-translation.mjs (#4584, non-Latin bracket-placeholder
 * class) and scripts/audit/detect-fabricated-ocr.mjs (#4149, blank-leaf class from the image).
 * Neither sees fluent modern English on a page with a real transcription; this does. The predicate
 * lives in scripts/lib/modern-intrusion.mjs so the DOI mint paths gate on the same one.
 *
 * detect-modern-intrusion — standing screen for text that cannot belong to a book of its date
 * (#4960: a 2011 nephrology TOC as the English of Kircher's 1657 Iter extaticum II, p.170,
 * quality_score 100, one deposit from a permanent DOI).
 *
 * A WORK LIST, never an authority: read every hit before acting. A confirmed page is contained by
 * `containment-on-finding.md` (hold the book, withhold the page, label the issue `contained`).
 *
 * Scope by default: the DOI-eligible pool (`batch-mint-doi.mjs`'s filter, without its translated-%
 * test) — the books a permanent act is about to be taken on. `--all-visible` widens it.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/detect-modern-intrusion.mjs                      # DOI-eligible pool, top 500 by quality
 *   node scripts/audit/detect-modern-intrusion.mjs --limit 5000
 *   node scripts/audit/detect-modern-intrusion.mjs --book-id <id>
 *   node scripts/audit/detect-modern-intrusion.mjs --json out.jsonl     # one line per hit page
 * Exit 0 = clean, 1 = hits, 2 = the live positive control did not behave (do not trust the run).
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { findModernIntrusions, screenBookPages, bookYear } from '../lib/modern-intrusion.mjs';

const args = process.argv.slice(2);
const getArg = (f, d = null) => { const i = args.indexOf(f); return i >= 0 && i + 1 < args.length ? args[i + 1] : d; };
const BOOK_ID = getArg('--book-id');
const LIMIT = parseInt(getArg('--limit', '500'), 10);
const MIN_QUALITY = parseInt(getArg('--min-quality', '50'), 10);
const JSON_OUT = getArg('--json');
const ALL_VISIBLE = args.includes('--all-visible');

// The page the screen exists for. Once it is repaired its English will be clean and the check
// reports that instead of failing; the durable control is the fixture in
// tests/unit/modern-intrusion.test.ts.
const CONTROL = { book_id: '69520543ab34727b1f042975', page_number: 170, year: 1657 };

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

let controlOk = true;
const ctl = await db.collection('pages').findOne({ book_id: CONTROL.book_id, page_number: CONTROL.page_number }, { projection: { 'translation.data': 1 } });
const ctlText = ctl?.translation?.data || '';
if (/Nephrology/.test(ctlText)) {
  const fires = findModernIntrusions(ctlText, CONTROL.year).length > 0;
  console.log(`CONTROL Kircher p.${CONTROL.page_number} (stored JASN text): ${fires ? 'fires ✓' : 'MISSES ✗'}`);
  controlOk = fires;
} else {
  console.log(`CONTROL Kircher p.${CONTROL.page_number}: stored English no longer carries the JASN text (repaired or withheld) — fixture test is the control.`);
}
if (!controlOk) { console.error('\nCONTROL FAILED — aborting; the predicate no longer sees the case it was built for.'); await client.close(); process.exit(2); }

const match = BOOK_ID ? { id: BOOK_ID } : ALL_VISIBLE
  ? { hidden: { $ne: true }, pages_translated: { $gt: 0 } }
  : { hidden: { $ne: true }, pages_ocr: { $gt: 0 }, quality_score: { $gte: MIN_QUALITY }, doi: { $exists: false } };
const books = await db.collection('books')
  .find(match, { projection: { id: 1, title: 1, display_title: 1, published: 1, quality_score: 1 } })
  .sort({ quality_score: -1 }).limit(BOOK_ID ? 1 : LIMIT).toArray();

const out = JSON_OUT ? fs.createWriteStream(JSON_OUT) : null;
let hitBooks = 0, hitPages = 0, scannedPages = 0;
for (const b of books) {
  const pages = await db.collection('pages')
    .find({ book_id: b.id, 'translation.data': { $exists: true, $ne: '' } }, { projection: { page_number: 1, 'translation.data': 1 } })
    .sort({ page_number: 1 }).toArray();
  scannedPages += pages.length;
  const flagged = screenBookPages(b, pages);
  if (!flagged.length) continue;
  hitBooks++; hitPages += flagged.length;
  console.log(`\n${b.id}  q${b.quality_score ?? '—'}  [${bookYear(b.published) ?? '?'}]  ${(b.display_title || b.title || '').slice(0, 70)}`);
  for (const f of flagged) {
    console.log(`  p.${f.page_number}: ${f.hits.map((h) => h.marker).join(', ')}  ::  ${f.hits[0].context.slice(0, 200)}`);
    out?.write(JSON.stringify({ book_id: b.id, title: b.title, published: b.published, quality_score: b.quality_score, ...f }) + '\n');
  }
}
out?.end();
console.log(`\nScanned ${books.length} books / ${scannedPages} translated pages: ${hitPages} page(s) in ${hitBooks} book(s) flagged. Read each before acting.`);
await client.close();
process.exit(hitPages ? 1 : 0);
