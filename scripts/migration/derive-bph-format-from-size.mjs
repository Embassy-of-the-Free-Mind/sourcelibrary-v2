#!/usr/bin/env node
/**
 * Derive `bibliographic_format` for bph_works rows that have `object_size_cm`
 * but no format yet. Writes provenance into `field_provenance.bibliographic_format`
 * so Paul's team can tell a derived value from a librarian-entered one.
 *
 * Format buckets (height in cm, the first dimension in the "HxWxD" string):
 *   folio        ≥35
 *   quarto       25-34.99
 *   octavo       20-24.99
 *   duodecimo    17-19.99
 *   sextodecimo  15-16.99
 *   smaller      <15
 *
 * These are the standard library-cataloging fall-backs used when the
 * signature collation isn't known. Real format determination needs the
 * gathering structure (A-Ff4 etc.), which requires physical inspection;
 * this is explicitly an estimate, recorded as such in field_provenance.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/derive-bph-format-from-size.mjs [--dry-run] [--limit N]
 *
 * Idempotent: only writes rows where bibliographic_format IS NULL or the
 * existing provenance source is `derived_from_size` (so re-running picks up
 * the latest threshold tweak without clobbering manual edits).
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    limit: { type: 'string' },
  },
});

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

function parseHeightCm(raw) {
  if (!raw) return null;
  // Vitec format is "HxWxD" with comma decimals: "16,5x11,2x6,2"
  const norm = String(raw).replace(/,/g, '.');
  const m = norm.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = parseFloat(m[1]);
  return Number.isFinite(h) && h > 0 ? h : null;
}

function bucket(heightCm) {
  if (heightCm >= 35) return 'folio';
  if (heightCm >= 25) return 'quarto';
  if (heightCm >= 20) return 'octavo';
  if (heightCm >= 17) return 'duodecimo';
  if (heightCm >= 15) return 'sextodecimo';
  return 'smaller';
}

async function fetchAllCandidates() {
  // Only consider rows that lack a format OR whose format is itself derived
  // (re-deriving lets us refine thresholds without losing manual edits).
  const all = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('bph_works')
      .select('ubn, object_size_cm, bibliographic_format, field_provenance')
      .not('object_size_cm', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    if (all.length >= LIMIT) break;
  }
  return all.slice(0, LIMIT);
}

async function main() {
  console.log('Fetching candidate rows…');
  const rows = await fetchAllCandidates();
  console.log(`  ${rows.length} rows have object_size_cm`);

  const now = new Date().toISOString();
  const updates = [];
  const dist = { folio: 0, quarto: 0, octavo: 0, duodecimo: 0, sextodecimo: 0, smaller: 0 };
  let skippedManual = 0;
  let skippedNoHeight = 0;

  for (const r of rows) {
    const existingSource = r.field_provenance?.bibliographic_format?.source;
    if (r.bibliographic_format && existingSource && existingSource !== 'derived_from_size') {
      skippedManual++;
      continue;
    }
    const h = parseHeightCm(r.object_size_cm);
    if (h == null) { skippedNoHeight++; continue; }

    const fmt = bucket(h);
    dist[fmt]++;

    const newProvenance = {
      ...(r.field_provenance || {}),
      bibliographic_format: {
        source: 'derived_from_size',
        evidence: `height ${h}cm from object_size_cm "${r.object_size_cm}"`,
        derived_at: now,
      },
    };

    updates.push({
      ubn: r.ubn,
      bibliographic_format: fmt,
      field_provenance: newProvenance,
    });
  }

  console.log('Distribution:', JSON.stringify(dist, null, 2));
  console.log(`Skipped: ${skippedManual} manual, ${skippedNoHeight} unparseable height`);
  console.log(`Will write: ${updates.length} rows`);

  if (DRY_RUN) {
    console.log('DRY RUN — no writes');
    if (updates[0]) console.log('Sample update:', JSON.stringify(updates[0], null, 2));
    return;
  }

  // Upsert in batches; onConflict on UBN replaces the format + provenance and
  // leaves every other column untouched (Supabase merges on the columns we
  // include in the row).
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const { error } = await supabase
      .from('bph_works')
      .upsert(slice, { onConflict: 'ubn' });
    if (error) {
      console.error(`Batch ${i / BATCH} failed:`, error.message);
      process.exit(1);
    }
    written += slice.length;
    if ((i / BATCH) % 4 === 0) console.log(`  ${written}/${updates.length}`);
  }
  console.log(`Done — wrote ${written} rows.`);
}

main().catch(err => { console.error(err); process.exit(1); });
