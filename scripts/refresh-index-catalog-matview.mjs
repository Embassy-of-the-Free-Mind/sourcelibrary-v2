#!/usr/bin/env node
/**
 * Refresh the materialized works view after a catalog backfill.
 *
 * mv_index_catalog_works is the read path for /api/catalogs/works (the deduped
 * works browser). It's a snapshot — run this after any script that writes to
 * index_catalog_entries (matching, author-entity, work-held, language) so the
 * browser reflects the new data.
 *
 * Calls the refresh_index_catalog_works() RPC (defined in
 * scripts/migration/add-index-catalog-works-matview.sql), which does
 * REFRESH MATERIALIZED VIEW CONCURRENTLY. No-op-safe if the matview is absent
 * (logs the error and exits 0 — the API falls back to the live view).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/refresh-index-catalog-matview.mjs
 */
const SUPA_URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
if (!SUPA_URL || !KEY) { console.error('SUPABASE_* missing'); process.exit(1); }

const r = await fetch(`${SUPA_URL}/rest/v1/rpc/refresh_index_catalog_works`, {
  method: 'POST',
  headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
  body: '{}',
});
if (r.ok) {
  console.log('mv_index_catalog_works refreshed.');
} else {
  console.warn(`refresh skipped (${r.status}): ${(await r.text()).slice(0, 200)}`);
  console.warn('If the matview/RPC are not yet created, run scripts/migration/add-index-catalog-works-matview.sql.');
}
