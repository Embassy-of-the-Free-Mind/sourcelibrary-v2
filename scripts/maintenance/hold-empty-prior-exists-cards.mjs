#!/usr/bin/env node
/**
 * PRIOR ART: scripts/workers/prior-translation-check.mjs (writes the same held shape —
 * under_review + review.identity_flag — for its own HOLD_* decisions, but only fills voids and never
 * touches a settled card). scripts/eval/ft-work-registry-pilot.mjs (the seeder that wrote these cards;
 * re-running it would regenerate them wholesale). Neither repairs a contradicted card in place.
 *
 * Holds the Translation Cards that say `prior_exists` but list no prior (#4575).
 *
 * The cards were seeded on 2026-08-11 from book verdicts first_modern / first_complete /
 * first_from_source, which IMPLY an earlier English translation, but the attempt behind each verdict
 * found none (result none, found_refs []). So the status asserts what the card cannot show.
 *
 * What the write does, per card (detector: scripts/audit/card-status-consistency.mjs, EMPTY_PRIOR):
 *   status                   prior_exists → under_review
 *   review.identity_flag     true   — REQUIRED. Without it Phase 7.7 (prior-translation-check.mjs)
 *                                     treats an under_review card with no cited entry as a void and
 *                                     may write no_prior_known, which renders "Possibly the first
 *                                     English translation" on a work whose own verdict says an older
 *                                     or partial English translation exists.
 *   review.held_from_status  'prior_exists' — the undo: set status back from this field.
 *   review.held_at / held_by / notes
 * Reader-visible change: none. cardLabel() returns null for prior_exists with no usable entry AND for
 * under_review. The filter on each update re-checks the status, so a card someone fixed meanwhile is
 * left alone. One sweep_log row per card.
 *
 * Dry run by default; writes the full diff (every card: id, field, before, after) as JSONL.
 *
 * Usage (read-only unless --apply):
 *   node --env-file=.env.production.local scripts/maintenance/hold-empty-prior-exists-cards.mjs \
 *        [--out=<file.jsonl>] [--apply]
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'node:fs';
import { CARDS, EMPTY_PRIOR_QUERY, isEmptyPrior } from '../audit/card-status-consistency.mjs';

const APPLY = process.argv.includes('--apply');
const SWEEP = 'hold-empty-prior-exists-cards-4575';
const OUT = process.argv.find((a) => a.startsWith('--out='))?.split('=')[1]
  ?? `${process.env.JOB_SCRATCH || process.env.TMPDIR || '/tmp'}/${SWEEP}-${APPLY ? 'apply' : 'dryrun'}.jsonl`;
const NOTE = 'Held (#4575): status said prior_exists, but no prior was ever found or cited — the seeder '
  + 'mapped a qualified-first verdict to prior_exists. Needs an unprimed citation search before any rendering status.';

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const col = db.collection(CARDS);

const cards = (await col.find(EMPTY_PRIOR_QUERY).toArray()).filter(isEmptyPrior);
// Only prior_exists is in this repair's scope; an empty antiquated_or_partial_only card (none today)
// is a different claim and is reported by the detector, not rewritten here.
const targets = cards.filter((c) => c.status === 'prior_exists');
const verdicts = new Map((await db.collection('books').find(
  { id: { $in: targets.map((c) => c.review?.seeded_from_book).filter(Boolean) } },
  { projection: { id: 1, 'first_translation.verdict': 1 } },
).toArray()).map((b) => [b.id, b.first_translation?.verdict ?? null]));

const now = new Date().toISOString();
const rows = [];
for (const c of targets) {
  const base = { _id: c._id, title: String(c.work_title ?? '').slice(0, 100), seeded_from_book: c.review?.seeded_from_book ?? null,
    book_verdict_now: verdicts.get(c.review?.seeded_from_book) ?? null, entries: (c.entries ?? []).length };
  rows.push({ ...base, field: 'status', before: c.status, after: 'under_review' });
  rows.push({ ...base, field: 'review.identity_flag', before: c.review?.identity_flag ?? null, after: true });
  rows.push({ ...base, field: 'review.held_from_status', before: c.review?.held_from_status ?? null, after: 'prior_exists' });
  rows.push({ ...base, field: 'review.notes', before: c.review?.notes ?? null, after: NOTE });
}
writeFileSync(OUT, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

const tally = {};
for (const c of targets) { const v = verdicts.get(c.review?.seeded_from_book) ?? 'book-missing'; tally[v] = (tally[v] ?? 0) + 1; }
console.log(`${SWEEP} [${APPLY ? 'APPLY' : 'DRY RUN'}] ${now}`);
console.log(`cards with a prior status and no usable entry: ${cards.length}; in scope (prior_exists): ${targets.length}`);
console.log(`seed book's verdict today: ${JSON.stringify(tally)}`);
console.log(`diff: ${rows.length} rows (${targets.length} cards × 4 fields) → ${OUT}`);

if (!APPLY) {
  console.log('DRY RUN — nothing written. Re-run with --apply.');
  await mongo.close();
  process.exit(0);
}

const { recordSweepAction } = await import('../lib/sweep-log.mjs');
let written = 0;
let skipped = 0;
for (const c of targets) {
  const res = await col.updateOne(
    { _id: c._id, status: 'prior_exists' },
    { $set: { status: 'under_review', 'review.identity_flag': true, 'review.held_from_status': 'prior_exists',
      'review.held_at': now, 'review.held_by': SWEEP, 'review.notes': NOTE } },
  );
  if (!res.modifiedCount) { skipped++; continue; }
  written++;
  await recordSweepAction(db, { sweep: SWEEP, book_id: c.review?.seeded_from_book ?? String(c._id), action: 'card-held-empty-prior',
    detail: { work_id: c._id, before: 'prior_exists', after: 'under_review+identity_flag' } });
}
// Post-write verification: read the collection back, not our own counter.
const held = await col.countDocuments({ 'review.held_by': SWEEP, status: 'under_review', 'review.identity_flag': true });
const left = (await col.find(EMPTY_PRIOR_QUERY).toArray()).filter((c) => c.status === 'prior_exists' && isEmptyPrior(c)).length;
console.log(`APPLIED: ${written} held, ${skipped} skipped (changed since the read). post-write: ${held} held by ${SWEEP}; ${left} empty prior_exists left (expect 0).`);
await mongo.close();
