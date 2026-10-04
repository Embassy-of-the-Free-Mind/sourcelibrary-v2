#!/usr/bin/env node
/**
 * Put wrongly-removed collection copies back on their grids (#5689 recheck).
 *
 * PRIOR ART: scripts/identity-evidence/collection-copies-2026-10-03.method/6-apply-membership.mjs
 * did the removal ($pull on books.collections, highlight swaps) and kept no backup in git;
 * scripts/maintenance/apply-collection-copy-keepers.mjs hides confirmed copies site-wide. Neither
 * puts membership back. scripts/lib/confirmed-copies.mjs decides pairs but writes nothing.
 *
 * Reads the committed evidence:
 *   collection-copies-<date>.jsonl          `applied.removed_from_collections` per pair
 *   collection-copies-<date>.recheck.jsonl  by-eye recheck verdicts
 * A pair qualifies when the recheck says different_part, different_edition or fragment
 * (NOT cannot_tell — "could not tell" is no reason to undo a removal). For each qualifying copy,
 * every removed slug the book is not in today goes back with $addToSet; updated_at is bumped.
 * One sweep_log row per restored book, with the recheck verdict as the reason.
 *
 * Not restored: `collection_relevance.<slug>` (the removal unset it; the values were not kept)
 * and `highlighted_books` (a swap to the keeper may have happened; we list every collection
 * whose highlights hold the keeper so a person can decide).
 *
 * DRY BY DEFAULT. --apply writes; --revalidate (with --apply) then POSTs the touched
 * /collections/<slug> paths to https://sourcelibrary.org/api/admin/revalidate.
 *
 *   node --env-file=.env.production.local scripts/maintenance/restore-collection-copy-membership.mjs [--json out.json]
 *   node --env-file=.env.production.local scripts/maintenance/restore-collection-copy-membership.mjs --apply --revalidate
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { EVIDENCE_DIR } from '../lib/confirmed-copies.mjs';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const REVALIDATE = process.argv.includes('--revalidate');
const jsonIdx = process.argv.indexOf('--json');
const JSON_OUT = jsonIdx > 0 ? process.argv[jsonIdx + 1] : null;
const DATE = '2026-10-03';
const SWEEP = `collection-copy-restore-${new Date().toISOString().slice(0, 10)}`;
const RESTORE_VERDICTS = new Set(['different_part', 'different_edition', 'fragment']);

if (!process.env.MONGODB_URI) {
  console.error('MONGODB_URI not set — pass --env-file=.env.production.local');
  process.exit(2);
}

const readJsonl = (f) => fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const verdicts = readJsonl(path.join(EVIDENCE_DIR, `collection-copies-${DATE}.jsonl`)).filter((r) => r.row === 'pair');
const rechecks = readJsonl(path.join(EVIDENCE_DIR, `collection-copies-${DATE}.recheck.jsonl`));
const key = (r) => `${r.copy_id}|${r.keeper_id}`;
const vByPair = new Map(verdicts.map((v) => [key(v), v]));

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

const plan = { restore: [], nothing_to_do: [], skipped: [], highlight_review: [] };
const slugsTouched = new Set();
for (const r of rechecks) {
  if (!RESTORE_VERDICTS.has(r.verdict)) continue;
  const v = vByPair.get(key(r));
  if (!v) { plan.skipped.push({ ...pick(r), why: 'no evidence pair row' }); continue; }
  const removed = v.applied?.removed_from_collections || [];
  const book = await db.collection('books').findOne({ id: r.copy_id }, { projection: { _id: 0, id: 1, title: 1, collections: 1, visible: 1, hidden: 1 } });
  if (!book) { plan.skipped.push({ ...pick(r), why: 'copy not found in books' }); continue; }
  const have = new Set(book.collections || []);
  const missing = removed.filter((s) => !have.has(s));
  const existing = new Set((await db.collection('collections').find({ slug: { $in: missing } }, { projection: { _id: 0, slug: 1 } }).toArray()).map((c) => c.slug));
  const gone = missing.filter((s) => !existing.has(s));
  const add = missing.filter((s) => existing.has(s));
  const hl = await db.collection('collections').find({ slug: { $in: removed }, 'highlighted_books.book_id': r.keeper_id }, { projection: { _id: 0, slug: 1 } }).toArray();
  for (const c of hl) plan.highlight_review.push({ slug: c.slug, keeper_id: r.keeper_id, copy_id: r.copy_id, cluster_no: r.cluster_no, verdict: r.verdict });
  const row = { ...pick(r), title: book.title, status: v.status, removed, add, already_in: removed.filter((s) => have.has(s)), collection_gone: gone, visible: book.visible ?? null };
  if (!add.length) { plan.nothing_to_do.push(row); continue; }
  plan.restore.push(row);
  add.forEach((s) => slugsTouched.add(s));
}

function pick(r) { return { cluster_no: r.cluster_no, copy_id: r.copy_id, keeper_id: r.keeper_id, verdict: r.verdict }; }

console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — sweep ${SWEEP}`);
console.log(`  recheck rows qualifying (${[...RESTORE_VERDICTS].join('/')}): ${plan.restore.length + plan.nothing_to_do.length + plan.skipped.length}`);
console.log(`  books to restore: ${plan.restore.length}, memberships to add: ${plan.restore.reduce((n, x) => n + x.add.length, 0)}, collections touched: ${slugsTouched.size}`);
console.log(`  nothing to do (already a member everywhere): ${plan.nothing_to_do.length}; skipped: ${plan.skipped.length}`);
for (const x of plan.restore) console.log(`   cl ${x.cluster_no} ${x.copy_id} [${x.verdict}${x.status === 'reversed' ? ', was reversed' : ''}] + ${x.add.join(', ')}${x.collection_gone.length ? `  (gone: ${x.collection_gone.join(', ')})` : ''}`);
for (const x of plan.nothing_to_do) console.log(`   cl ${x.cluster_no} ${x.copy_id} [${x.verdict}] already in ${x.already_in.join(', ') || '—'}${x.collection_gone.length ? `  (gone: ${x.collection_gone.join(', ')})` : ''}`);
for (const x of plan.skipped) console.log(`   SKIP cl ${x.cluster_no} ${x.copy_id}: ${x.why}`);
console.log(`  highlights holding the keeper (not changed; review by hand): ${plan.highlight_review.length}`);
for (const h of plan.highlight_review) console.log(`   /collections/${h.slug}: keeper ${h.keeper_id} (copy ${h.copy_id}, cl ${h.cluster_no}, ${h.verdict})`);
if (JSON_OUT) fs.writeFileSync(JSON_OUT, JSON.stringify({ sweep: SWEEP, apply: APPLY, ...plan }, null, 1));

if (APPLY && plan.restore.length) {
  const now = new Date();
  let written = 0;
  for (const x of plan.restore) {
    const res = await db.collection('books').updateOne({ id: x.copy_id }, { $addToSet: { collections: { $each: x.add } }, $set: { updated_at: now } });
    if (res.modifiedCount) written++;
  }
  await recordSweepActions(db, plan.restore.map((x) => ({
    sweep: SWEEP, book_id: x.copy_id, action: 'collection-membership-restored',
    detail: {
      reason: `by-eye recheck: ${x.verdict}`, keeper_id: x.keeper_id, cluster_no: x.cluster_no, added: x.add,
      evidence: `scripts/identity-evidence/collection-copies-${DATE}.recheck.jsonl`, issue: 5689,
    },
  })));
  console.log(`  restored: ${written} books, ${plan.restore.length} sweep_log rows`);
  if (REVALIDATE) {
    const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
    if (!secret) { console.error('  revalidate: no REVALIDATE_SECRET / CRON_SECRET in env'); process.exitCode = 1; }
    else {
      const paths = [...slugsTouched].map((s) => `/collections/${s}`);
      const r = await fetch('https://sourcelibrary.org/api/admin/revalidate', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-revalidate-secret': secret }, body: JSON.stringify({ paths }),
      });
      console.log(`  revalidate: HTTP ${r.status}, ${paths.length} paths`, (await r.text()).slice(0, 300));
    }
  }
} else if (!APPLY) {
  console.log('  Nothing written. --apply restores membership (returns books to their state before the 2026-10-03 removal).');
}
await client.close();
