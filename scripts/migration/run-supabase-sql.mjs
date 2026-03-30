#!/usr/bin/env node
/**
 * Run SQL migration against Supabase Postgres directly.
 * Usage: node scripts/migration/run-supabase-sql.mjs [sql-file]
 */

import { readFileSync } from 'fs';
import pg from 'pg';

const { Client } = pg;

const client = new Client({
  host: process.env.PGHOST || 'db.ykhxaecbbxaaqlujuzde.supabase.co',
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE || 'postgres',
  ssl: { rejectUnauthorized: false },
});

if (!process.env.PGPASSWORD) {
  console.error('Missing PGPASSWORD env var');
  process.exit(1);
}

const sqlFile = process.argv[2] || 'scripts/migration/supabase-analytics-schema.sql';
const fullSql = readFileSync(sqlFile, 'utf-8');

// Split into individual statements, respecting $$ dollar-quoting
function splitStatements(sql) {
  const results = [];
  let current = '';
  let inDollarQuote = false;

  for (const line of sql.split('\n')) {
    current += line + '\n';

    // Track dollar-quoting
    const dollarMatches = line.match(/\$\$/g);
    if (dollarMatches) {
      for (const _ of dollarMatches) inDollarQuote = !inDollarQuote;
    }

    // Statement ends at semicolon at end of line, but not inside $$
    if (!inDollarQuote && line.trimEnd().endsWith(';')) {
      const trimmed = current.trim();
      const withoutComments = trimmed.replace(/--.*$/gm, '').trim();
      if (withoutComments.length > 0) results.push(trimmed);
      current = '';
    }
  }
  // Handle trailing content
  if (current.trim().replace(/--.*$/gm, '').trim().length > 0) {
    results.push(current.trim());
  }
  return results;
}

const statements = splitStatements(fullSql);

console.log(`Running ${statements.length} SQL statements from ${sqlFile}...\n`);

await client.connect();
// Escalate to postgres role (cli_login_postgres can SET ROLE postgres)
await client.query('SET ROLE postgres');
console.log('Escalated to postgres role\n');

let success = 0;
let skipped = 0;
let failed = 0;

for (const stmt of statements) {
  const label = stmt.split('\n').find(l => !l.startsWith('--') && l.trim())?.trim().slice(0, 80) || stmt.slice(0, 80);

  try {
    await client.query(stmt);
    console.log(`  OK: ${label}`);
    success++;
  } catch (e) {
    if (e.message.includes('already exists') || e.message.includes('duplicate')) {
      console.log(`  SKIP (exists): ${label}`);
      skipped++;
    } else {
      console.error(`  FAIL: ${label}`);
      console.error(`    ${e.message}`);
      failed++;
    }
  }
}

await client.end();
console.log(`\nDone: ${success} succeeded, ${skipped} skipped, ${failed} failed`);
if (failed > 0) process.exit(1);
