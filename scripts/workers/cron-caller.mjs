#!/usr/bin/env node
// Hetzner cron caller — triggers Source Library API cron endpoints via HTTP.
//
// Usage:
//   node cron-caller.mjs <cron-name>      # → POST/GET /api/cron/<cron-name>
//   node cron-caller.mjs /api/health/auth # → POST/GET <full path verbatim>
//
// Examples: archive-ocr, social-post, daily-pipeline-report, /api/health/auth
// Requires env vars: BASE_URL, CRON_SECRET

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node cron-caller.mjs <cron-name | /full/path>');
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error('CRON_SECRET env var required');
  process.exit(1);
}

// Argument can be either a short cron name (prepended with /api/cron/) or an
// absolute path starting with `/` (used verbatim). The latter is for routes
// that don't live under /api/cron/* — e.g. /api/health/auth.
const path = arg.startsWith('/') ? arg : `/api/cron/${arg}`;
const label = arg.startsWith('/') ? arg : arg;
const url = `${BASE_URL}${path}`;
const timestamp = new Date().toISOString();

console.log(`[${timestamp}] Calling ${url}`);

const headers = {
  'Authorization': `Bearer ${CRON_SECRET}`,
  'Content-Type': 'application/json',
};
const signal = AbortSignal.timeout(300_000);

try {
  // Try POST first (most cron routes), fall back to GET if 405
  let res = await fetch(url, { method: 'POST', headers, signal });
  if (res.status === 405) {
    res = await fetch(url, { method: 'GET', headers, signal });
  }

  const body = await res.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch { parsed = body; }

  if (res.ok) {
    console.log(`[${timestamp}] ${label} OK (${res.status}):`, JSON.stringify(parsed).substring(0, 500));
  } else {
    console.error(`[${timestamp}] ${label} FAILED (${res.status}):`, JSON.stringify(parsed).substring(0, 500));
    process.exit(1);
  }
} catch (err) {
  console.error(`[${timestamp}] ${label} ERROR:`, err.message);
  process.exit(1);
}
