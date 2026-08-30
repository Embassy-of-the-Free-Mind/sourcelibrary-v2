#!/usr/bin/env node
/**
 * apply-keeper-choice-triage — execute Derek-approved keeper choices from the
 * read-only keeper-choice triage report (#3816,
 * scripts/audit/keeper-choice-triage.mjs).
 *
 * The report pre-classified the both-visible same-edition clusters (2+ visible
 * books sharing one FULL-quality edition_key). Resolving one hides the
 * loser(s) behind a duplicate_of pointer to the keeper — a VISIBILITY change,
 * so it runs only on approved rows, and every signal is re-verified against
 * LIVE data first: translation/OCR progress since triage can flip which copy
 * dominates, and a cluster whose signals drifted is skipped, not guessed.
 *
 *   --lane mechanical  (bucket MECHANICAL_KEEP) keeper must still weakly
 *                      dominate every loser on pages/ocr/translated/quality.
 *   --lane scored      (bucket SCORED_KEEP) same leader must still lead by
 *                      the >=10% weighted margin (translation 3x, OCR 1x,
 *                      pages 0.5x).
 *   --lane tossup      (bucket TOSSUP) no recommendation existed — Derek's
 *                      per-cluster picks come in via --choices <file.json>:
 *                      [{ "edition_key": "...", "keeper": "<book id>" }, ...]
 *
 * FT guard (always, every lane): if any losing member carries
 * is_first_translation, the cluster is refused. Hiding a badge-holder has
 * public-claim consequences (first-translation-claims invariant) and is not
 * batch work — resolve those through the FT machinery, one by one.
 * SUSPECT_NOT_SAME has no apply lane on purpose: those are edition-key
 * collisions to investigate, not duplicates to hide.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/apply-keeper-choice-triage.mjs --lane mechanical            # dry-run
 *   node scripts/maintenance/apply-keeper-choice-triage.mjs --lane mechanical --apply --finalize
 *   node scripts/maintenance/apply-keeper-choice-triage.mjs --lane scored --only key1,key2 --apply
 *   node scripts/maintenance/apply-keeper-choice-triage.mjs --lane tossup --choices picks.json --apply
 *
 *   --report <path>   use a specific triage JSON (default: newest in scripts/output/)
 *   --only k1,k2 | @f subset by edition_key
 *   --apply           write (default is dry-run)
 *   --finalize        after writing: catalog sync + ISR revalidate + CF purge
 *
 * Writes: losers get { hidden:true, visible:false, duplicate_of: keeper,
 * hidden_reason: 'same_edition_duplicate', updated_at } (#3102 structured
 * shape); backup in scripts/output/; provenance row in dedup_apply_runs.
 * Downstream automated readers: Hetzner sync-worker refreshes collection
 * counts next cycle; sync-books-catalog propagates the hides to Supabase
 * (run by --finalize, else by the Hetzner supabase-sync cron). Dedup itself
 * reads duplicate_of at import time only — no unattended job acts on it.
 */
import { MongoClient } from 'mongodb';
import fs from 'node:fs';
import {
  TAKEDOWN_RX, flagValue, idFilter, resolveReport,
  writeBackup, recordRun, finalizeCaches, skipLine,
} from '../lib/triage-apply.mjs';

const LANE = flagValue('--lane');
const APPLY = process.argv.includes('--apply');
const FINALIZE = process.argv.includes('--finalize');
const only = idFilter('--only');
const LANE_BUCKET = { mechanical: 'MECHANICAL_KEEP', scored: 'SCORED_KEEP', tossup: 'TOSSUP' };
if (!LANE_BUCKET[LANE]) {
  console.error('--lane mechanical | scored | tossup is required.');
  process.exit(1);
}
let choices = null; // tossup: edition_key -> Derek's keeper pick
if (LANE === 'tossup') {
  const p = flagValue('--choices');
  if (!p) { console.error('--lane tossup needs --choices <file.json> ([{edition_key, keeper}]).'); process.exit(1); }
  choices = new Map(JSON.parse(fs.readFileSync(p, 'utf8')).map((c) => [c.edition_key, c.keeper]));
}

// Same signals as the triage script (keep in sync with
// scripts/audit/keeper-choice-triage.mjs — change both together).
const score = (m) => m.trans * 3 + m.ocr * 1 + m.pages * 0.5;
const dominates = (a, b) =>
  a.pages >= b.pages && a.ocr >= b.ocr && a.trans >= b.trans && a.quality >= b.quality &&
  (a.pages > b.pages || a.ocr > b.ocr || a.trans > b.trans || a.quality > b.quality);

const reportPath = resolveReport('keeper-choice-triage');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const rows = report.clusters.filter((c) => c.bucket === LANE_BUCKET[LANE]);
console.log(`${reportPath}\nlane ${LANE}: ${rows.length} clusters in report${only ? `, filtered by --only (${only.size})` : ''}${APPLY ? '' : '  [DRY-RUN]'}`);

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || 'bookstore');
const books = db.collection('books');

