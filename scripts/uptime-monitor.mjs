#!/usr/bin/env node
/**
 * Uptime monitor for Source Library.
 * Checks key endpoints, logs to MongoDB, alerts via ntfy.sh on new failures.
 *
 * Usage:
 *   node scripts/uptime-monitor.mjs             # Run checks, write to DB, alert on failure
 *   node scripts/uptime-monitor.mjs --check      # Print status only, no DB writes (legacy flag)
 *   node scripts/uptime-monitor.mjs --probe-only # Same as --check: probe all, print table, no DB/ntfy side-effects
 *
 * Cron (every 5 min on Hetzner):
 *   See below for crontab line — run with env sourced.
 *
 * Deploy after merge:
 *   cd /root/sourcelibrary && git pull
 *   (No service restart needed — cron runs the script directly)
 */

import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENDPOINTS = [
  // Use .vercel.app to bypass Cloudflare JS challenge (Hetzner IP gets 403 on sourcelibrary.org)
  { name: 'health', url: 'https://sourcelibrary-v2.vercel.app/api/health' },
  { name: 'api', url: 'https://sourcelibrary-v2.vercel.app/api/books?limit=1' },

  // Tenant embed routes — two-shot probe: cold_ms logged, warm_ms used for SLO
  {
    name: 'embed_bph',
    url: 'https://sourcelibrary-v2.vercel.app/embed/bph?host_path=%2Fdigital-collection-search',
    twoShot: true,
    latencySloMs: 1000,
    checkBody: true,
  },
  {
    name: 'embed_ficino',
    url: 'https://sourcelibrary-v2.vercel.app/embed/ficino',
    twoShot: true,
    latencySloMs: 1000,
    checkBody: true,
  },
  {
    name: 'embed_bhutan',
    url: 'https://sourcelibrary-v2.vercel.app/embed/bhutan',
    twoShot: true,
    latencySloMs: 1000,
    checkBody: true,
  },
];

const TIMEOUT_MS = 30_000;
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
// How long to suppress repeat alerts for the same endpoint (1 hour)
const ALERT_COOLDOWN_MS = 60 * 60 * 1000;
// Warm response threshold below which we send a recovery notification (headroom under 1000ms SLO)
const RECOVERY_WARM_THRESHOLD_MS = 800;
// Delay between the two shots in a two-shot probe
const TWO_SHOT_DELAY_MS = 250;
// RSC error body patterns
const ERROR_BODY_PATTERNS = ['Something went wrong', 'digest:'];

