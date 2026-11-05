#!/usr/bin/env node
/**
 * Turn SUPABASE_DB_URL into libpq settings, without ever printing the password.
 *
 * PRIOR ART: scripts/workers/lib/count-docs.mjs — same "tiny node helper for a
 * bash backup script" shape; nothing in scripts/ converts a Postgres URL for libpq.
 *
 * WHY: libpq cannot parse SUPABASE_DB_URL — the password holds characters that
 * break its URI parser — but Node's WHATWG URL parser reads it fine. So the bash
 * backup script asks this helper for the pieces instead of handing the URL to
 * pg_dump. The port is forced to 5432 (session mode / direct Postgres): 6543 is
 * the transaction pooler, which cannot hold the one long snapshot pg_dump needs.
 *
 * Two modes:
 *   env <pgpass-path>  writes a 0600 PGPASSFILE at <pgpass-path> and prints
 *                      `export PGHOST=… PGPORT=… PGUSER=… PGDATABASE=… PGPASSFILE=…`
 *                      for the caller to eval. The password is ONLY in the file.
 *   redact             a stdin→stdout filter that masks the password, user and
 *                      host in anything libpq/pg_dump writes to stderr, so a
 *                      connection error can be logged without leaking them.
 */
import { writeFileSync, chmodSync } from 'fs';
import { createInterface } from 'readline';

const raw = process.env.SUPABASE_DB_URL;
if (!raw) { console.error('SUPABASE_DB_URL is not set'); process.exit(2); }
let u;
try { u = new URL(raw); } catch { console.error('SUPABASE_DB_URL does not parse as a URL'); process.exit(2); }

const host = u.hostname;
const user = decodeURIComponent(u.username);
const password = decodeURIComponent(u.password);
const database = decodeURIComponent(u.pathname.replace(/^\//, '')) || 'postgres';
const PORT = '5432';

const mode = process.argv[2];
if (mode === 'env') {
  const file = process.argv[3];
  if (!file) { console.error('usage: pg-env-from-url.mjs env <pgpass-path>'); process.exit(2); }
  // .pgpass fields escape ':' and '\' with a backslash.
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/:/g, '\\:');
  writeFileSync(file, `${esc(host)}:${PORT}:${esc(database)}:${esc(user)}:${esc(password)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
  const q = (s) => `'${s.replace(/'/g, `'\\''`)}'`;
  process.stdout.write(
    `export PGHOST=${q(host)} PGPORT=${PORT} PGUSER=${q(user)} PGDATABASE=${q(database)} PGPASSFILE=${q(file)} PGSSLMODE=require\n`,
  );
} else if (mode === 'redact') {
  const secrets = [password, encodeURIComponent(password), user, host].filter((s) => s && s.length >= 4);
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    let out = line;
    for (const s of secrets) out = out.split(s).join('<redacted>');
    process.stdout.write(out + '\n');
  }
} else {
  console.error('usage: pg-env-from-url.mjs env <pgpass-path> | redact');
  process.exit(2);
}
