#!/usr/bin/env node
/**
 * Empty the "neen" answers out of bph_works.state_shelf_mark.
 *
 * WHY
 * ---
 * The column was imported from Memorix's `bruikleen_icn` — "is this copy on
 * loan from the ICN (the Dutch state collection)?" — which is answered either
 * with a real shelf mark (`PH3018`) or with the Dutch word for "no", `neen`.
 * The importer mapped the raw answer straight through, so ~19.9K of the 24K
 * populated rows carry a boolean *no* in a field the catalogue renders as a
 * shelf mark. José Bouman (BPH) asked for it emptied across the whole
 * catalogue (feedback, 2026-07-15):
 *
 *   "In the whole catalogue: if the field State Collection Shelfmark contains
 *    'neen' please delete, field should be empty"
 *
 * The write boundary is fixed too — both CSV importers now normalise through
 * scripts/lib/bph-state-shelfmark.mjs — so a re-import cannot undo this.
 *
 * WHAT IT DOES NOT TOUCH
 * ----------------------
 * `ja` ("yes", 31 rows) is equally not a shelf mark, but emptying it would
 * discard the only trace that those copies ARE on loan from the state
 * collection. That needs a librarian's decision, so it is reported and left.
 *
 * AUDIT TRAIL
 * -----------
 * bph_works is the BPH's catalogue of record: every mutation is traceable via
 * bph_works_revisions (see src/lib/bph-catalog.ts). This script writes a
 * revision row per affected UBN — with the real `from` value, so the change is
 * individually reversible — BEFORE touching the live rows, matching the
 * ordering applyWorkRevision uses: if the run dies midway the failure direction
 * is an orphaned revision, never an unrecorded edit. It is a bulk writer rather
 * than a caller of applyWorkRevision only because that helper is TypeScript and
 * does one row per three round-trips; the invariant it protects is preserved.
 *
 * A full backup of every affected row is written to scripts/output/ before any
 * write, so the sweep can be reversed from disk as well as from the revisions.
 *
 * Idempotent: re-running finds nothing to do.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/clear-neen-state-shelfmark.mjs            # dry run
 *   node scripts/maintenance/clear-neen-state-shelfmark.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { parseArgs } from 'util';
import { randomUUID } from 'crypto';
import { normalizeStateShelfMark } from '../lib/bph-state-shelfmark.mjs';

const { values: args } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    'chunk-size': { type: 'string', default: '500' },
  },
});

const APPLY = args.apply;
const CHUNK = parseInt(args['chunk-size'], 10);
const EDITOR = 'system:clear-neen-state-shelfmark';
const NOTE =
  'Bulk cleanup: "neen" (Dutch "no") was imported from Memorix bruikleen_icn ' +
  'into the State Collection shelf mark field. Requested by José Bouman, ' +
  'feedback 2026-07-15.';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const chunks = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

/**
 * Page through every row that could possibly be affected.
 *
 * The filter is `%nee%`, not `%neen%`: the normaliser also empties the shorter
 * spelling `nee` (10 rows), and a fetch narrower than the normaliser would
 * leave rows behind that the catalogue then hides at read time — a silent
 * disagreement between what is stored and what is shown. Deliberately loose:
 * real values that merely contain the letters (e.g. a hypothetical "Neenah")
 * are filtered out by comparing the normalised value, never by substring.
 */
