#!/usr/bin/env node
/**
 * ⚠️ DEPRECATED — kept for historical reference only.
 *
 * Superseded by scripts/migration/bph-memorix-final-sync.mjs (PR #1975,
 * applied 2026-05-25). After that sync, bph_works is the authoritative
 * BPH catalog and Memorix is no longer pulled. There is no reason to
 * run this CSV importer against production again.
 *
 * If a future librarian needs to re-import from a fresh Memorix export,
 * use bph-memorix-final-sync.mjs (XML-based) — not this CSV path.
 *
 * Provenance / decision log: .claude/handoffs/2026-05-25-bph-memorix-sync-apply.md
 *
 * ─────────────────────────────────────────────────────────────────────────
 *
 * (Original docstring follows.)
 *
 * Import the full BPH catalog (Vitec Memorix export) into Supabase bph_works.
 *
 * Source: ~/Downloads/BibliotheekExportTest.csv (~28,813 rows, 49 columns).
 * Run AFTER expand-bph-works-schema.sql.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/import-bph-catalog.mjs --csv ~/Downloads/BibliotheekExportTest.csv [--dry-run] [--limit N]
 *
 * Idempotent: upserts on UBN. Run again to refresh from a newer export.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { parseArgs } from 'util';
import { normalizeStateShelfMark } from '../lib/bph-state-shelfmark.mjs';

const { values: args } = parseArgs({
  options: {
    csv: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});

if (!args.csv) {
  console.error('Usage: node import-bph-catalog.mjs --csv <path> [--dry-run] [--limit N]');
  process.exit(1);
}

const DRY_RUN = args['dry-run'];
const LIMIT = args.limit ? parseInt(args.limit, 10) : Infinity;
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---- CSV parsing (handles quoted fields with embedded commas, newlines, escaped quotes) ----
function parseCSV(text) {
  const rows = [];
  let cur = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else { inQ = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else if (c === '\r') {
        // skip
      } else cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}

function clean(s) {
  if (!s) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

function parseInt0(s) {
  const v = clean(s);
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

function parseYear(s) {
  const v = clean(s);
  if (!v) return null;
  const m = v.match(/(\d{4})/);
  return m ? parseInt(m[1], 10) : null;
}

function parseTimestamp(s) {
  const v = clean(s);
  if (!v) return null;
  // Vitec format: "2024-04-03 12:09:33.530749" — Postgres-friendly already
  const t = new Date(v.replace(' ', 'T') + 'Z');
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
}

async function main() {
  console.log(`Loading CSV: ${args.csv}`);
  const text = readFileSync(args.csv, 'utf8');
  const rows = parseCSV(text);
  const headers = rows.shift().map(h => h.trim());

  // Build header → index map (header strings are exact CSV column names)
  const idx = {};
  headers.forEach((h, i) => { idx[h] = i; });
  const get = (row, key) => clean(row[idx[key]]);

  console.log(`Headers (${headers.length}): ${headers.slice(0, 5).join(', ')}…`);
  console.log(`Rows: ${rows.length}`);

  // Drop blank trailing rows
  const data = rows.filter(r => r.some(c => c && c.trim()));
  console.log(`Non-empty rows: ${data.length}`);

  const records = [];
  let skipped = 0;
  for (const r of data) {
    const ubn = get(r, 'UBN');
    if (!ubn) { skipped++; continue; }
    records.push({
      ubn: ubn.replace(/\.0$/, ''),
      uuid: get(r, 'uuid'),
      picturae_barcode: get(r, 'Picturae barcode'),
      title: get(r, 'Title'),
      parallel_title: get(r, 'Parallel title'),
      uniform_title: get(r, 'Uniform title'),
      author: get(r, 'Author'),
      variant_author: get(r, "Variant author’s name") ?? get(r, "Variant author's name"),
      pseudonym: get(r, 'Pseudonym'),
      editor: get(r, 'Editor'),
      variant_editor: get(r, "Variant editor’s name") ?? get(r, "Variant editor's name"),
      place: get(r, 'Place of publication'),
      printer: get(r, 'Printer'),
      publisher: get(r, 'Publisher'),
      variant_printer: get(r, "Variant printer’s name") ?? get(r, "Variant printer's name"),
      variant_publisher: get(r, "Variant publisher’s name") ?? get(r, "Variant publisher's name"),
      year: parseYear(get(r, 'Year of publication')),
      shelf_mark: get(r, 'Shelf mark'),
      keywords: get(r, 'Keywords'),
      language: get(r, 'Language'),
      present_location: get(r, 'Present location'),
      series_title: get(r, 'Series title'),
      volume_title: get(r, 'Volume title'),
      bibliography: get(r, 'Bibliography'),
      remarks: get(r, 'Remarks'),
      internal_remarks: get(r, 'Internal remarks'),
      number_of_copies: parseInt0(get(r, 'Number of copies')),
      work_status: get(r, 'Status'),
      // Memorix answers this with a shelf mark OR with "neen" ("no") — the
      // source field is really "on loan from the ICN?". Normalise at the write
      // boundary so a re-import can't reintroduce the 19.9K bare "neen" rows
      // that scripts/maintenance/clear-neen-state-shelfmark.mjs cleaned up.
      state_shelf_mark: normalizeStateShelfMark(get(r, 'BPH State Collection shelf mark')),
      object_size_cm: get(r, 'Object size in cm'),
      provenance: get(r, 'Provenance'),
      binding: get(r, 'Binding'),
      bound_with: get(r, 'Bound with') ?? get(r, 'bound_with'),
      acquisition_date: get(r, 'Acquisition date'),
      price: get(r, 'Price'),
      acquisition_source: get(r, 'Acquisition source'),
      fully_approved: get(r, 'Fully approved'),
      delivered_to_customer: get(r, 'Delivered to customer'),
      publish_scan: get(r, 'Publish scan'),
      file_count: parseInt0(get(r, 'file-count')),
      thumbnail: get(r, 'thumbnail'),
      modified_time: parseTimestamp(get(r, 'modified_time')),
      modified_by_username: get(r, 'modified_by-username'),
      modified_by_email: get(r, 'modified_by-email'),
    });
    if (records.length >= LIMIT) break;
  }

  console.log(`Prepared ${records.length} records (skipped ${skipped} with no UBN)`);
  if (records[0]) {
    console.log('Sample:', JSON.stringify(records[0], null, 2).slice(0, 800));
  }

  if (DRY_RUN) {
    console.log('DRY RUN — exiting without writing.');
    return;
  }

  // Upsert in batches of 500
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < records.length; i += BATCH) {
    const slice = records.slice(i, i + BATCH);
    const { error } = await supabase
      .from('bph_works')
      .upsert(slice, { onConflict: 'ubn' });
    if (error) {
      console.error(`Batch ${i / BATCH} failed:`, error.message);
      console.error('First record in failing batch:', JSON.stringify(slice[0]).slice(0, 300));
      process.exit(1);
    }
    written += slice.length;
    if ((i / BATCH) % 5 === 0) console.log(`  upserted ${written}/${records.length}`);
  }
  console.log(`Done — upserted ${written} rows.`);
}

main().catch(err => { console.error(err); process.exit(1); });
