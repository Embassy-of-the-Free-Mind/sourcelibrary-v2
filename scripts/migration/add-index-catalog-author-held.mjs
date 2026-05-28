#!/usr/bin/env node
/**
 * Run the author-held migration via the Supabase IPv4 session-pooler.
 * (The direct host db.<ref>.supabase.co is IPv6-only; many devs have no
 * global IPv6 route, so we use the pooler instead.)
 *
 *   secret-lover run -- node scripts/migration/add-index-catalog-author-held.mjs
 *
 * Idempotent. Discovers the project's pooler region by trying common ones.
 */
import { readFileSync } from 'node:fs';
import pg from 'pg';

const RAW = process.env.SUPABASE_DB_URL;
if (!RAW) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }

const m = RAW.match(/^postgresql:\/\/([^:]+):(.+)@db\.([^.]+)\.supabase\.co:(\d+)\/(\w+)/);
if (!m) { console.error('SUPABASE_DB_URL has unexpected shape'); process.exit(1); }
const [, , password, ref, , db] = m;

// Session-mode pooler (port 5432) — supports DDL. Transaction pooler (6543)
// disallows session-level statements like ALTER TABLE.
const REGIONS = ['eu-central-1', 'eu-west-1', 'eu-west-2', 'us-east-1', 'us-east-2', 'us-west-1', 'ap-southeast-1', 'ap-northeast-1'];

const sql = readFileSync(new URL('./add-index-catalog-author-held.sql', import.meta.url), 'utf8');

async function tryRegion(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const client = new pg.Client({
    host, port: 5432, database: db,
    user: `postgres.${ref}`, password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 4000,
  });
  await client.connect();
  return client;
}

let client = null;
for (const region of REGIONS) {
  try {
    client = await tryRegion(region);
    console.log(`Connected via ${region} pooler`);
    break;
  } catch (e) {
    const msg = String(e).slice(0, 80);
    process.stdout.write(`  ${region}: ${msg}\n`);
  }
}
if (!client) { console.error('Could not connect via any pooler region'); process.exit(1); }

try {
  await client.query(sql);
  console.log('Migration applied.');

  const r = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'index_catalog_entries'
      AND column_name LIKE 'author_held%'
    ORDER BY column_name;
  `);
  console.log('New columns:');
  for (const row of r.rows) console.log(`  ${row.column_name}  ${row.data_type}`);
} catch (e) {
  console.error('Migration failed:', e.message);
  process.exit(1);
} finally {
  await client.end();
}
