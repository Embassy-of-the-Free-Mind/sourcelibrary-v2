#!/usr/bin/env node
/**
 * Translate the "ja" answers in bph_works.state_shelf_mark to "yes".
 *
 * WHY
 * ---
 * Sibling of clear-neen-state-shelfmark.mjs, which emptied the Dutch "no"
 * answers on 30 July and deliberately left "ja" ("yes") alone because deleting
 * it would have discarded the only record that those copies ARE on loan from
 * the state collection. That was left as a librarian's decision, and surfaced
 * as a bucket in the catalogue worklist so it would actually get asked.
 *
 * It got asked, and answered — José Bouman (BPH), 2026-08-12:
 *
 *   "State Collection shelf mark still reads 'ja' — These items will also have
 *    in the remark-field the note 'In: [+ author-title]'. […] This set of 31 is
 *    owned by the State, therefore the 'Ja'. Better change it to 'yes'."
 *
 * So the value is kept and translated, not emptied. The write boundary is
 * updated in the same change (src/lib/bph-state-shelfmark.ts and its scripts
 * twin now map ja→yes), so a Memorix re-import cannot put the Dutch back —
 * without that half, this sweep would silently undo itself on the next import.
 *
 * AUDIT TRAIL
 * -----------
 * bph_works is the BPH's catalogue of record: every mutation is traceable via
 * bph_works_revisions (see src/lib/bph-catalog.ts). This writes a revision row
 * per affected UBN — with the real `from` value, so each change is individually
 * reversible — BEFORE touching the live rows, matching the ordering
 * applyWorkRevision uses: if the run dies midway the failure direction is an
 * orphaned revision, never an unrecorded edit. It is a bulk writer rather than
 * a caller of applyWorkRevision only because that helper is TypeScript; the
 * invariant it protects is preserved.
 *
 * A backup of every affected row is written to scripts/output/ before any write.
 *
 * Idempotent: re-running finds nothing to do.
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/translate-ja-state-shelfmark.mjs
 *   node --env-file=.env.production.local scripts/maintenance/translate-ja-state-shelfmark.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';
import { parseArgs } from 'util';
import { randomUUID } from 'crypto';
import { normalizeStateShelfMark } from '../lib/bph-state-shelfmark.mjs';

const { values: args } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });
const APPLY = args.apply;
const EDITOR = 'system:translate-ja-state-shelfmark';
const NOTE =
  'Bulk cleanup: "ja" (Dutch "yes") was imported from Memorix bruikleen_icn into ' +
  'the State Collection shelf mark field. Kept and translated to "yes" rather ' +
  'than emptied — it records that the copy IS on loan from the state ' +
  'collection. Decision by José Bouman, 2026-08-12.';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * Page through every row that could be affected. Filter is `%ja%` — looser than
 * the normaliser on purpose, so nothing is left behind that the read path would
 * then render differently from what is stored. Rows that merely CONTAIN the
 * letters ("Jakarta") are excluded by comparing the normalised value, never by
 * substring.
 */
async function fetchCandidates() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb
      .from('bph_works')
      .select('ubn, uuid, state_shelf_mark, field_provenance')
      .ilike('state_shelf_mark', '%ja%')
      .range(from, from + 999);
    if (error) throw new Error(`fetch failed at offset ${from}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

function pendingChanges(rows) {
  return rows
    .map((r) => ({ ...r, next: normalizeStateShelfMark(r.state_shelf_mark) }))
    .filter((r) => r.next !== r.state_shelf_mark);
}

async function main() {
  console.log(APPLY ? 'MODE: APPLY (writing)' : 'MODE: DRY RUN (use --apply to write)');

  const candidates = await fetchCandidates();
  console.log(`Rows whose state_shelf_mark mentions "ja":  ${candidates.length}`);

  const affected = pendingChanges(candidates);
  console.log(`Rows the normaliser changes:               ${affected.length}`);
  const untouched = candidates.length - affected.length;
  if (untouched > 0) {
    // Compare by key, not object identity — pendingChanges() returns spread
    // copies, so `affected.includes(candidate)` is always false and would
    // report every candidate as "kept". A wrong diagnostic here is worse than
    // none: it reads as evidence that the filter is over-broad.
    const changedKeys = new Set(affected.map((r) => r.ubn ?? r.uuid));
    console.log(`Rows left alone (real values containing "ja"): ${untouched}`);
    for (const r of candidates.filter((c) => !changedKeys.has(c.ubn ?? c.uuid)).slice(0, 10)) {
      console.log(`    kept: ${JSON.stringify(r.state_shelf_mark)}  (ubn ${r.ubn})`);
    }
  }

  const transitions = new Map();
  for (const r of affected) {
    const key = `${JSON.stringify(r.state_shelf_mark)} -> ${JSON.stringify(r.next)}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);
  }
  console.log('\nTransitions:');
  for (const [k, n] of [...transitions.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(6)}  ${k}`);
  }

  if (affected.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = `scripts/output/ja-state-shelfmark-backup-${stamp}.json`;
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
          uuid: r.uuid,
          state_shelf_mark: r.state_shelf_mark,
          field_provenance: r.field_provenance,
        })),
      },
      null,
      2,
    ),
  );
  console.log(`\nBacked up ${affected.length} prior values → ${backupPath}`);

  // 1. History first — see AUDIT TRAIL above.
  const appliedAt = new Date().toISOString();
  const { error: revErr } = await sb.from('bph_works_revisions').insert(
    affected.map((r) => ({
      id: randomUUID(),
      ubn: r.ubn,
      change_type: 'edit',
      field_changes: {
        state_shelf_mark: { from: r.state_shelf_mark, to: r.next, source: 'bulk cleanup' },
      },
      editor_email: EDITOR,
      proposed_by: null,
      source_pending_id: null,
      applied_at: appliedAt,
      note: NOTE,
    })),
  );
  if (revErr) throw new Error(`revision insert failed: ${revErr.message}`);
  console.log(`Revisions written: ${affected.length}`);

  // 2. Then the live rows, one at a time — 31 rows, and each needs its own
  //    field_provenance merged rather than overwritten (Supabase cannot
  //    deep-merge JSONB from the client, and other writers' entries must live).
  const provenanceEntry = { source: 'bulk cleanup', edited_by: EDITOR, edited_at: appliedAt };
  let updated = 0;
  for (const r of affected) {
    const existing = r.field_provenance && typeof r.field_provenance === 'object' ? r.field_provenance : {};
    const { error } = await sb
      .from('bph_works')
      .update({
        state_shelf_mark: r.next,
        field_provenance: { ...existing, state_shelf_mark: provenanceEntry },
      })
      .eq('ubn', r.ubn);
    if (error) throw new Error(`update failed for ubn=${r.ubn}: ${error.message}`);
    updated++;
  }
  console.log(`Rows updated:      ${updated}`);

  // 3. Verify by re-reading, not by trusting our own counters.
  const remaining = pendingChanges(await fetchCandidates());
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
