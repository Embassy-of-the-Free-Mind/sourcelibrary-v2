#!/usr/bin/env node
/**
 * apply-dark-cluster-triage — execute Derek-approved rows from the read-only
 * dark-cluster triage report (#3814, scripts/audit/dark-cluster-triage.mjs).
 *
 * The report pre-classified 1,993 dark duplicate pointers by hidden keeper.
 * Three of its buckets have a mechanical action once a human approves them;
 * this script owns those actions and nothing else:
 *
 *   --lane restore   (bucket RESTORE_CANDIDATE) flip the keeper visible —
 *                    one visibility flip un-darkens the whole cluster.
 *   --lane repoint   (bucket REPOINT) aim each pointer's duplicate_of at the
 *                    VISIBLE artwork carrying the same commons_sha1.
 *   --lane unmark    (bucket SUSPECT_NOT_DUP) remove the false duplicate_of
 *                    mark (sha1 proves not-a-copy) and restore visibility
 *                    when the only reason the doc was hidden was the mark.
 *
 * Every guard is re-verified against LIVE data at apply time — the report is
 * a snapshot, and a keeper acquired hidden_reason / a pointer re-resolved
 * since triage must not be touched on stale evidence. Kloss rule throughout:
 * any takedown-shaped hidden_reason anywhere in a cluster excludes it.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/apply-dark-cluster-triage.mjs --lane restore                  # dry-run, newest report
 *   node scripts/maintenance/apply-dark-cluster-triage.mjs --lane restore --apply          # write
 *   node scripts/maintenance/apply-dark-cluster-triage.mjs --lane repoint --only id1,id2 --apply
 *   node scripts/maintenance/apply-dark-cluster-triage.mjs --lane unmark --only @approved.txt --apply --finalize
 *
 *   --report <path>   use a specific triage JSON (default: newest in scripts/output/)
 *   --only a,b | @f   subset by keeper id (restore) / pointer id (repoint, unmark)
 *   --apply           write (default is dry-run)
 *   --finalize        after writing: catalog sync + ISR revalidate + CF purge
 *
 * Writes it makes: books.visible/hidden/duplicate_of/hidden_reason/updated_at,
 * a backup in scripts/output/, one provenance row in dedup_apply_runs.
 * Downstream automated readers (say so, don't discover it): the Hetzner
 * sync-worker refreshes collection counts on its next cycle; sync-books-catalog
 * propagates visibility to Supabase (run here by --finalize, otherwise by the
 * Hetzner supabase-sync cron). Nothing else consumes duplicate_of unattended —
 * dedup reads it at import time only.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import {
  TAKEDOWN_RX, DUP_REASON_RX, flagValue, idFilter, resolveReport,
  writeBackup, recordRun, pagePath, finalizeCaches, skipLine,
} from '../lib/triage-apply.mjs';

const LANE = flagValue('--lane');
const APPLY = process.argv.includes('--apply');
const FINALIZE = process.argv.includes('--finalize');
const only = idFilter('--only');
const LANE_BUCKET = { restore: 'RESTORE_CANDIDATE', repoint: 'REPOINT', unmark: 'SUSPECT_NOT_DUP' };
if (!LANE_BUCKET[LANE]) {
  console.error('--lane restore | repoint | unmark is required (one lane per run — approvals are per lane).');
  process.exit(1);
}

const reportPath = resolveReport('dark-cluster-triage');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const clusters = report.clusters.filter((c) => c.bucket === LANE_BUCKET[LANE]);
console.log(`${reportPath}\nlane ${LANE}: ${clusters.length} clusters in report${only ? `, filtered by --only (${only.size})` : ''}${APPLY ? '' : '  [DRY-RUN]'}`);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');
const PROJ = { _id: 0, id: 1, title: 1, slug: 1, visible: 1, hidden: 1, hidden_reason: 1, duplicate_of: 1, commons_sha1: 1, resource_type: 1 };

const now = new Date();
const backupDocs = [];   // prior state of every doc we will touch
const ops = [];          // bulkWrite ops
const touchedPaths = []; // ISR paths to revalidate after apply
const applied = [];      // ids actually written, for the provenance row
let skipped = 0;

/** Shared exclusion: live takedown-shaped reason anywhere near the write. */
const takedownHold = (...docs) => docs.some((d) => d?.hidden_reason && TAKEDOWN_RX.test(d.hidden_reason));

// ── batch prefetch (one $in query per shape, not one query per cluster) ──
// Everything below reads from these maps; the per-row guards stay identical.
const allIds = new Set();
for (const c of clusters) {
  if (c.keeper_id) allIds.add(c.keeper_id);
  for (const pid of c.pointer_ids || []) allIds.add(pid);
  for (const t of c.repoint_targets || []) { allIds.add(t.pointer); allIds.add(t.visible_copy); }
}
const byId = new Map();
const idList = [...allIds];
for (let i = 0; i < idList.length; i += 500) {
  for (const d of await books.find({ id: { $in: idList.slice(i, i + 500) } }, { projection: PROJ }).toArray()) byId.set(d.id, d);
}
// restore lane needs each keeper's LIVE pointer set (report lists a snapshot)
const pointersByKeeper = new Map();
if (LANE === 'restore') {
  const keeperIds = clusters.map((c) => c.keeper_id).filter(Boolean);
  for (let i = 0; i < keeperIds.length; i += 500) {
    for (const d of await books.find({ duplicate_of: { $in: keeperIds.slice(i, i + 500) } }, { projection: { ...PROJ, duplicate_of: 1 } }).toArray()) {
      if (!pointersByKeeper.has(d.duplicate_of)) pointersByKeeper.set(d.duplicate_of, []);
      pointersByKeeper.get(d.duplicate_of).push(d);
    }
  }
}

