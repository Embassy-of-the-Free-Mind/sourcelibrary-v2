#!/usr/bin/env node
/**
 * Write `contains_works` for multi-work volumes, derived from their own running
 * heads.
 *
 *   node scripts/maintenance/derive-contains-works-sweep.mjs            # dry run
 *   node scripts/maintenance/derive-contains-works-sweep.mjs --apply
 *   node scripts/maintenance/derive-contains-works-sweep.mjs --all      # not just containers
 *
 * ## Why
 *
 * "Which book has the Poetics?" was unanswerable from metadata (#3652 A,
 * #3653 items 1-2): four Aristotle volumes advertised works their scans do not
 * contain, and the volume that DOES hold the Poetics said nothing about it.
 * The running head is the one place a book states, on every leaf, which work
 * you are inside.
 *
 * ## Scope, and why it is not the whole corpus
 *
 * Measured 2026-08-07: 17,153 live OCR'd books, of which 2,090 are
 * container-titled (Opera / Works / Vol. / Sämtliche…). Roughly 30% of those
 * carry enough running heads to be judged. The rest are not failures — many
 * books simply have no running heads, and a volume that never had them cannot
 * be assessed this way.
 *
 * That distinction is recorded rather than left implicit: a book examined and
 * found unjudgeable gets `contains_works.status = 'insufficient-heads'`, so a
 * later reader can tell "we looked and could not tell" from "nobody looked".
 * An absence with no record is indistinguishable from an absence of evidence.
 *
 * ## What is stored
 *
 * Head strings with page spans — the EVIDENCE — not resolved work identities.
 * Mapping ΤΩΝ ΜΕΤΑ ΤΑ ΦΥΣΙΚΑ to a canonical work id is #3661 and needs a
 * different kind of care. Publishing the evidence is honest and useful now;
 * publishing a guessed identification would be neither.
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { deriveContainedWorks } = await import(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'lib', 'contains-works.ts')
);

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const LIMIT = Number((process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

const CONTAINER = /\bopera\b|\bworks\b|complete|s[äa]mtliche|oeuvres|collected|\bvol\b|volume|tome|opuscula|omnia/i;
const NOW = new Date();

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const c = new MongoClient(uri); await c.connect();
const db = c.db('bookstore');

// pages_ocr, not pages_count: a book with page images and no OCR has no heads
// to read, and including those made an earlier scoping run report 0% judgeable
// when it was really measuring unprocessed books.
const query = { visible: true, pages_ocr: { $gt: 20 }, ...(ALL ? {} : { title: CONTAINER }) };
const cursor = db.collection('books').find(query, { projection: { id: 1, title: 1, author: 1, pages_count: 1 } });

let seen = 0, derived = 0, insufficient = 0, multi = 0, written = 0;
const started = Date.now();
for await (const b of cursor) {
  if (LIMIT && seen >= LIMIT) break;
  seen++;
  const pages = await db.collection('pages')
    .find({ book_id: b.id }, { projection: { page_number: 1, 'ocr.data': 1 } })
    .sort({ page_number: 1 }).toArray();

  const headers = [];
  let ocrPages = 0;
  for (const p of pages) {
    const d = p.ocr?.data || '';
    if (d.length > 100) ocrPages++;
    const h = d.match(/<header>\s*([^<]{0,80}?)\s*<\/header>/)?.[1];
    if (h) headers.push([p.page_number, h.trim()]);
  }

  let doc;
  if (headers.length < 20 || !ocrPages || headers.length < ocrPages * 0.3) {
    insufficient++;
    doc = {
      status: 'insufficient-heads',
      headed_pages: headers.length,
      ocr_pages: ocrPages,
      method: 'running-head grouping (src/lib/contains-works.ts)',
      derived_at: NOW,
    };
  } else {
    const works = deriveContainedWorks(headers, { author: b.author || '' });
    derived++;
    if (works.length > 1) multi++;
    doc = {
      status: 'derived',
      works: works.map((w) => ({
        header: w.header, first_page: w.first_page, last_page: w.last_page,
        page_count: w.page_count, density: w.density,
      })),
      headed_pages: headers.length,
      ocr_pages: ocrPages,
      method: 'running-head grouping (src/lib/contains-works.ts)',
      note: 'Head strings with page spans — evidence of what the volume contains, not resolved work identities (#3661).',
      derived_at: NOW,
    };
  }

  if (APPLY) {
    const r = await db.collection('books').updateOne({ id: b.id }, { $set: { contains_works: doc, updated_at: NOW } });
    written += r.modifiedCount;
  }
  if (seen % 100 === 0) {
    const rate = (Date.now() - started) / seen;
    console.log(`  ${seen} seen · ${derived} derived · ${insufficient} unjudgeable · ~${Math.round((rate * seen) / 1000)}s elapsed`);
  }
}

console.log(`\n${seen} books examined`);
console.log(`  derived contents      : ${derived}`);
console.log(`  of those, MULTI-work  : ${multi}`);
console.log(`  examined, unjudgeable : ${insufficient}  (recorded as such — "we looked and could not tell")`);
console.log(APPLY ? `  written               : ${written}` : '\nDRY RUN — nothing written. Pass --apply.');
await c.close();
