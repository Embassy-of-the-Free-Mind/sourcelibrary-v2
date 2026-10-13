#!/usr/bin/env node
/**
 * Restore the OCR metadata that two re-OCR writers destroyed before PR #5114 (`keepMeta`).
 * The Syriac Kraken lane (reason 'reocr_syriac_kraken_4883', 2026-09-25) and the Tibetan
 * pilot (reason 'reocr_bdrc_4523', book 69e7aae15f1a22ab19a8edd5, 2026-09-25) unset the old
 * read's prompt ids, hashes, token counts, source_url… while their page_revisions snapshot kept
 * only data/source/model/language. The fields survive in the weekly corpus-text backup.
 * Approved by Derek 2026-09-26; handoff ops/handoffs/2026-09-26-ocr-metadata-restore-and-woodblock-backfill.md Part 1.
 *
 * PRIOR ART: scripts/lib/page-revisions.mjs `keepMeta` — the forward fix; it cannot reach rows
 * already written. scripts/workers/backup-corpus-text.sh RESTORE — restores a whole collection,
 * which the handoff forbids for `pages`. Nothing in scripts/maintenance restores one field of a
 * revision row from a backup.
 *
 * Inputs (both produced on Hetzner, never touching `bookstore.pages`):
 *   --targets  revision rows to fill: {rev, page_id, book_id, reason, created_at}, restricted to
 *              rows created AFTER the snapshot (only those can have their before-state in it);
 *   --snap     the snapshot's ocr for those pages: {id, ocr_meta (ocr minus data), data_hash}, streamed
 *              out of `restic dump <snapshot> /pages.archive.gz` by a BSON filter.
 * A row is written only when the snapshot's text hash equals the revision row's text hash — the
 * snapshot then provably describes the read this row preserves. Otherwise it is recorded, not written.
 * The update filter requires `meta` to be absent, so no existing meta is ever overwritten.
 *
 * Default DRY RUN. --apply writes.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { contentHash } from '../lib/translate-core.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const ARG = (n, d) => {
  const a = process.argv.find((x) => x.startsWith(`${n}=`));
  return a ? a.slice(n.length + 1) : d;
};
const APPLY = process.argv.includes('--apply');
const TARGETS = ARG('--targets', null);
const SNAP = ARG('--snap', null);
const SNAPSHOT = ARG('--snapshot', '1ae7e8a7');
const TAKEN = ARG('--taken', '2026-09-20T06:00:03Z');
const REPORT = ARG('--report', `scripts/output/restore-revision-meta-${new Date().toISOString().slice(0, 10)}.jsonl`);
if (!TARGETS || !SNAP) { console.error('--targets and --snap required'); process.exit(1); }
const SWEEP = 'restore-revision-meta-5114';

const load = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const targets = load(TARGETS);
const snap = new Map(load(SNAP).map((s) => [s.id, s]));
const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');
const report = fs.createWriteStream(REPORT, { flags: 'a' });
const rec = (r) => report.write(`${JSON.stringify({ ...r, at: new Date().toISOString() })}\n`);

const counts = { targets: targets.length, in_snapshot: 0, not_in_snapshot: 0, has_meta_already: 0, text_mismatch: 0, snapshot_no_text: 0, eligible: 0, written: 0, raced: 0 };
const byReason = {};
const plan = [];
for (let i = 0; i < targets.length; i += 2000) {
  const slice = targets.slice(i, i + 2000);
  const rows = await db.collection('page_revisions').find({ id: { $in: slice.map((t) => t.rev) } }, { projection: { id: 1, page_id: 1, book_id: 1, data: 1, meta: 1, reason: 1 } }).toArray();
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const t of slice) {
    const row = byId.get(t.rev);
    const s = snap.get(t.page_id);
    let k;
    if (!row) k = 'rev_row_missing';
    else if (row.meta) k = 'has_meta_already';
    else if (!s) k = 'not_in_snapshot';
    else if (!s.data_hash) k = 'snapshot_no_text';
    else if (contentHash(row.data || '') !== s.data_hash) k = 'text_mismatch';
    else k = 'eligible';
    counts[k] = (counts[k] || 0) + 1;
    if (s) counts.in_snapshot++;
    (byReason[t.reason] ||= {})[k] = (byReason[t.reason][k] || 0) + 1;
    if (k === 'eligible') plan.push({ t, row, s });
    else if (k !== 'has_meta_already') rec({ rev: t.rev, page_id: t.page_id, status: k });
  }
}
counts.not_in_snapshot = targets.length - counts.in_snapshot;
console.log(JSON.stringify({ counts, byReason }, null, 1));

// Shape assertions: this is the set measured 2026-09-30 (21,280 Syriac + 193 Tibetan rows created after the snapshot).
const assert = (c, m) => { if (!c) { console.error(`SHAPE FAIL: ${m}`); process.exit(2); } };
assert(targets.length === 21473, `targets ${targets.length} != 21473`);
assert(plan.length >= 0.9 * targets.length, `only ${plan.length} eligible of ${targets.length} (<90%) — the snapshot may not be the before-state`);
for (const { s } of plan) assert(!('data' in s.ocr_meta), 'snapshot meta carries data');
for (const { s } of plan.slice(0, 3)) console.log('SAMPLE', JSON.stringify(s.ocr_meta).slice(0, 400));

if (!APPLY) { rec({ status: 'dry-run', ...counts }); report.end(); await mongo.close(); process.exit(0); }

const now = new Date();
const perBook = new Map();
for (const { t, row, s } of plan) {
  const res = await db.collection('page_revisions').updateOne(
    { id: row.id, meta: { $exists: false } },
    { $set: { meta: s.ocr_meta, meta_restored_from: { snapshot: SNAPSHOT, tag: 'corpus-text', file: '/pages.archive.gz', taken: new Date(TAKEN), matched_on: 'content_hash of data', at: now, sweep: SWEEP } } },
  );
  if (res.modifiedCount === 1) { counts.written++; perBook.set(row.book_id, (perBook.get(row.book_id) || 0) + 1); } else { counts.raced++; rec({ rev: row.id, status: 'SKIP-guard-at-write' }); }
}
for (const [book_id, n] of perBook) {
  await recordSweepAction(db, { sweep: SWEEP, book_id, action: 'revision-meta-restored', detail: { rows: n, snapshot: SNAPSHOT, taken: TAKEN, issue: 5114 } });
}
console.log(JSON.stringify({ written: counts.written, raced: counts.raced, books: perBook.size }));
rec({ status: 'run-summary', ...counts, books: perBook.size });
report.end();
await mongo.close();
