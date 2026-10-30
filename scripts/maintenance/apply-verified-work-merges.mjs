#!/usr/bin/env node
/**
 * Apply work merges that TWO models accepted (#7761).
 *
 * PRIOR ART: scripts/analysis/llm-verify-work-merges.mjs --apply-from writes the
 * same merges, but its backup holds only the NEW ids (not reversible), it moves
 * only the visible books the proposer saw (hidden books keep the retired id), and
 * it leaves work_slug on the old work. scripts/maintenance/link-volume-set-work-ids.mjs
 * is the shape copied here (pickWinner, aliases, work_id_merges, sweep_log first).
 *
 * Input: the approved file from scripts/eval/work-recall/merge-precision.mjs
 * --approved-out — flash-lite proposed the group HIGH, Sonnet judged every book
 * in it "all_same_work". Nothing else should be passed here.
 *
 * Per group:
 *   winner  = pickWinner() over the group's work_ids, ties to the id more books carry
 *   carriers = EVERY book (hidden included) whose work_id is one of the group's ids
 *   moves   = carriers on a losing id + the group's books with no work_id
 *   slug    = the winner's commonest work_slug; a moved book's old slug becomes an alias
 * Skipped (listed, not written): a work_id claimed by two groups in this run; two
 * different authority ids (QID / kr: / catalog:) in one group — those disagree on
 * identity and need a person.
 *
 *   node --env-file=.env.production.local scripts/maintenance/apply-verified-work-merges.mjs <approved.json>...          # dry run
 *   node --env-file=.env.production.local scripts/maintenance/apply-verified-work-merges.mjs <approved.json>... --apply
 * After --apply: node --env-file=.env.production.local scripts/workers/sync-books-catalog.mjs (books_catalog carries work_id).
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import path from 'node:path';
import { pickWinner } from '../lib/work-merge-lib.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (!files.length) { console.error('usage: apply-verified-work-merges.mjs <approved.json>... [--apply]'); process.exit(2); }
const SWEEP = 'verified-work-merges-2026-10';
const ISSUE = 7761;
const isAuthority = (w) => /^Q\d+$/.test(w) || /^kr:/.test(w) || /^catalog:/.test(w);

const groups = files.flatMap((f) => JSON.parse(fs.readFileSync(f, 'utf8')).proposals.map((p) => ({ ...p, _file: path.basename(f) })));
const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 20000 });
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

// current state of the group books (the proposal may be hours old)
const groupIds = [...new Set(groups.flatMap((g) => g.bookIds))];
const PROJ = { _id: 0, id: 1, work_id: 1, work_title: 1, work_id_source: 1, work_id_confidence: 1, work_slug: 1, work_id_aliases: 1, visible: 1 };
const now = new Map();
for (let i = 0; i < groupIds.length; i += 2000) for (const b of await books.find({ id: { $in: groupIds.slice(i, i + 2000) } }, { projection: PROJ }).toArray()) now.set(b.id, b);

const claims = new Map(); // work_id -> group index
const plan = [], skipped = [];
groups.forEach((g, gi) => {
  const cur = g.bookIds.map((id) => now.get(id)).filter(Boolean);
  const wids = [...new Set(cur.map((b) => b.work_id).filter(Boolean))];
  const auth = wids.filter(isAuthority);
  if (auth.length > 1) { skipped.push({ g, why: `two authority ids ${auth.join(' + ')}` }); return; }
  const clash = wids.find((w) => claims.has(w));
  if (clash) { skipped.push({ g, why: `${clash} also in group ${claims.get(clash)}` }); return; }
  if (wids.length < 2 && !cur.some((b) => !b.work_id)) return; // already one work
  wids.forEach((w) => claims.set(w, gi));
  plan.push({ g, gi, wids, cur });
});

// every carrier of every planned id, hidden books included
const allWids = [...new Set(plan.flatMap((p) => p.wids))];
const carriers = new Map();
for (let i = 0; i < allWids.length; i += 1000) for (const b of await books.find({ work_id: { $in: allWids.slice(i, i + 1000) } }, { projection: PROJ }).toArray()) {
  if (!carriers.has(b.work_id)) carriers.set(b.work_id, []); carriers.get(b.work_id).push(b);
}
const writes = [];
for (const p of plan) {
  const inbound = new Map(p.wids.map((w) => [w, (carriers.get(w) || []).length]));
  const winner = p.wids.length ? pickWinner(p.wids, inbound) : null;
  if (!winner) { skipped.push({ g: p.g, why: 'no existing work_id to merge into' }); continue; }
  const winBooks = carriers.get(winner) || [];
  const slugCount = new Map(); for (const b of winBooks) if (b.work_slug) slugCount.set(b.work_slug, (slugCount.get(b.work_slug) || 0) + 1);
  const winSlug = [...slugCount].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  const winTitle = winBooks.find((b) => b.work_title)?.work_title || p.g.canonical_title;
  const losers = p.wids.filter((w) => w !== winner);
  const moving = [...losers.flatMap((w) => carriers.get(w) || []), ...p.cur.filter((b) => !b.work_id)];
  p.winner = winner; p.losers = losers; p.moves = moving.length;
  for (const b of moving) writes.push({ before: b, winner, losers, winSlug, winTitle, group: p.gi, author: p.g.author, canonical_title: p.g.canonical_title });
}
const hiddenMoves = writes.filter((w) => !w.before.visible).length;
console.log(`groups ${groups.length} -> planned ${plan.filter((p) => p.winner).length}, skipped ${skipped.length}`);
console.log(`book writes ${writes.length} (hidden ${hiddenMoves}); retired ids ${new Set(writes.flatMap((w) => w.losers)).size}`);
for (const s of skipped.slice(0, 15)) console.log(`  skip [${s.g.author}] ${s.g.canonical_title}: ${s.why}`);

const outDir = new URL('../output/', import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const backupPath = path.join(outDir, `verified-work-merges-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
fs.writeFileSync(backupPath, JSON.stringify({ sweep: SWEEP, issue: ISSUE, apply: APPLY, sources: files, skipped: skipped.map((s) => ({ author: s.g.author, title: s.g.canonical_title, why: s.why })),
  writes: writes.map((w) => ({ id: w.before.id, before: w.before, after: { work_id: w.winner, work_slug: w.winSlug ?? w.before.work_slug ?? null } })) }, null, 2));
console.log(`plan + before-state -> ${backupPath}`);
if (!APPLY) { console.log('DRY RUN — pass --apply to write.'); await client.close(); process.exit(0); }

const t0 = new Date();
let moved = 0, stale = 0;
for (const w of writes) {
  const b = w.before;
  const slugMove = w.winSlug && b.work_slug && b.work_slug !== w.winSlug;
  const aliases = [...w.losers, ...(slugMove ? [b.work_slug] : [])];
  await recordSweepAction(db, { sweep: SWEEP, book_id: b.id, action: 'work-id-merged',
    detail: { from: b.work_id ?? null, to: w.winner, slug_from: b.work_slug ?? null, slug_to: w.winSlug, proposer: 'llm-verify-work-merges flash-lite HIGH', verifier: 'merge-precision sonnet all_same_work', issue: ISSUE, backup: backupPath } });
  const set = { work_id: w.winner, work_title: w.winTitle, work_id_source: 'work-merge:llm-verified', work_id_confidence: 'high', updated_at: t0, ...(w.winSlug ? { work_slug: w.winSlug } : {}) };
  const r = await books.updateOne({ id: b.id, work_id: b.work_id ?? null }, { $set: set, $addToSet: { work_id_aliases: { $each: aliases } } });
  if (r.matchedCount) moved += r.modifiedCount; else stale++;
}
for (const p of plan.filter((p) => p.winner)) {
  await db.collection('work_id_merges').insertOne({ winner: p.winner, losers: p.losers, sources: ['llm-verify:flash-lite', 'verify:sonnet'], canonical_title: p.g.canonical_title,
    author_id: p.g.author_id, books_rewritten: p.moves, issue: ISSUE, sweep: SWEEP, backup: backupPath, applied_at: t0 });
}
console.log(`APPLIED — ${moved} books moved, ${stale} skipped (changed since plan). Now run scripts/workers/sync-books-catalog.mjs.`);
await client.close();
