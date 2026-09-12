#!/usr/bin/env node
/**
 * Mark BNCF Aldine second-copy imports as same-edition duplicates.
 *
 * Context: BNCF's Aldine collection on Internet Archive (`ita-bnc-ald`, 739
 * items) contains MULTIPLE PHYSICAL COPIES of the same printing — one IA item
 * per shelfmark. So "IA has 739 items, we hold 638" never meant 101 missing
 * editions; a large part of the residue is second copies of editions we
 * already hold. Manifestation-level dedup (`ia_identifier` /
 * `source_fingerprint`) cannot see this, because a second copy is a genuinely
 * different scan of a genuinely different physical object.
 *
 * The reliable test is bibliographic, not textual: two items are the same
 * edition when they share an EDIT16 CNC number, or an identical ISBD
 * fingerprint (which encodes characters at fixed signature positions and so
 * identifies a printing). Differing shelfmarks (Ald.3.2.20 vs Ald.3.2.19)
 * then just mean two copies on two shelves.
 *
 * This script applies verdicts reached that way. Pairs are passed in rather
 * than recomputed, so the bibliographic judgement stays reviewable.
 *
 * Follows the existing corpus convention: hidden + visible:false +
 * hidden_reason:'same_edition_duplicate' + duplicate_of:<kept book id>.
 * Nothing is deleted — the scan stays available as an other-copy rail.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/mark-bncf-aldine-copy-duplicates.mjs --dry-run
 *   node --env-file=.env.production.local scripts/maintenance/mark-bncf-aldine-copy-duplicates.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'bncf-aldine-copy-dedup-2026-08';

// [duplicate IA id, kept IA id, evidence]
const PAIRS = [
  ['ita-bnc-ald-00000775-001', 'ita-bnc-ald-00000774-001', 'EDIT16 CNC 36108 on both; identical fingerprint (Martialis, 1501)'],
  ['ita-bnc-ald-00000839-001', 'ita-bnc-ald-00000840-001', 'identical fingerprint (Pomponius Mela/Solinus, 1518)'],
  ['ita-bnc-ald-00000889-001', 'ita-bnc-ald-00000823-001', 'identical fingerprint (Odysseia, 1524)'],
  ['ita-bnc-ald-00000822-001', 'ita-bnc-ald-00000118-001', "identical fingerprint (Capella, L'anthropologia, 1533)"],
  ['ita-bnc-ald-00000391-001', 'ita-bnc-ald-00000962-001', 'identical fingerprint (Cicero, Officiorum libri tres, 1552)'],
  ['ita-bnc-ald-00000385-001', 'ita-bnc-ald-00000511-001', 'identical fingerprint (Caro, Gli straccioni, 1582)'],
];

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set — pass --env-file=.env.production.local');
  process.exit(1);
}

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

let marked = 0, skipped = 0, failed = 0;
for (const [dupIa, keptIa, evidence] of PAIRS) {
  const dup = await db.collection('books').findOne(
    { ia_identifier: dupIa },
    { projection: { id: 1, title: 1, hidden_reason: 1, visible: 1, pages_count: 1 } }
  );
  const kept = await db.collection('books').findOne(
    { ia_identifier: keptIa },
    { projection: { id: 1, title: 1, pages_count: 1 } }
  );

  if (!dup) { console.log(`  SKIP ${dupIa}: not in the library`); skipped++; continue; }
  if (!kept) { console.log(`  SKIP ${dupIa}: kept counterpart ${keptIa} not found — refusing to orphan the pointer`); skipped++; continue; }
  if (dup.hidden_reason === 'same_edition_duplicate') { console.log(`  SKIP ${dupIa}: already marked`); skipped++; continue; }

  console.log(`  ${APPLY ? 'MARK' : 'would mark'} ${dupIa} (${dup.pages_count}p) -> duplicate_of ${keptIa} (${kept.pages_count}p)`);
  console.log(`       ${evidence}`);
  if (!APPLY) continue;

  try {
    const res = await db.collection('books').updateOne(
      { _id: dup._id },
      {
        $set: {
          hidden: true,
          visible: false,
          hidden_reason: 'same_edition_duplicate',
          duplicate_of: kept.id || kept._id.toHexString(),
          updated_at: new Date(),
        },
      }
    );
    if (res.modifiedCount !== 1) { console.warn(`       WARN modifiedCount=${res.modifiedCount}`); failed++; continue; }
    await recordSweepAction(db, {
      sweep: SWEEP,
      book_id: dup.id || dup._id.toHexString(),
      action: 'marked-same-edition-duplicate',
      detail: { duplicate_of: kept.id, duplicate_ia: dupIa, kept_ia: keptIa, evidence },
    });
    marked++;
  } catch (err) {
    console.error(`       ERROR ${err.message}`);
    failed++;
  }
}

console.log(APPLY
  ? `\nMarked ${marked}, skipped ${skipped}, failed ${failed}.`
  : `\nDRY RUN — ${PAIRS.length - skipped} would be marked. Re-run with --apply.`);

await client.close();
