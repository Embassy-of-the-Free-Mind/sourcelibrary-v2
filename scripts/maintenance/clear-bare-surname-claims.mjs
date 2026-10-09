#!/usr/bin/env node
// PRIOR ART: scripts/audit/shared-surname-reattribution-plan.mjs — moves a bare record's MENTIONS
// to the right person; it never touches the record's own claim. scripts/enrichment/wikidata-align.mjs
// and scripts/maintenance/backfill-wikidata-portraits-dates.mjs — they SET these fields; neither
// removes one. scripts/enrichment/merge-qid-duplicates.mjs — merges records that are one person.
/**
 * Clear the one-person claim on a bare-surname person record (#5950, repair A).
 *
 * "Montanus" carried the id, dates and description of the physician Giovanni Battista da Monte
 * while 0 of 10 sampled mentions were him (#5972). The record is a name several people share; it
 * must not present one of them. This unsets the person-specific fields and leaves `books[]`, the
 * counters and the name alone.
 *
 * Only the records in APPROVED are touched, and only while each still carries the Wikidata id it
 * was approved with (Derek, #5950, 2026-10-06). Add a surname here only after its mentions were
 * read by eye.
 *
 * Reader-visible effect: with no id and no description the record leaves the published tier
 * (src/lib/entity-publish.ts): its page still renders, is noindexed, and book indexes stop
 * linking to it. The daily `enrich-entities` cron reads only records WITH an id, so it does not
 * put the claim back.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/clear-bare-surname-claims.mjs            dry run
 *   … --apply --undo-out undo.json      write; the removed values go to the undo file first
 *   … --undo undo.json                  put them back (only fields that are still absent)
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import { EJSON } from 'bson';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const SWEEP = 'clear-bare-surname-claims-5950';

/** surname → the Wikidata id the bare record carried when its mentions were read. */
export const APPROVED = {
  Montanus: 'Q1697209', // Giovanni Battista da Monte; 0 of 10 sampled mentions
  Bruno: 'Q36330',      // Giordano Bruno; 1 of 10
  Fabricius: 'Q60204',  // David Fabricius; 1 of 10
  Agrippa: 'Q76568',    // Heinrich Cornelius Agrippa; 2 of 10
};

/** Fields that say WHO the record is. `name`, `type`, `books`, counters and timestamps stay. */
export const CLAIM_FIELDS = [
  'wikidata_id', 'wikidata_birth_date', 'wikidata_death_date', 'wikidata_coordinates', 'wikidata_enriched_at',
  'portrait_url', 'description', 'wikipedia_url', 'birth_place', 'death_place', 'work_places',
  'aliases', 'canonical_name', 'gnd_id', 'viaf_id', 'lcnaf_id',
];

/** The claim fields a record carries, as { field: value }. Pure. */
export function claimOf(doc) {
  return Object.fromEntries(CLAIM_FIELDS.filter(f => doc?.[f] !== undefined).map(f => [f, doc[f]]));
}

const arg = (flag) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : null; };
const toId = (s) => (ObjectId.isValid(s) ? new ObjectId(s) : s);

function interlockClear() {
  const script = fileURLToPath(new URL('../audit/entities-sweep-active.mjs', import.meta.url));
  return spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env }).status === 0;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const undoOut = arg('--undo-out');
  const undoFile = arg('--undo');
  if (apply && !undoOut) { console.error('--apply needs --undo-out <file>'); process.exit(2); }
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('Missing MONGODB_URI.'); process.exit(2); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB || 'bookstore');
    const entities = db.collection('entities');

    if (undoFile) {
      if (!interlockClear()) throw new Error('entities interlock is not clear (exit != 0): nothing written');
      const saved = EJSON.parse(fs.readFileSync(undoFile, 'utf8'));
      for (const d of saved.docs) {
        const cur = await entities.findOne({ _id: { $in: [toId(d._id), d._id] } });
        // Only fields that are still absent: a value written since the clear is newer than ours.
        const back = Object.fromEntries(Object.entries(d.removed).filter(([f]) => cur && cur[f] === undefined));
        if (cur && Object.keys(back).length > 0) await entities.updateOne({ _id: cur._id }, { $set: { ...back, updated_at: new Date() } });
        console.log(`${d.name}: restored ${Object.keys(back).join(', ') || 'nothing'}`);
      }
      return;
    }

    const plan = [];
    for (const [surname, qid] of Object.entries(APPROVED)) {
      const doc = await entities.findOne({ name: surname, type: 'person' });
      if (!doc) { console.log(`${surname}: no person record`); continue; }
      if (doc.wikidata_id !== qid) { console.log(`${surname}: carries ${doc.wikidata_id ?? 'no id'}, not the approved ${qid}: left alone`); continue; }
      const removed = claimOf(doc);
      plan.push({ doc, removed });
      console.log(`${surname} (${doc._id}, ${doc.book_count} books): clears ${Object.keys(removed).join(', ')}`);
    }
    if (!apply) { console.log('DRY RUN: nothing was written.'); return; }

    fs.writeFileSync(undoOut, EJSON.stringify({
      sweep: SWEEP, applied_at: new Date(),
      docs: plan.map(p => ({ _id: String(p.doc._id), name: p.doc.name, removed: p.removed })),
    }, null, 1) + '\n');
    console.log(`undo file: ${undoOut}`);
    if (!interlockClear()) throw new Error('entities interlock is not clear (exit != 0): nothing written');

    for (const { doc, removed } of plan) {
      const res = await entities.updateOne(
        { _id: doc._id, wikidata_id: APPROVED[doc.name] },
        { $unset: Object.fromEntries(Object.keys(removed).map(f => [f, ''])), $set: { updated_at: new Date() } },
      );
      if (res.modifiedCount !== 1) { console.log(`${doc.name}: NOT written (changed since it was read)`); continue; }
      await recordSweepAction(db, {
        sweep: SWEEP, book_id: `entity:${doc._id}`, action: 'entity-claim-cleared',
        detail: { name: doc.name, wikidata_id: removed.wikidata_id, fields: Object.keys(removed), undo_file: undoOut },
      });
      console.log(`${doc.name}: cleared ${Object.keys(removed).length} fields`);
    }
  } finally {
    await client.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
