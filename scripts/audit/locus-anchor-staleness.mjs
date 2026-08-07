#!/usr/bin/env node
/**
 * Are the canonical locus anchors still true of the pages they were read from?
 *
 *   node scripts/audit/locus-anchor-staleness.mjs
 *
 * ## Why this exists before anyone asked for it
 *
 * `locus_anchors` is a store derived from `pages.ocr`, written by a script that
 * nothing schedules. That is precisely the shape that went dark for 60 days in
 * the page-embedding outage: a derived artifact with one writer outside the
 * pipeline, whose absence is indistinguishable from an empty answer
 * (`.claude/docs/invariants/derived-stores-and-schedules.md`, #3692).
 *
 * A stale locus anchor is worse than a missing one. Re-OCR can move the text on a
 * leaf, and an anchor still pointing there would produce a confident citation to
 * the wrong lines — the failure `entity-page-attribution.md` exists to prevent.
 *
 * ## What it checks, and why not `updated_at`
 *
 * Coverage against the Mongo denominator, plus a diff of the SOURCE's own OCR
 * timestamp against the one recorded at extraction. The lesson from that outage
 * was that a derived store's own `updated_at` lies in both directions; the signal
 * that would have fired on day one is coverage against the source.
 *
 * Exit 1 if any registered edition is unpublished or stale, so this can gate.
 */
import { MongoClient } from 'mongodb';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { LOCUS_EDITIONS } = await import(join(ROOT, 'src', 'lib', 'locus-editions.ts'));

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

let problems = 0;

// Is this collection even OURS?
//
// On 2026-08-07 a second session implemented #3661 in parallel and wrote the
// same collection name with a different schema (`page`/`scan_page`/`locus`
// instead of `ref_page`/`page_number`/`ref_label`), replacing 6,324 rows with
// 4,279. The API queries `ref_page`, matched nothing, and every reference on
// production returned `witness_count: 0` with an honest "no witness holds an
// anchor at this reference" — indistinguishable from a genuine gap in the
// corpus. A row count alone would have passed: the foreign rows carry
// `book_id` too.
//
// So check the SHAPE, not just the count. This is the read-side lesson from the
// embedding outage applied one layer down (derived-stores-and-schedules.md): an
// empty answer and an unreadable store look identical from outside.
const total = await db.collection('locus_anchors').countDocuments({});
const mine = await db.collection('locus_anchors').countDocuments({ ref_page: { $exists: true } });
if (total && mine !== total) {
  problems++;
  console.log(`\n✗ FOREIGN SCHEMA in locus_anchors: ${total - mine} of ${total} rows carry no ref_page.`);
  console.log(`    Something else is writing this collection. /api/locus queries ref_page and will`);
  console.log(`    return "no witness" for every reference — silently, as a data gap.`);
  const stray = await db.collection('locus_anchors').findOne({ ref_page: { $exists: false } }, { projection: { _id: 0 } });
  console.log(`    example row: ${JSON.stringify(stray).slice(0, 200)}`);
}

console.log(`\n${LOCUS_EDITIONS.length} registered editions\n${'-'.repeat(72)}`);

for (const ed of LOCUS_EDITIONS) {
  const state = await db.collection('locus_books').findOne({ book_id: ed.book_id });
  const anchors = await db.collection('locus_anchors').countDocuments({ book_id: ed.book_id });

  if (!state || !anchors) {
    problems++;
    console.log(`✗ NOT PUBLISHED  ${ed.book_id}  ${ed.label}`);
    console.log(`    run: npx tsx scripts/locus/extract-locus-anchors.mjs --book=${ed.book_id} --apply`);
    continue;
  }

  // The newest OCR timestamp on the book NOW, against the one seen at extraction.
  const newest = await db.collection('pages')
    .find({ book_id: ed.book_id, 'ocr.updated_at': { $exists: true } }, { projection: { 'ocr.updated_at': 1 } })
    .sort({ 'ocr.updated_at': -1 }).limit(1).toArray();
  const nowMax = newest[0]?.ocr?.updated_at ?? null;
  const thenMax = state.ocr_updated_max ?? null;
  const stale = nowMax && thenMax && nowMax > thenMax;

  const min = ed.expect?.min_anchors;
  const thin = min && anchors < min;

  if (stale || thin) problems++;
  console.log(
    `${stale || thin ? '✗' : '✓'} ${String(anchors).padStart(5)} anchors  ` +
    `ref ${state.ref_min}–${state.ref_max}  ${ed.label}`,
  );
  if (stale) {
    console.log(`    STALE: pages re-OCR'd ${nowMax.toISOString?.() ?? nowMax} after extraction at ${thenMax.toISOString?.() ?? thenMax}`);
    console.log(`    Anchors may point at text that has moved. Re-extract before trusting them.`);
  }
  if (thin) console.log(`    THIN: below the reviewed floor of ${min}`);
}

// Anchors whose edition is no longer registered — a row nothing would refresh.
const registered = new Set(LOCUS_EDITIONS.map((e) => e.book_id));
const orphanIds = (await db.collection('locus_anchors').distinct('book_id')).filter((id) => !registered.has(id));
if (orphanIds.length) {
  problems++;
  console.log(`\n✗ ${orphanIds.length} book(s) hold anchors but are no longer registered:`);
  for (const id of orphanIds) console.log(`    ${id}  — delete the rows or re-register the edition`);
}

console.log(`\n${problems ? `${problems} problem(s)` : 'all registered editions published and current'}`);
await client.close();
process.exit(problems ? 1 : 0);
