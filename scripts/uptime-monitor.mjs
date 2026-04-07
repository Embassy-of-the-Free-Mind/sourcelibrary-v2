#!/usr/bin/env node
/**
 * Uptime monitor for Source Library.
 * Checks key endpoints, logs to MongoDB, alerts via ntfy.sh on new failures.
 *
 * Usage:
 *   node scripts/uptime-monitor.mjs          # Run checks, write to DB, alert on failure
 *   node scripts/uptime-monitor.mjs --check  # Print status only, no DB writes
 *
 * Cron (every 5 min on Hetzner):
 *   See below for crontab line — run with env sourced.
 */

import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENDPOINTS = [
  // /api/health bypasses Cloudflare JS challenge (no browser required)
  { name: 'health', url: 'https://sourcelibrary.org/api/health' },
  { name: 'api', url: 'https://sourcelibrary.org/api/books?limit=1' },
];

const TIMEOUT_MS = 15_000;
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
// How long to suppress repeat alerts for the same endpoint (1 hour)
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;

const DRY_RUN = process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function checkEndpoint(endpoint) {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(endpoint.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary-UptimeMonitor/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);

    const latency_ms = Date.now() - start;
    const ok = res.status >= 200 && res.status < 300;

    return {
      endpoint: endpoint.name,
      url: endpoint.url,
      status: res.status,
      ok,
      latency_ms,
      error: ok ? null : `HTTP ${res.status}`,
      checked_at: new Date(),
    };
  } catch (err) {
    return {
      endpoint: endpoint.name,
      url: endpoint.url,
      status: 0,
      ok: false,
      latency_ms: Date.now() - start,
      error: err.name === 'AbortError' ? `Timeout after ${TIMEOUT_MS}ms` : err.message,
      checked_at: new Date(),
    };
  }
}

async function sendAlert(message) {
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        'Title': 'Source Library DOWN',
        'Priority': 'high',
        'Tags': 'warning',
      },
      body: message,
    });
  } catch (err) {
    console.error(`[uptime] Failed to send ntfy alert: ${err.message}`);
  }
}

function printResults(results) {
  const ts = new Date().toISOString();
  console.log(`\n[uptime] ${ts}`);
  for (const r of results) {
    const icon = r.ok ? 'OK' : 'FAIL';
    const detail = r.ok ? `${r.latency_ms}ms` : r.error;
    console.log(`  ${icon}  ${r.endpoint.padEnd(12)} ${detail}`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Run all checks in parallel
  const results = await Promise.all(ENDPOINTS.map(checkEndpoint));

  printResults(results);

  if (DRY_RUN) {
    process.exit(0);
  }

  // Connect to MongoDB
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[uptime] MONGODB_URI not set, skipping DB write');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db('bookstore');
    const checksCol = db.collection('uptime_checks');
    const errorsCol = db.collection('application_errors');

    // Write all results
    await checksCol.insertMany(results);

    // Ensure TTL index exists (auto-delete after 30 days)
    await checksCol.createIndex(
      { checked_at: 1 },
      { expireAfterSeconds: 30 * 24 * 3600, background: true }
    ).catch(() => {}); // ignore if already exists

    // Ensure query index for the API route
    await checksCol.createIndex(
      { endpoint: 1, checked_at: -1 },
      { background: true }
    ).catch(() => {});

    // Handle failures
    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      // Write to application_errors
      const errorDocs = failures.map(f => ({
        source: 'uptime_monitor',
        endpoint: f.endpoint,
        url: f.url,
        error: f.error,
        status: f.status,
        latency_ms: f.latency_ms,
        timestamp: f.checked_at,
      }));
      await errorsCol.insertMany(errorDocs);

      // Check cooldown: only alert if we haven't alerted for this endpoint recently
      for (const f of failures) {
        const recentAlert = await checksCol.findOne({
          endpoint: f.endpoint,
          ok: false,
          alerted: true,
          checked_at: { $gte: new Date(Date.now() - ALERT_COOLDOWN_MS) },
        });

        if (!recentAlert) {
          const msg = `${f.endpoint} is down: ${f.error} (${f.url})`;
          console.log(`[uptime] ALERTING: ${msg}`);
          await sendAlert(msg);
          // Mark this check as alerted
          await checksCol.updateOne(
            { _id: results.find(r => r.endpoint === f.endpoint)?._id },
            { $set: { alerted: true } }
          );
        } else {
          console.log(`[uptime] ${f.endpoint} still down, alert suppressed (cooldown)`);
        }
      }
    }

    // Also send recovery notification if endpoint was down and is now up
    for (const r of results.filter(r => r.ok)) {
      const lastFail = await checksCol.findOne(
        { endpoint: r.endpoint, ok: false, checked_at: { $gte: new Date(Date.now() - ALERT_COOLDOWN_MS) } },
        { sort: { checked_at: -1 } }
      );
      if (lastFail) {
        // Check if there was a successful check after the last failure
        const recoveryAlreadySent = await checksCol.findOne({
          endpoint: r.endpoint,
          ok: true,
          recovery_sent: true,
          checked_at: { $gt: lastFail.checked_at },
        });
        if (!recoveryAlreadySent) {
          const msg = `${r.endpoint} recovered (${r.latency_ms}ms)`;
          console.log(`[uptime] RECOVERY: ${msg}`);
          await sendAlert(msg);
          await checksCol.updateOne(
            { _id: results.find(res => res.endpoint === r.endpoint)?._id },
            { $set: { recovery_sent: true } }
          );
        }
      }
    }

    console.log(`[uptime] Wrote ${results.length} checks to DB`);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('[uptime] Fatal:', err);
  process.exit(1);
});
