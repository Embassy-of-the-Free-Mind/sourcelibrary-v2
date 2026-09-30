#!/usr/bin/env node
// Backfill `books.publication` from today's legacy fields (#5340, decision 1 of
// .claude/docs/publication-state.md).
//
// PRIOR ART: scripts/lib/publication.mjs — legacyPublication() is the rule this applies,
// the same function the writer uses to read a book's current state; nothing else
// derives a state from `visible`/`hidden`/`hidden_reason`.
//
// Writes ONLY the `publication` field, and only where it is missing: `visible`,
// `hidden` and `hidden_reason` are untouched, so no served state changes. A
// rights-class reason on a book that is not `visible: false` stays `unpublished`
// (promoting it would change what the reader gate serves) and is counted as a conflict.
//
// Usage:
//   node --env-file=.env.production.local scripts/maintenance/backfill-publication-state.mjs          # dry-run
//   node --env-file=.env.production.local scripts/maintenance/backfill-publication-state.mjs --apply  # decision 1
//   --show-unmapped   also print every unmapped hidden_reason string (default: counts + first 40)
//
// The dry-run prints the state × reason cross-tab; it should reproduce the doc's
// public / withdrawn / unpublished counts (57,760 / 40,338 / 19,053 on 2026-09-30).
//
// Takedowns created by the backfill cite the tracking issue (#5303); each has its
// original string in `publication.note`, which only this repo's private tooling reads.

import { withMongo } from '../lib/mongo.mjs';
import { legacyPublication, mapLegacyReason } from '../lib/publication.mjs';

const APPLY = process.argv.includes('--apply');
const SHOW_UNMAPPED = process.argv.includes('--show-unmapped');
const BY = 'script:backfill-publication-state';
const TRACKING_ISSUE = 5303;
const BATCH = 1000;

await withMongo(async (db) => {
  const books = db.collection('books');
  const crossTab = new Map(); // `${state}\t${reason}` → n
  const conflicts = {};
  const unmapped = new Map();
  let total = 0;
  let already = 0;
  let written = 0;
  let ops = [];
  const now = new Date();

  const flush = async () => {
    if (!ops.length) return;
    if (APPLY) {
      const r = await books.bulkWrite(ops, { ordered: false });
      written += r.modifiedCount;
    }
    ops = [];
  };

  const cursor = books.find({}, {
    projection: { _id: 1, id: 1, visible: 1, hidden: 1, hidden_reason: 1, duplicate_of: 1, publication: 1 },
  });
  for await (const book of cursor) {
    total++;
    if (book.publication?.state) { already++; continue; }
    const p = legacyPublication(book);
    const key = `${p.state}\t${p.reason ?? '-'}`;
    crossTab.set(key, (crossTab.get(key) || 0) + 1);
    if (p.conflict) conflicts[p.conflict] = (conflicts[p.conflict] || 0) + 1;
    if (book.hidden_reason != null && !mapLegacyReason(book.hidden_reason).mapped) {
      const s = String(book.hidden_reason);
      unmapped.set(s, (unmapped.get(s) || 0) + 1);
    }

    const publication = { state: p.state, reason: p.reason, note: p.note, since: now, by: BY, version: 1 };
    if (p.state === 'takedown') publication.issue = TRACKING_ISSUE;
    if (p.reason === 'duplicate' && book.duplicate_of) publication.duplicate_of = book.duplicate_of;
    ops.push({
      updateOne: {
        filter: { _id: book._id, publication: { $exists: false } },
        update: { $set: { publication } },
      },
    });
    if (ops.length >= BATCH) await flush();
  }
  await flush();

  const byState = {};
  for (const [k, n] of crossTab) {
    const s = k.split('\t')[0];
    byState[s] = (byState[s] || 0) + n;
  }
  console.log(`books scanned: ${total}  (already carrying publication: ${already})`);
  console.log('\nstate totals:');
  for (const s of ['public', 'unpublished', 'hidden', 'takedown']) console.log(`  ${s.padEnd(12)} ${byState[s] || 0}`);
  console.log(`  withdrawn (hidden + takedown) ${(byState.hidden || 0) + (byState.takedown || 0)}`);
  console.log('\nstate × reason:');
  for (const [k, n] of [...crossTab].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`  ${k.padEnd(34)} ${n}`);
  console.log('\nconflicts (kept at the served state, reported for the audit):');
  for (const [k, n] of Object.entries(conflicts)) console.log(`  ${k.padEnd(34)} ${n}`);
  const um = [...unmapped].sort((a, b) => b[1] - a[1]);
  console.log(`\nunmapped hidden_reason strings → curation (text kept in note): ${um.length} strings, ${um.reduce((a, [, n]) => a + n, 0)} books`);
  for (const [s, n] of (SHOW_UNMAPPED ? um : um.slice(0, 40))) console.log(`  ${n}\t${s.slice(0, 120)}`);

  if (APPLY) console.log(`\nAPPLIED: publication written on ${written} books.`);
  else console.log('\nDry-run (default). --apply writes `publication` only; legacy fields untouched.');
});
