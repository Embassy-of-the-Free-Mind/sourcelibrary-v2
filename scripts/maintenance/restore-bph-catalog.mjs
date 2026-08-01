#!/usr/bin/env node
/**
 * Restore the BPH catalogue from a backup-bph-catalog.mjs snapshot.
 *
 * The missing half of the backup story. `backup-bph-catalog.mjs` has produced
 * nightly gzipped JSON since May and its own docstring admitted the restore
 * side was "not yet built" — which meant 30MB of snapshots nobody could put
 * back without writing an upsert loop under pressure. A backup you have never
 * restored is a hypothesis, not a backup.
 *
 * THE TRAP THIS EXISTS TO HANDLE: `bph_works` has eight GENERATED columns
 * (search_norm, title_norm, author_norm, editor_norm, place_norm, printer_norm,
 * publisher_norm, shelf_mark_norm). Postgres rejects any INSERT that names
 * them, so the obvious "read the JSON, upsert it back" loop fails on row one.
 * They are also pure functions of other columns, so dropping them loses
 * nothing — the database recomputes them. PostgREST does not expose
 * information_schema, so the list below is static; the write loop additionally
 * parses Postgres's own error and drops any column it names, so a generated
 * column added years from now degrades to a warning instead of a failed
 * restore at the worst possible moment.
 *
 * SAFETY. Dry-run by default: it reads the snapshot, checks it against the
 * live schema and reports what it would write, touching nothing. Writing
 * requires --apply. Restoring over a live table additionally requires
 * --i-understand-this-overwrites-live-data, because the sane emergency move is
 * usually to restore into a scratch table first and diff.
 *
 * Usage:
 *   # Rehearse (safe, no writes):
 *   node scripts/maintenance/restore-bph-catalog.mjs --dir <backup-dir>
 *
 *   # Restore into a scratch table to inspect before committing to anything:
 *   node scripts/maintenance/restore-bph-catalog.mjs --dir <d> --table bph_works \
 *     --into bph_works_restore_drill --apply
 *
 *   # Real recovery, over the live table:
 *   node scripts/maintenance/restore-bph-catalog.mjs --dir <d> --table bph_works \
 *     --apply --i-understand-this-overwrites-live-data
 *
 * Upserts on the primary key (`id`), so it repairs a partially-damaged table
 * without deleting rows that are fine. It never DELETEs: a row present live but
 * absent from the snapshot is reported, never removed, because "created after
 * the backup" and "should not exist" look identical from here and only a human
 * can tell them apart.
 *
 * Backups live on the Hetzner box at /root/backups/bph-catalog-{latest,weekly/<date>}
 * and are swept offsite nightly by restic (encrypted, 7 daily / 8 weekly / 12
 * monthly). Fetch one with:
 *   scp -r root@46.224.122.120:/root/backups/bph-catalog-latest /tmp/
 */

import { createClient } from '@supabase/supabase-js';
import { gunzipSync } from 'node:zlib';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
  options: {
    dir: { type: 'string' },
    table: { type: 'string', default: 'bph_works' },
    into: { type: 'string' },
    apply: { type: 'boolean', default: false },
    'i-understand-this-overwrites-live-data': { type: 'boolean', default: false },
    'batch-size': { type: 'string', default: '500' },
    limit: { type: 'string' },
  },
});

const SOURCE_TABLE = args.table;
const TARGET_TABLE = args.into || SOURCE_TABLE;
const APPLY = args.apply;
const OVERWRITE_OK = args['i-understand-this-overwrites-live-data'];
const BATCH = parseInt(args['batch-size'], 10);
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;

if (!args.dir) {
  console.error('Usage: node scripts/maintenance/restore-bph-catalog.mjs --dir <backup-dir> [--table T] [--into T2] [--apply]');
  process.exit(1);
}

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
 * Columns `bph_works` will refuse on INSERT because Postgres computes them.
 *
 * Static by necessity: PostgREST exposes neither information_schema nor a
 * column list for an EMPTY table, and an empty target is precisely the restore
 * case (table dropped and recreated). An earlier version of this script learned
 * the schema by reading one existing row, which worked in rehearsal and failed
 * on the first real drill against an empty table — the one scenario it existed
 * for. The write loop's adaptive retry is what actually keeps this honest;
 * this list only saves it a round-trip.
 */
const KNOWN_GENERATED = new Set([
  'search_norm', 'title_norm', 'author_norm', 'editor_norm',
  'place_norm', 'printer_norm', 'publisher_norm', 'shelf_mark_norm',
]);

