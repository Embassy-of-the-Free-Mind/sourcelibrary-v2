#!/usr/bin/env node
/**
 * Apply add-site-pages-table.sql (#1180). Idempotent: CREATE IF NOT EXISTS /
 * CREATE OR REPLACE throughout, so re-running is safe.
 *
 *   node --env-file=.env.production.local scripts/migration/add-site-pages-table.mjs [file.sql]
 *
 * With a file name (beside this script) it applies that migration instead,
 * e.g. add-site-pages-names.sql (#5945), which is additive and idempotent too.
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
  const file = path.basename(process.argv[2] || 'add-site-pages-table.sql');
  await client.query(fs.readFileSync(path.join(HERE, file), 'utf8'));
  const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM site_pages');
  console.log(`${file} applied; site_pages holds ${n} rows`);
} finally {
  await client.end();
}
