#!/usr/bin/env node
/**
 * Hetzner cron caller — triggers Vercel API cron endpoints via HTTP.
 *
 * Usage:
 *   node cron-caller.mjs <cron-name>
 *
 * Examples:
 *   node cron-caller.mjs archive-ocr
 *   node cron-caller.mjs social-post
 *   node cron-caller.mjs social-reset
 *   node cron-caller.mjs daily-pipeline-report
 *
 * Requires env vars: BASE_URL, CRON_SECRET
 *
 * Crontab entries for Hetzner:
 *   0 */4 * * *  set -a; source /root/.env.cron; set +a; node /root/cron-caller.mjs archive-ocr >> /root/logs/cron-caller.log 2>&1
 *   0 */3 * * *  set -a; source /root/.env.cron; set +a; node /root/cron-caller.mjs social-post >> /root/logs/cron-caller.log 2>&1
 *   0 0 * * *    set -a; source /root/.env.cron; set +a; node /root/cron-caller.mjs social-reset >> /root/logs/cron-caller.log 2>&1
 *   0 6 * * *    set -a; source /root/.env.cron; set +a; node /root/cron-caller.mjs daily-pipeline-report >> /root/logs/cron-caller.log 2>&1
 */

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

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CRON_SECRET}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(300_000), // 5 min timeout
  });

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