for (const c of clusters) {
  if (LANE === 'restore') {
    if (only && !only.has(c.keeper_id)) continue;
    const keeper = byId.get(c.keeper_id);
    if (!keeper) { skipLine(c.keeper_id, 'keeper no longer exists'); skipped++; continue; }
    if (keeper.visible === true) { skipLine(c.keeper_id, 'already visible'); skipped++; continue; }
    // Kloss guard, live: a reason written since triage is a deliberate hold.
    if (keeper.hidden_reason) { skipLine(c.keeper_id, `HOLD hidden_reason="${keeper.hidden_reason}"`); skipped++; continue; }
    const pointers = pointersByKeeper.get(c.keeper_id) || [];
    if (takedownHold(...pointers)) { skipLine(c.keeper_id, 'takedown-shaped reason on a pointer'); skipped++; continue; }
    backupDocs.push(keeper);
    ops.push({ updateOne: { filter: { id: keeper.id, visible: { $ne: true }, hidden_reason: keeper.hidden_reason ?? null }, update: { $set: { visible: true, hidden: false, updated_at: now } } } });
    applied.push(keeper.id);
    touchedPaths.push(pagePath(keeper));
    console.log(`  restore ${keeper.id} "${(keeper.title || '').slice(0, 60)}" (un-darkens ${pointers.length} pointer(s))`);
  }

  if (LANE === 'repoint') {
    for (const t of c.repoint_targets || []) {
      if (only && !only.has(t.pointer)) continue;
      const ptr = byId.get(t.pointer);
      const copy = byId.get(t.visible_copy);
      if (!ptr || !copy) { skipLine(t.pointer, 'pointer or target gone'); skipped++; continue; }
      if (ptr.duplicate_of !== c.keeper_id) { skipLine(t.pointer, `duplicate_of changed to ${ptr.duplicate_of} since triage`); skipped++; continue; }
      // The whole basis of REPOINT is the sha1 identity — require it live.
      if (!ptr.commons_sha1 || ptr.commons_sha1 !== copy.commons_sha1) { skipLine(t.pointer, 'sha1 evidence no longer holds'); skipped++; continue; }
      if (copy.visible !== true) { skipLine(t.pointer, `target ${copy.id} no longer visible`); skipped++; continue; }
      if (takedownHold(ptr, copy)) { skipLine(t.pointer, 'takedown-shaped reason'); skipped++; continue; }
      backupDocs.push(ptr);
      ops.push({ updateOne: { filter: { id: ptr.id, duplicate_of: c.keeper_id }, update: { $set: { duplicate_of: copy.id, updated_at: now } } } });
      applied.push(ptr.id);
      console.log(`  repoint ${ptr.id} -> ${copy.id} (was dark keeper ${c.keeper_id})`);
    }
  }

  if (LANE === 'unmark') {
    const keeper = c.keeper_id ? byId.get(c.keeper_id) : null;
    for (const pid of c.pointer_ids || []) {
      if (only && !only.has(pid)) continue;
      const ptr = byId.get(pid);
      if (!ptr) { skipLine(pid, 'pointer gone'); skipped++; continue; }
      if (ptr.duplicate_of !== c.keeper_id) { skipLine(pid, 'duplicate_of changed since triage'); skipped++; continue; }
      // Live re-check of the bucket's evidence: a file hash that differs from
      // the keeper's proves this is not a copy of it (artwork identity is
      // sha1-exact). No hash → no proof → no write.
      if (!ptr.commons_sha1 || (keeper?.commons_sha1 && ptr.commons_sha1 === keeper.commons_sha1)) {
        skipLine(pid, 'sha1 no longer proves not-a-copy'); skipped++; continue;
      }
      if (takedownHold(ptr, keeper)) { skipLine(pid, 'takedown-shaped reason'); skipped++; continue; }
      const reasonIsJustTheMark = !ptr.hidden_reason || DUP_REASON_RX.test(ptr.hidden_reason);
      backupDocs.push(ptr);
      const set = { updated_at: now };
      const unset = { duplicate_of: '' };
      if (reasonIsJustTheMark) {
        // Hidden only because it was marked a duplicate — the mark was false,
        // so the doc returns to the public pool.
        set.visible = true; set.hidden = false;
        if (ptr.hidden_reason) unset.hidden_reason = '';
        touchedPaths.push(pagePath(ptr));
      } // else: an independent curatorial reason — clear the false mark, keep the hold.
      ops.push({ updateOne: { filter: { id: ptr.id, duplicate_of: c.keeper_id }, update: { $set: set, $unset: unset } } });
      applied.push(ptr.id);
      console.log(`  unmark ${ptr.id}${reasonIsJustTheMark ? ' + restore visibility' : ` (keep HOLD "${ptr.hidden_reason}")`}`);
    }
  }
}

console.log(`\n${LANE}: ${ops.length} write(s) planned, ${skipped} skipped by live guards`);

if (APPLY && ops.length) {
  const backupPath = writeBackup(`apply-dark-cluster-${LANE}`, { report: reportPath, lane: LANE, docs: backupDocs });
  const r = await books.bulkWrite(ops, { ordered: false });
  console.log(`modified: ${r.modifiedCount} (backup: ${backupPath})`);
  await recordRun(db, {
    script: 'apply-dark-cluster-triage', lane: LANE, report: reportPath,
    planned: ops.length, modified: r.modifiedCount, skipped, ids: applied, backup: backupPath,
  });
  await finalizeCaches({
    paths: [...touchedPaths, '/collections', '/gallery', '/browse'],
    execute: FINALIZE,
  });
} else if (APPLY) {
  console.log('nothing to write.');
} else {
  console.log('dry-run only — add --apply to write.');
}
await client.close();