async function fetchCandidates() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('bph_works')
      .select('ubn, state_shelf_mark, field_provenance')
      .ilike('state_shelf_mark', '%nee%')
      .range(from, from + 999);
    if (error) throw new Error(`fetch failed at offset ${from}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/** Rows the normaliser would actually change, with their target value. */
function pendingChanges(rows) {
  return rows
    .map((r) => ({ ...r, next: normalizeStateShelfMark(r.state_shelf_mark) }))
    .filter((r) => r.next !== r.state_shelf_mark);
}

async function main() {
  console.log(APPLY ? 'MODE: APPLY (writing)' : 'MODE: DRY RUN (use --apply to write)');

  const candidates = await fetchCandidates();
  console.log(`Rows whose state_shelf_mark mentions "nee":   ${candidates.length}`);

  const affected = pendingChanges(candidates);
  console.log(`Rows the normaliser changes:                 ${affected.length}`);
  if (affected.length !== candidates.length) {
    const untouched = candidates.length - affected.length;
    console.log(`Rows left alone (real values containing "neen"): ${untouched}`);
  }

  const transitions = new Map();
  for (const r of affected) {
    const key = `${JSON.stringify(r.state_shelf_mark)} -> ${JSON.stringify(r.next)}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
  console.log('\nTransitions:');
  for (const [k, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.toString().padStart(6)}  ${k}`);
  }

  // Report, don't touch: "ja" is the same class of defect but deleting it
  // destroys information (see the header).
  const { count: jaCount } = await sb
    .from('bph_works')
    .select('ubn', { count: 'exact', head: true })
    .eq('state_shelf_mark', 'ja');
  console.log(`\nNOT swept — state_shelf_mark = "ja" ("yes"): ${jaCount} rows (needs a librarian's call)`);

  if (affected.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = `scripts/output/neen-state-shelfmark-backup-${stamp}.json`;
  if (!APPLY) {
    console.log(`\nDRY RUN — would write ${affected.length} revision rows, update ${affected.length} rows,`);
    console.log(`and back up the prior values to ${backupPath}.`);
    return;
  }

  mkdirSync('scripts/output', { recursive: true });
  writeFileSync(
    backupPath,
    JSON.stringify(
      {
        generated: new Date().toISOString(),
        reason: NOTE,
        rows: affected.map((r) => ({
          ubn: r.ubn,
          state_shelf_mark: r.state_shelf_mark,
          field_provenance: r.field_provenance,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nBacked up ${affected.length} prior values → ${backupPath}`);

  // 1. History first. If this dies partway, the worst case is revision rows
  //    describing a change that never landed — recoverable, and detectable by
  //    comparing field_changes.from against the live row.
  const appliedAt = new Date().toISOString();
  let revisionsWritten = 0;
  for (const chunk of chunks(affected, CHUNK)) {
    const { error } = await sb.from('bph_works_revisions').insert(
      chunk.map((r) => ({
        id: randomUUID(),
        ubn: r.ubn,
        change_type: 'edit',
        field_changes: { state_shelf_mark: { from: r.state_shelf_mark, to: r.next, source: 'bulk cleanup' } },
        editor_email: EDITOR,
        proposed_by: null,
        source_pending_id: null,
        applied_at: appliedAt,
        note: NOTE,
      })),
    );
    if (error) throw new Error(`revision insert failed: ${error.message}`);
    revisionsWritten += chunk.length;
    process.stdout.write(`\r  revisions: ${revisionsWritten}/${affected.length}`);
  }
  console.log('');

  // 2. Then the live rows. Rows sharing a target value AND an empty
  //    field_provenance can go in one UPDATE per chunk; the handful with
  //    existing provenance are merged individually so another writer's entries
  //    survive (Supabase can't deep-merge JSONB from the client).
  const provenanceEntry = { source: 'bulk cleanup', edited_by: EDITOR, edited_at: appliedAt };
  const isEmptyProvenance = (fp) => !fp || typeof fp !== 'object' || Object.keys(fp).length === 0;

  const bulk = new Map();
  const perRow = [];
  for (const r of affected) {
    if (isEmptyProvenance(r.field_provenance)) {
      const key = JSON.stringify(r.next);
      if (!bulk.has(key)) bulk.set(key, { next: r.next, ubns: [] });
      bulk.get(key).ubns.push(r.ubn);
    } else {
      perRow.push(r);
    }
  }

  let updated = 0;
  for (const { next, ubns } of bulk.values()) {
    for (const chunk of chunks(ubns, CHUNK)) {
      const { error } = await sb
        .from('bph_works')
        .update({ state_shelf_mark: next, field_provenance: { state_shelf_mark: provenanceEntry } })
        .in('ubn', chunk);
      if (error) throw new Error(`bulk update failed: ${error.message}`);
      updated += chunk.length;
      process.stdout.write(`\r  updated: ${updated}/${affected.length}`);
    }
  }
  for (const r of perRow) {
    const { error } = await sb
      .from('bph_works')
      .update({
        state_shelf_mark: r.next,
        field_provenance: { ...r.field_provenance, state_shelf_mark: provenanceEntry },
      })
      .eq('ubn', r.ubn);
    if (error) throw new Error(`update failed for ubn=${r.ubn}: ${error.message}`);
    updated++;
    process.stdout.write(`\r  updated: ${updated}/${affected.length}`);
  }
  console.log('');

  // 3. Verify by re-reading the database and re-asking the normaliser, rather
  //    than trusting our own counters or a substring count (a real shelf mark
  //    containing those letters would fail a naive `%nee%` check forever).
  const remaining = pendingChanges(await fetchCandidates());

  console.log(`\nRevisions written: ${revisionsWritten}`);
  console.log(`Rows updated:      ${updated}`);
  console.log(`Rows still needing the change: ${remaining.length} (expect 0)`);
  if (remaining.length !== 0) {
    console.error('VERIFICATION FAILED — sample:', remaining.slice(0, 5).map((r) => r.ubn).join(', '));
    process.exit(1);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
