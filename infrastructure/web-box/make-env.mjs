#!/usr/bin/env node
// Write the reader-origin box's runtime environment (#8384) to stdout, from an ALLOWLIST.
//
// PRIOR ART: the #8374 shadow run's run-env.mjs (job scratch, not in the repo) — the same
// allowlist, written as an EnvironmentFile for systemd instead of a spawn() env.
//
// Run where the production env file lives, and pipe straight to the box, so no value is
// ever printed or written on disk outside the box:
//
//   node --env-file=.env.production.local infrastructure/web-box/make-env.mjs \
//     | ssh root@<box> 'install -m 0640 -g slweb /dev/stdin /etc/sl-web/env'
//
// Trap 4: reader pages need only Mongo (read), Supabase (anon key, read) and an AUTH_SECRET
// to decode no session at all. No model, email, payment, storage-write or service-role key
// is copied, so a page that needs one fails loudly on the box instead of spending.
// AUTH_SECRET is fresh, never production's: a signed-in reader is never sent here (the
// Worker sends only requests without a session cookie), and a stray cookie must not decode.
import { randomBytes } from 'node:crypto';

const need = ['MONGODB_URI', 'MONGODB_DB', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`make-env: missing ${missing.join(', ')} — refusing to write a partial env`);
  process.exit(1);
}

const uri = new URL(process.env.MONGODB_URI);
// As in #8374: reads go to a secondary, never the primary the pipeline writes to.
uri.searchParams.set('readPreference', process.env.BOX_READ_PREFERENCE || 'secondary');
// Once Derek has created the box's own Mongo user (README), pass its URI here instead.
const mongoUri = process.env.BOX_MONGODB_URI || uri.toString();

const env = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/srv/sl-web',
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  MONGODB_URI: mongoUri,
  MONGODB_DB: process.env.MONGODB_DB,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  NEXT_PUBLIC_URL: 'https://sourcelibrary.org',
  AUTH_SECRET: randomBytes(32).toString('hex'),
  AUTH_TRUST_HOST: 'true',
  // #8383: absolute redirects from the public origin, not the bind address.
  SL_PUBLIC_ORIGIN: 'https://sourcelibrary.org',
  // Trap 1: the box's pages load CSS and JS from /_box/_next/static (Caddy).
  SL_ASSET_PREFIX: '/_box',
  // Trap 2: client identity from CF-Connecting-IP / CF-IPCountry, which Caddy sets from the
  // Worker's headers and nothing else.
  SL_BOX_CLIENT_IDENTITY: 'cloudflare',
  NODE_OPTIONS: '--require /etc/sl-web/guard.cjs --max-old-space-size=4096',
  GUARD_LOG: '/srv/sl-web/log/guard.jsonl',
  GUARD_STATS: '/srv/sl-web/log/stats/mongo',
  GUARD_APP_DIR: '/srv/sl-web/current',
};

for (const [k, v] of Object.entries(env)) {
  if (/[\n\r]/.test(v)) { console.error(`make-env: ${k} has a newline`); process.exit(1); }
  process.stdout.write(`${k}=${v}\n`);
}