const PROBE_ONLY = process.argv.includes('--probe-only') || process.argv.includes('--check');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url) {
  const start = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary-UptimeMonitor/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    return { res, latency_ms: Date.now() - start };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

async function checkEndpoint(endpoint) {
  // ---- Two-shot probe (embed endpoints only) ----
  if (endpoint.twoShot) {
    return checkTwoShot(endpoint);
  }

  // ---- Standard single-shot probe ----
  const start = Date.now();
  try {
    const { res, latency_ms } = await fetchWithTimeout(endpoint.url);
    const ok = res.status >= 200 && res.status < 300;
    return {
      endpoint: endpoint.name,
      url: endpoint.url,
      status: res.status,
      ok,
      latency_ms,
      error: ok ? null : `HTTP ${res.status}`,
      reason: ok ? null : `HTTP ${res.status}`,
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
      reason: err.name === 'AbortError' ? `Timeout after ${TIMEOUT_MS}ms` : err.message,
      checked_at: new Date(),
    };
  }
}

async function checkTwoShot(endpoint) {
  const checked_at = new Date();

  // --- First shot (warm-up; latency logged but not used for SLO) ---
  let cold_ms = null;
  let cold_status = null;
  try {
    const { res, latency_ms } = await fetchWithTimeout(endpoint.url);
    // Drain body to avoid connection leak
    await res.text().catch(() => {});
    cold_ms = latency_ms;
    cold_status = res.status;
  } catch (err) {
    cold_ms = TIMEOUT_MS;
    cold_status = 0;
  }

  // Small pause between shots
  await new Promise(r => setTimeout(r, TWO_SHOT_DELAY_MS));

  // --- Second shot (SLO measurement) ---
  const warmStart = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const res = await fetch(endpoint.url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'SourceLibrary-UptimeMonitor/1.0' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    const warm_ms = Date.now() - warmStart;

    const httpOk = res.status >= 200 && res.status < 300;

    // Body check for RSC error boundaries
    let bodyError = null;
    if (endpoint.checkBody && httpOk) {
      const body = await res.text();
      for (const pattern of ERROR_BODY_PATTERNS) {
        if (body.includes(pattern)) {
          bodyError = `error body detected ('${pattern}' found)`;
          break;
        }
      }
    } else {
      await res.text().catch(() => {});
    }

    // Latency SLO check (warm_ms only)
    let sloError = null;
    if (httpOk && !bodyError && endpoint.latencySloMs && warm_ms > endpoint.latencySloMs) {
      sloError = `slow: ${warm_ms}ms > ${endpoint.latencySloMs}ms`;
    }

    const reason = !httpOk
      ? `HTTP ${res.status}`
      : bodyError || sloError || null;

    const ok = httpOk && !bodyError && !sloError;

    return {
      endpoint: endpoint.name,
      url: endpoint.url,
      status: res.status,
      ok,
      latency_ms: warm_ms,  // primary latency = warm shot
      warm_ms,
      cold_ms,
      error: reason,
      reason,
      checked_at,
    };
  } catch (err) {
    const warm_ms = Date.now() - warmStart;
    const msg = err.name === 'AbortError' ? `Timeout after ${TIMEOUT_MS}ms` : err.message;
    return {
      endpoint: endpoint.name,
      url: endpoint.url,
      status: 0,
      ok: false,
      latency_ms: warm_ms,
      warm_ms,
      cold_ms,
      error: msg,
      reason: msg,
      checked_at,
    };
  }
}

async function sendAlert(message, title = 'Source Library DOWN') {
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: {
        'Title': title,
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
  const hasTwoShot = results.some(r => r.warm_ms !== undefined);

  if (hasTwoShot) {
    // Full table with cold/warm columns
    console.log(`\n[uptime] ${ts}`);
    console.log(`  ${'STATUS'.padEnd(6)}  ${'ENDPOINT'.padEnd(14)}  ${'LATENCY'.padEnd(10)}  ${'COLD'.padEnd(10)}  ${'WARM'.padEnd(10)}  DETAIL`);
    console.log(`  ${'------'.padEnd(6)}  ${'--------'.padEnd(14)}  ${'-------'.padEnd(10)}  ${'----'.padEnd(10)}  ${'----'.padEnd(10)}  ------`);
    for (const r of results) {
      const icon = r.ok ? 'OK   ' : 'FAIL ';
      const latency = `${r.latency_ms}ms`;
      const cold = r.cold_ms != null ? `${r.cold_ms}ms` : '-';
      const warm = r.warm_ms != null ? `${r.warm_ms}ms` : '-';
      const detail = r.ok ? '' : (r.reason || r.error || '');
      console.log(`  ${icon}  ${r.endpoint.padEnd(14)}  ${latency.padEnd(10)}  ${cold.padEnd(10)}  ${warm.padEnd(10)}  ${detail}`);
    }
  } else {
    // Simple table (legacy format)
    console.log(`\n[uptime] ${ts}`);
    for (const r of results) {
      const icon = r.ok ? 'OK' : 'FAIL';
      const detail = r.ok ? `${r.latency_ms}ms` : r.error;
      console.log(`  ${icon}  ${r.endpoint.padEnd(12)} ${detail}`);
    }
  }
  console.log('');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Run all checks in parallel
  const results = await Promise.all(ENDPOINTS.map(checkEndpoint));

  printResults(results);

  if (PROBE_ONLY) {
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
    const insertResult = await checksCol.insertMany(results);
    // Attach inserted IDs for later updateOne calls
    results.forEach((r, i) => { r._id = insertResult.insertedIds[i]; });

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
        reason: f.reason,
        status: f.status,
        latency_ms: f.latency_ms,
        warm_ms: f.warm_ms,
        cold_ms: f.cold_ms,
        timestamp: f.checked_at,
      }));
      await errorsCol.insertMany(errorDocs);

      // Check cooldown + consecutive-fail gate for each failing endpoint
      for (const f of failures) {
        // 1-hour cooldown: skip if we already alerted recently
        const recentAlert = await checksCol.findOne({
          endpoint: f.endpoint,
          ok: false,
          alerted: true,
          checked_at: { $gte: new Date(Date.now() - ALERT_COOLDOWN_MS) },
        });

        if (recentAlert) {
          console.log(`[uptime] ${f.endpoint} still failing, alert suppressed (cooldown)`);
          continue;
        }

        // Two-consecutive-fails gate: only alert on latency SLO violations if the previous
        // check was also a failure. Network outages (non-200 status) skip this gate.
        const isLatencyViolation = f.status !== 0 && f.status >= 200 && f.status < 300 && f.reason && f.reason.startsWith('slow:');
        if (isLatencyViolation) {
          const prevCheck = await checksCol.findOne(
            { endpoint: f.endpoint, ok: false },
            { sort: { checked_at: -1 } }
          );
          if (!prevCheck) {
            console.log(`[uptime] ${f.endpoint} slow (first occurrence), waiting for second consecutive fail before alerting`);
            continue;
          }
          console.log(`[uptime] ${f.endpoint} slow on consecutive checks — alerting`);
        }

        const msg = `${f.endpoint} is down: ${f.reason || f.error} (${f.url})`;
        console.log(`[uptime] ALERTING: ${msg}`);
        await sendAlert(msg);

        // Mark this check as alerted
        await checksCol.updateOne(
          { _id: f._id },
          { $set: { alerted: true } }
        );
      }
    }

    // Send recovery notification if endpoint was down and is now back and fast
    for (const r of results.filter(r => r.ok)) {
      // For two-shot embed endpoints, require warm_ms < RECOVERY_WARM_THRESHOLD_MS for recovery
      if (r.warm_ms !== undefined && r.warm_ms >= RECOVERY_WARM_THRESHOLD_MS) {
        continue; // still marginal — don't declare recovery yet
      }

      const lastFail = await checksCol.findOne(
        {
          endpoint: r.endpoint,
          ok: false,
          alerted: true,
          checked_at: { $gte: new Date(Date.now() - ALERT_COOLDOWN_MS) },
        },
        { sort: { checked_at: -1 } }
      );

      if (lastFail) {
        // Check if we already sent a recovery notification since the last failure
        const recoveryAlreadySent = await checksCol.findOne({
          endpoint: r.endpoint,
          ok: true,
          recovery_sent: true,
          checked_at: { $gt: lastFail.checked_at },
        });

        if (!recoveryAlreadySent) {
          const latencyNote = r.warm_ms !== undefined ? `warm ${r.warm_ms}ms` : `${r.latency_ms}ms`;
          const msg = `${r.endpoint} recovered (${latencyNote})`;
          console.log(`[uptime] RECOVERY: ${msg}`);
          await sendAlert(msg, 'Source Library Recovered');
          await checksCol.updateOne(
            { _id: r._id },
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
