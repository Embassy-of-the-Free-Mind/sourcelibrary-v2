#!/usr/bin/env node
/**
 * Backup the BPH catalogue from Supabase to gzipped JSON.
 *
 * The BPH catalogue (bph_works) is the system of record for the Bibliotheca
 * Philosophica Hermetica — editors (Paul, José) now write to it directly. That
 * makes it critical data with three layers of protection:
 *
 *   1. bph_works_revisions — append-only, every field change with from→to,
 *      editor, source citation, timestamp. Logical per-field rollback lives
 *      here (replay any revision's `from`).
 *   2. Supabase's own managed backups / PITR.
 *   3. THIS script — an independent, offsite-from-Supabase JSON snapshot for
 *      catastrophic restore (table drop, mass corruption, account loss).
 *
 * Exports three tables in full (paginated, Supabase caps at 1000 rows/req):
 *   - bph_works              (the catalogue)
 *   - bph_works_revisions    (the audit trail)
 *   - bph_works_pending_changes (contributor queue)
 *
 * Usage:
 *   node scripts/maintenance/backup-bph-catalog.mjs --out /root/backups/bph-catalog-latest
 *
 * Restore (catalogue table example):
 *   gunzip -c bph_works.json.gz | node scripts/maintenance/restore-bph-catalog.mjs  (not yet built —
 *   for now the gz files are a plain JSON array per table, re-importable with a small upsert loop).
 */

import { createClient } from '@supabase/supabase-js';
import { gzipSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const TABLES = ['bph_works', 'bph_works_revisions', 'bph_works_pending_changes'];
const PAGE = 1000;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function dumpTable(sb, table) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb.from(table).select('*').range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }
  const outDir = arg('--out', join(process.cwd(), 'scripts', 'output', 'bph-catalog-backup'));
  mkdirSync(outDir, { recursive: true });
  const sb = createClient(url, key);

  const manifest = { tables: {}, exported_at: new Date().toISOString() };
  let total = 0;
  for (const table of TABLES) {
    const rows = await dumpTable(sb, table);
    const gz = gzipSync(Buffer.from(JSON.stringify(rows)));
    writeFileSync(join(outDir, `${table}.json.gz`), gz);
    manifest.tables[table] = { rows: rows.length, bytes_gz: gz.length };
    total += rows.length;
    console.log(`  ${table}: ${rows.length} rows → ${(gz.length / 1024).toFixed(0)} KB gz`);
  }
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`BPH catalogue backup complete → ${outDir} (${total} rows across ${TABLES.length} tables)`);
}

main().catch((e) => {
  console.error('BPH catalogue backup FAILED:', e.message);
  process.exit(1);
});
