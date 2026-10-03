#!/usr/bin/env node
/**
 * Site-wide collapse of CONFIRMED collection copies (#5689 step 4) — PREPARE ONLY.
 *
 * PRIOR ART: src/lib/identity-review-apply.ts `applyKeeperChoice` is the write this mirrors
 * (setPublicationMany: hidden / duplicate / duplicateOf keeper / from ['public']), but it is
 * TypeScript, needs an `edition_keeper_queue` row, and these pairs never went through that
 * queue. scripts/maintenance/mark-bncf-aldine-copy-duplicates.mjs is the same shape
 * (verdicts passed in as reviewable data) but writes the legacy fields by hand, around the
 * publication writer. scripts/maintenance/apply-keeper-choice-triage.mjs applies queue rows.
 *
 * The 2026-10-03 pass removed copies from collection MEMBERSHIP only. This hides them
 * site-wide, so search, the library and the other-scans rail agree with the grid. Pairs come
 * from scripts/lib/confirmed-copies.mjs — the one loader — and a pair is refused unless the
 * comparator says `same_printing` or it has a by-eye check the comparator does not contradict.
 *
 * Further refusals, each listed:
 *   - keeper not public right now (hiding the copy would leave no scan on the shelf);
 *   - chains: the keeper is itself a confirmed copy, or the copy is someone's keeper;
 *   - ambiguous: the copy has more than one confirmed keeper;
 *   - the copy is not public right now (nothing to hide; setPublicationMany would skip it).
 *
 * Writes (only with --apply): setPublicationMany per keeper (reason duplicate, duplicateOf,
 * by 'collection-copies-5689', issue 5689, note = sweep id), one `book_events` row and one
 * `sweep_log` row per hidden copy. Every write is reversible with setPublication(…'public').
 *
 * DRY BY DEFAULT. Hiding books site-wide waits for Derek.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-collection-copy-keepers.mjs [--json out.json]
 *   node --env-file=.env.production.local scripts/maintenance/apply-collection-copy-keepers.mjs --apply
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import { loadConfirmedCopies } from '../lib/confirmed-copies.mjs';
import { setPublicationMany, legacyPublication } from '../lib/publication.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;
const BY = 'collection-copies-5689';
const SWEEP = `collection-copy-collapse-${new Date().toISOString().slice(0, 10)}`;

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set — pass --env-file=.env.production.local');
  process.exit(2);
}

const confirmed = loadConfirmedCopies();
const copyIds = new Set(confirmed.pairs.map((p) => p.copy_id));
const keeperIds = new Set(confirmed.pairs.map((p) => p.keeper_id));

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const ids = [...new Set([...copyIds, ...keeperIds])];
const docs = await db.collection('books')
  .find({ id: { $in: ids } }, { projection: { _id: 1, id: 1, title: 1, visible: 1, hidden: 1, hidden_reason: 1, publication: 1, duplicate_of: 1 } })
  .toArray();
const byId = new Map(docs.map((d) => [d.id, d]));
const stateOf = (id) => (byId.has(id) ? legacyPublication(byId.get(id)).state : 'not_found');

const plan = { would_hide: [], refused: [] };
for (const r of confirmed.rejected) plan.refused.push({ copy_id: r.copy_id, keeper_id: r.keeper_id, why: `not confirmed: ${r.reason}` });
for (const p of confirmed.pairs) {
  const refuse = (why) => plan.refused.push({ copy_id: p.copy_id, keeper_id: p.keeper_id, basis: p.basis, why });
  const keepersOfThisCopy = confirmed.keepersOfCopy.get(p.copy_id) || [];
  if (keepersOfThisCopy.length > 1) { refuse(`ambiguous: ${keepersOfThisCopy.length} confirmed keepers`); continue; }
  if (copyIds.has(p.keeper_id)) { refuse('chain: keeper is itself a confirmed copy'); continue; }
  if (keeperIds.has(p.copy_id)) { refuse('chain: copy is the keeper of another pair'); continue; }
  const ks = stateOf(p.keeper_id), cs = stateOf(p.copy_id);
  if (ks !== 'public') { refuse(`keeper not public (${ks})`); continue; }
  if (cs !== 'public') { refuse(`copy not public (${cs})`); continue; }
  plan.would_hide.push({ copy_id: p.copy_id, keeper_id: p.keeper_id, basis: p.basis, comparator_score: p.comparator_score, title: byId.get(p.copy_id)?.title ?? null });
}

const tally = (xs, k) => xs.reduce((m, x) => ((m[x[k]] = (m[x[k]] || 0) + 1), m), {});
const whyClass = (w) => w.replace(/ \(.*\)$/, '').replace(/: \d+ confirmed keepers$/, '');
console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — sweep ${SWEEP}, evidence ${confirmed.files.join(', ')}`);
console.log(`  evidence pairs: ${confirmed.pairs.length + confirmed.rejected.length} (confirmed ${confirmed.pairs.length}, not confirmed ${confirmed.rejected.length})`);
console.log(`  would hide: ${plan.would_hide.length}`, tally(plan.would_hide, 'basis'));
console.log(`  refused: ${plan.refused.length}`, plan.refused.reduce((m, r) => ((m[whyClass(r.why)] = (m[whyClass(r.why)] || 0) + 1), m), {}));
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ sweep: SWEEP, apply: APPLY, ...plan }, null, 1));

if (APPLY && plan.would_hide.length) {
  const byKeeper = new Map();
  for (const h of plan.would_hide) byKeeper.set(h.keeper_id, [...(byKeeper.get(h.keeper_id) || []), h]);
  let written = 0;
  for (const [keeperId, hs] of byKeeper) {
    const res = await setPublicationMany(db, hs.map((h) => h.copy_id), {
      state: 'hidden', reason: 'duplicate', duplicateOf: keeperId, by: BY, issue: 5689, note: SWEEP, from: ['public'],
    });
    const done = new Set(res.written);
    const now = new Date();
    const mine = hs.filter((h) => done.has(h.copy_id));
    if (!mine.length) continue;
    written += mine.length;
    await db.collection('book_events').insertMany(mine.map((h) => ({
      book_id: h.copy_id, type: 'hidden-as-collection-copy', at: now, source: BY,
      details: { duplicate_of: keeperId, basis: h.basis, comparator_score: h.comparator_score, sweep: SWEEP, issue: 5689 },
    })));
    await recordSweepActions(db, mine.map((h) => ({
      sweep: SWEEP, book_id: h.copy_id, action: 'hidden-as-duplicate',
      detail: { duplicate_of: keeperId, basis: h.basis, comparator_score: h.comparator_score, evidence: confirmed.files.join(','), issue: 5689 },
    })));
  }
  console.log(`  hidden: ${written}`);
} else if (!APPLY) {
  console.log('  Nothing written. --apply hides these site-wide; that waits for Derek (#5689).');
}
await client.close();
