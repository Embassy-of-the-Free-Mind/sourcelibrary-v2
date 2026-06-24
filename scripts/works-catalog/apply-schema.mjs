#!/usr/bin/env node
// Apply the works-catalog schema (#2453). Idempotent (IF NOT EXISTS throughout).
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { pgClient } from './lib.mjs';

const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'schema.sql'), 'utf8');
const client = pgClient();
await client.connect();
await client.query(sql);
const r = await client.query(`
  select relname, n_live_tup from pg_stat_user_tables
  where relname in ('works','work_sources','work_holdings') order by relname`);
for (const row of r.rows) console.log(`${row.relname}: ${row.n_live_tup} rows`);
await client.end();
console.log('Schema applied.');