const now = new Date();
const backupDocs = [];
const ops = [];
const touchedPaths = [];
const applied = [];
let skipped = 0;

for (const cl of rows) {
  if (only && !only.has(cl.edition_key)) continue;
  const key = cl.edition_key;
  const keeperId = LANE === 'tossup' ? choices.get(key) : cl.keeper;
  if (!keeperId) { if (LANE === 'tossup') continue; skipLine(key, 'no keeper in report row'); skipped++; continue; }

  // ── live refetch of every member named by the report ──
  const live = await books.find(
    { id: { $in: cl.members.map((m) => m.id) } },
    { projection: { _id: 0, id: 1, title: 1, visible: 1, hidden_reason: 1, edition_key: 1, edition_key_quality: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, quality_score: 1, is_first_translation: 1, duplicate_of: 1 } },
  ).toArray();
  const ms = live.map((b) => ({
    id: b.id, title: b.title, visible: b.visible, reason: b.hidden_reason,
    key: b.edition_key, kq: b.edition_key_quality, dup: b.duplicate_of,
    pages: b.pages_count || 0, ocr: b.pages_ocr || 0, trans: b.pages_translated || 0,
    quality: b.quality_score || 0, ft: b.is_first_translation === true,
  }));

  // ── guards, all against live state ──
  if (ms.length !== cl.members.length) { skipLine(key, 'a member no longer exists'); skipped++; continue; }
  if (ms.some((m) => m.visible !== true)) { skipLine(key, 'a member is no longer visible (already resolved elsewhere?)'); skipped++; continue; }
  if (ms.some((m) => m.dup)) { skipLine(key, 'a member already carries duplicate_of'); skipped++; continue; }
  if (ms.some((m) => m.key !== key || m.kq !== 'full')) { skipLine(key, 'edition_key changed since triage (key repair?)'); skipped++; continue; }
  if (ms.some((m) => m.reason && TAKEDOWN_RX.test(m.reason))) { skipLine(key, 'takedown-shaped reason on a member'); skipped++; continue; }
  const keeper = ms.find((m) => m.id === keeperId);
  if (!keeper) { skipLine(key, `keeper ${keeperId} is not a member`); skipped++; continue; }
  const losers = ms.filter((m) => m.id !== keeperId);
  // FT guard — always. A hidden badge-holder is a public-claim change.
  const ftLosers = losers.filter((m) => m.ft);
  if (ftLosers.length) { skipLine(key, `FT badge on loser(s) ${ftLosers.map((m) => m.id).join(',')} — resolve via FT machinery, not here`); skipped++; continue; }
  // The recommendation must still hold on today's numbers.
  if (LANE === 'mechanical' && !losers.every((m) => dominates(keeper, m))) {
    skipLine(key, 'keeper no longer dominates — signals drifted, re-run triage'); skipped++; continue;
  }
  if (LANE === 'scored') {
    const sorted = [...ms].sort((a, b) => score(b) - score(a));
    const margin = (score(sorted[0]) - score(sorted[1])) / Math.max(score(sorted[0]), 1);
    if (sorted[0].id !== keeperId || margin < 0.1) {
      skipLine(key, `leader/margin drifted (leader ${sorted[0].id}, margin ${margin.toFixed(2)}) — re-run triage`); skipped++; continue;
    }
  }

  for (const m of losers) {
    backupDocs.push(live.find((b) => b.id === m.id));
    ops.push({ updateOne: {
      filter: { id: m.id, visible: true, duplicate_of: { $in: [null, ''] } },
      update: { $set: { hidden: true, visible: false, duplicate_of: keeperId, hidden_reason: 'same_edition_duplicate', updated_at: now } },
    } });
    applied.push(m.id);
    touchedPaths.push(`/book/${m.id}`);
  }
  touchedPaths.push(`/book/${keeperId}`); // the editions rail on the keeper changes too
  console.log(`  keep ${keeperId} [p${keeper.pages} o${keeper.ocr} t${keeper.trans}] — hide ${losers.map((m) => `${m.id}[p${m.pages} o${m.ocr} t${m.trans}]`).join(', ')}  (${key.slice(0, 50)})`);
}

console.log(`\n${LANE}: ${ops.length} hide(s) planned across ${applied.length ? new Set(touchedPaths).size : 0} pages, ${skipped} clusters skipped by live guards`);

if (APPLY && ops.length) {
  const backupPath = writeBackup(`apply-keeper-choice-${LANE}`, { report: reportPath, lane: LANE, docs: backupDocs });
  const r = await books.bulkWrite(ops, { ordered: false });
  console.log(`modified: ${r.modifiedCount} (backup: ${backupPath})`);
  await recordRun(db, {
    script: 'apply-keeper-choice-triage', lane: LANE, report: reportPath,
    planned: ops.length, modified: r.modifiedCount, skipped, ids: applied, backup: backupPath,
  });
  await finalizeCaches({ paths: [...touchedPaths, '/collections', '/browse'], execute: FINALIZE });
} else if (APPLY) {
  console.log('nothing to write.');
} else {
  console.log('dry-run only — add --apply to write.');
}
await client.close();
