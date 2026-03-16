#!/usr/bin/env node
// Hetzner cron caller — triggers Vercel API cron endpoints via HTTP.
//
// Usage: node cron-caller.mjs <cron-name>
// Examples: archive-ocr, social-post, social-reset, daily-pipeline-report
// Requires env vars: BASE_URL, CRON_SECRET

const cronName = process.argv[2];
if (!cronName) {
  console.error('Usage: node cron-caller.mjs <cron-name>');
  process.exit(1);
}

const BASE_URL = process.env.BASE_URL || 'https://sourcelibrary.org';
const CRON_SECRET = process.env.CRON_SECRET;

if (!CRON_SECRET) {
  console.error('CRON_SECRET env var required');
  process.exit(1);
}

const url = `${BASE_URL}/api/cron/${cronName}`;
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
    console.log(`[${timestamp}] ${cronName} OK (${res.status}):`, JSON.stringify(parsed).substring(0, 500));
  } else {
    console.error(`[${timestamp}] ${cronName} FAILED (${res.status}):`, JSON.stringify(parsed).substring(0, 500));
    process.exit(1);
  }
} catch (err) {
  console.error(`[${timestamp}] ${cronName} ERROR:`, err.message);
  process.exit(1);
}
