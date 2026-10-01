#!/usr/bin/env node
/**
 * Apply add-site-pages-table.sql (#1180). Idempotent: CREATE IF NOT EXISTS /
 * CREATE OR REPLACE throughout, so re-running is safe.
 *
 *   node --env-file=.env.production.local scripts/migration/add-site-pages-table.mjs
 *
 * Env: SUPABASE_DB_URL (the direct-postgres URL — the service-role key cannot run DDL).
 */
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { SUPABASE_DB_URL } = process.env;
if (!SUPABASE_DB_URL) {
  console.error('Missing SUPABASE_DB_URL. The service-role key cannot run DDL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: SUPABASE_DB_URL });
await client.connect();
try {
  await client.query(fs.readFileSync(path.join(HERE, 'add-site-pages-table.sql'), 'utf8'));
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM site_pages');
  console.log(`site_pages ready (${n} rows); match_site_pages installed`);
} finally {
  await client.end();
}