async function main() {
  console.log(APPLY ? 'MODE: APPLY (writing)' : 'MODE: DRY RUN (use --apply to write)');
  console.log(`snapshot dir : ${args.dir}`);
  console.log(`source table : ${SOURCE_TABLE}`);
  console.log(`target table : ${TARGET_TABLE}${TARGET_TABLE === SOURCE_TABLE ? '  ← LIVE TABLE' : '  (scratch)'}`);

  if (APPLY && TARGET_TABLE === SOURCE_TABLE && !OVERWRITE_OK) {
    console.error(
      '\nREFUSING: --apply against the live table needs --i-understand-this-overwrites-live-data.\n' +
      'Prefer restoring into a scratch table first (--into bph_works_restore_drill) and diffing.',
    );
    process.exit(1);
  }

  const path = join(args.dir, `${SOURCE_TABLE}.json.gz`);
  if (!existsSync(path)) {
    console.error(`\nNo snapshot for "${SOURCE_TABLE}" at ${path}`);
    process.exit(1);
  }

  const manifestPath = join(args.dir, 'manifest.json');
  if (existsSync(manifestPath)) {
    const m = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`snapshot taken: ${m.exported_at}`);
    const expected = m.tables?.[SOURCE_TABLE]?.rows;
    if (expected != null) console.log(`manifest says : ${expected} rows`);
  }

  const rows = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8'));
  if (!Array.isArray(rows)) throw new Error('snapshot is not a JSON array');
  console.log(`rows in file  : ${rows.length}`);
  if (rows.length === 0) {
    console.log('\nNothing to restore.');
    return;
  }

  // Generated columns must be stripped or every INSERT fails; the database
  // recomputes them from the columns we do restore.
  const snapshotCols = new Set(Object.keys(rows[0]));
  const dropped = [...snapshotCols].filter((c) => KNOWN_GENERATED.has(c));
  const keep = [...snapshotCols].filter((c) => !dropped.includes(c));
  console.log(`columns       : ${keep.length} restored, ${dropped.length} dropped`);
  if (dropped.length) console.log(`  dropped (generated / not on target): ${dropped.join(', ')}`);

  const payload = rows.slice(0, LIMIT).map((r) => {
    const o = {};
    for (const c of keep) o[c] = r[c];
    return o;
  });

  // Report rows that exist live but not in the snapshot. Never delete them —
  // "created after the backup" and "should not exist" are indistinguishable here.
  const { count: liveCount } = await sb
    .from(TARGET_TABLE)
    .select('id', { count: 'exact', head: true });
  console.log(`rows live now : ${liveCount ?? 0} in ${TARGET_TABLE}`);
  if (liveCount != null && liveCount > payload.length) {
    console.log(
      `NOTE: ${liveCount - payload.length} more rows live than in the snapshot. ` +
      'They will be left alone (this script never deletes) — check whether they postdate the backup.',
    );
  }

  if (!APPLY) {
    console.log(`\nDRY RUN — would upsert ${payload.length} rows into ${TARGET_TABLE} on primary key "id".`);
    console.log('Re-run with --apply to write.');
    return;
  }

  // Adaptive write. The static list above is correct today, but a generated
  // column added years from now would otherwise hard-fail a restore at exactly
  // the moment nobody can afford to debug it. Postgres names the offending
  // column in the error ("cannot insert a non-DEFAULT value into column X"),
  // so drop it and retry rather than dying.
  const runtimeDropped = [];
  const stripColumn = (col) => {
    runtimeDropped.push(col);
    for (const row of payload) delete row[col];
  };

  let written = 0;
  for (const chunk of chunks(payload, BATCH)) {
    for (let attempt = 0; ; attempt++) {
      const { error } = await sb.from(TARGET_TABLE).upsert(chunk, { onConflict: 'id' });
      if (!error) break;
      const namedCol = /column "?([A-Za-z0-9_]+)"?/.exec(error.message || '')?.[1];
      // Two recoverable shapes: a column Postgres computes (generated), and a
      // column the snapshot has but this target does not (schema drift since
      // the backup). Both mean "drop it and carry on" — losing a column beats
      // losing the restore.
      const recoverable = /non-DEFAULT value|generated column|does not exist|could not find/i.test(error.message || '');
      if (namedCol && recoverable && attempt < 40 && keep.includes(namedCol)) {
        console.log(`\n  note: dropping "${namedCol}" (${error.message.slice(0, 80)}…) and retrying`);
        stripColumn(namedCol);
        continue;
      }
      throw new Error(`upsert failed at row ${written}: ${error.message}`);
    }
    written += chunk.length;
    process.stdout.write(`\r  restored: ${written}/${payload.length}`);
  }
  console.log('');
  if (runtimeDropped.length) {
    console.log(`Columns dropped at runtime (update the known-generated list): ${runtimeDropped.join(', ')}`);
  }

  const { count: after } = await sb
    .from(TARGET_TABLE)
    .select('id', { count: 'exact', head: true });
  console.log(`\nRows written  : ${written}`);
  console.log(`Rows in table : ${after} (was ${liveCount ?? 0})`);
  if (after < payload.length) {
    console.error('VERIFICATION FAILED — fewer rows present than restored.');
    process.exit(1);
  }
  console.log('Done.');
}

main().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
