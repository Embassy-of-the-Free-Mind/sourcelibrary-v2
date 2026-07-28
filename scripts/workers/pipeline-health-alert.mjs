#!/usr/bin/env node
/**
 * Pipeline Health Alert
 *
 * Runs daily via cron. Checks if batch OCR is making progress.
 * Logs warnings to console (captured in cron log) and writes
 * to system_config for dashboard visibility.
 *
 * Checks:
 *   1. Pages OCR'd in last 24h (should be >0 if pipeline is active)
 *   2. Gemini File API storage usage (should be <15GB of 20GB)
 *   3. Batch jobs stuck in pending >6h
 *   4. Books stuck in ocr_submitted >48h
 *   5. Translation throughput stall (books waiting but 0 pages translated in 2h)
 *   5b. Orphan submitted books (in *_submitted state with no job reference)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/pipeline-health-alert.mjs
 */

import { MongoClient } from 'mongodb';
import { computeIndexDrift } from '../maintenance/ensure-indexes.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALL_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
  process.env.GEMINI_API_KEY_3,
  process.env.GEMINI_API_KEY,
].filter(Boolean);

if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

async function run() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  const alerts = [];
  const now = new Date();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
  const sixHoursAgo = new Date(now - 6 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(now - 48 * 60 * 60 * 1000);

  // 1. Check OCR throughput
  // Use batch_jobs (indexed, fast) instead of scanning pages collection
  const recentSavedJobs = await db.collection('batch_jobs').countDocuments({
    type: 'ocr',
    status: 'saved',
    completed_at: { $gte: oneDayAgo },
  });

  const archiveComplete = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'archive_complete',
  });

  const pagesOcrd = recentSavedJobs > 0 ? '(jobs completed)' : 0;

  if (recentSavedJobs === 0 && archiveComplete > 0) {
    alerts.push({
      level: 'critical',
      check: 'ocr_throughput',
      message: `0 OCR jobs completed in 24h but ${archiveComplete} books waiting. Pipeline may be broken.`,
    });
  } else {
    console.log(`[health] OCR throughput: ${recentSavedJobs} jobs completed in 24h, ${archiveComplete} books waiting`);
  }

  // 2. Check Gemini File API storage
  for (let ki = 0; ki < ALL_KEYS.length; ki++) {
    try {
      let totalFiles = 0;
      let totalBytes = 0;
      let pageToken = null;

      do {
        const url = new URL(`${GEMINI_API_BASE}/files`);
        url.searchParams.set('key', ALL_KEYS[ki]);
        url.searchParams.set('pageSize', '100');
        if (pageToken) url.searchParams.set('pageToken', pageToken);

        const res = await fetch(url);
        if (!res.ok) break;
        const data = await res.json();
        const files = data.files || [];
        totalFiles += files.length;
        for (const f of files) totalBytes += parseInt(f.sizeBytes || 0);
        pageToken = data.nextPageToken;
      } while (pageToken);

      const gbUsed = totalBytes / 1024 / 1024 / 1024;
      if (gbUsed > 15) {
        alerts.push({
          level: 'warning',
          check: 'file_storage',
          message: `Key ${ki}: ${gbUsed.toFixed(1)} GB / 20 GB file storage used (${totalFiles} files). Risk of quota exhaustion.`,
        });
      } else if (totalFiles > 0) {
        console.log(`[health] Key ${ki}: ${totalFiles} files, ${gbUsed.toFixed(2)} GB`);
      }
    } catch (err) {
      console.log(`[health] Key ${ki} file check failed: ${err.message}`);
    }
  }

  // 3. Check for stale batch jobs (>24h is the actual stale threshold now)
  const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);
  const staleBatchJobs = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['pending', 'processing'] },
    created_at: { $lt: twentyFourHoursAgo },
  });

  if (staleBatchJobs > 0) {
    alerts.push({
      level: 'warning',
      check: 'stale_batch_jobs',
      message: `${staleBatchJobs} batch jobs stuck for >24h.`,
    });
  }

  // 3b. Batch failure rate — alert if >50% failing in last 24h
  const recentFailed = await db.collection('batch_jobs').countDocuments({
    status: 'failed',
    job_name: { $exists: true },
    created_at: { $gte: oneDayAgo },
  });
  const recentTotal = await db.collection('batch_jobs').countDocuments({
    job_name: { $exists: true },
    created_at: { $gte: oneDayAgo },
  });
  if (recentTotal >= 10) {
    const failRate = recentFailed / recentTotal;
    if (failRate > 0.5) {
      alerts.push({
        level: 'critical',
        check: 'batch_failure_rate',
        message: `Batch failure rate ${(failRate * 100).toFixed(0)}% (${recentFailed}/${recentTotal} in 24h). Possible API quota exhaustion or outage.`,
      });
    } else {
      console.log(`[health] Batch failure rate: ${(failRate * 100).toFixed(0)}% (${recentFailed}/${recentTotal} in 24h)`);
    }
  }

  // 4. Check for books stuck in ocr_submitted
  const stuckBooks = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'ocr_submitted',
    'pipeline_auto.updated_at': { $lt: twoDaysAgo },
  });

  if (stuckBooks > 0) {
    alerts.push({
      level: 'warning',
      check: 'stuck_books',
      message: `${stuckBooks} books stuck in ocr_submitted for >48h.`,
    });
  }

  // 5. Translation throughput stall detection
  // If books are in translate_submitted but 0 pages translated in 2h, translation is broken.
  const twoHoursAgo = new Date(now - 2 * 60 * 60 * 1000);
  const translateSubmitted = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'translate_submitted',
  });
  if (translateSubmitted > 0) {
    const recentTranslations = await db.collection('pages').countDocuments({
      'translation.updated_at': { $gte: twoHoursAgo },
    });
    if (recentTranslations === 0) {
      alerts.push({
        level: 'critical',
        check: 'translation_stall',
        message: `${translateSubmitted} books in translate_submitted but 0 pages translated in 2h. Translate worker may be stuck.`,
      });
    }
  }

  // 5b. Orphan submitted books — in *_submitted state with no book.job
  for (const state of ['translate_submitted', 'ocr_submitted', 'images_submitted']) {
    const orphans = await db.collection('books').countDocuments({
      'pipeline_auto.status': state,
      $or: [{ job: { $exists: false } }, { job: null }],
    });
    if (orphans > 0) {
      alerts.push({
        level: 'warning',
        check: 'orphan_submitted',
        message: `${orphans} books in ${state} with no job reference. Pipeline orchestrator should auto-fix.`,
      });
    }
  }

  // 6. Sync-worker phase completion check
  // Verify that the last sync-worker run completed ALL phases (not just ran)
  const lastSync = await db.collection('cron_runs')
    .findOne({ cron: 'sync-worker' }, { sort: { timestamp: -1 } });
  if (lastSync) {
    const syncAge = now - lastSync.timestamp;
    const syncAgeHours = syncAge / (60 * 60 * 1000);
    if (syncAgeHours > 14) {
      alerts.push({
        level: 'warning',
        check: 'sync_worker_stale',
        message: `Last sync-worker run was ${syncAgeHours.toFixed(1)}h ago. Should run every 6h.`,
      });
    }
    if (lastSync.failed || lastSync.status === 'partial_failure') {
      const failedPhases = lastSync.phases_failed || lastSync.errors?.map(e => e.phase) || ['unknown'];
      alerts.push({
        level: 'critical',
        check: 'sync_worker_partial_failure',
        message: `Last sync-worker run had failed phases: ${failedPhases.join(', ')}. ${lastSync.errors?.map(e => `${e.phase}: ${e.error}`).join('; ') || ''}`,
      });
    }
    console.log(`[health] Sync-worker: last run ${syncAgeHours.toFixed(1)}h ago, status=${lastSync.status || 'success'}, phases=${lastSync.phases_completed?.join(',') || 'unknown'}`);
  } else {
    // "May never have run" is what this said for the seven weeks the worker was
    // exiting early on the pipeline pause (#3408) — true, unhelpful, and read as
    // a config nit rather than "six derived collections are frozen". A run that
    // bails before its first phase writes no cron_runs record at all, so absence
    // means "started and gave up" at least as often as "never scheduled".
    alerts.push({
      level: 'warning',
      check: 'sync_worker_missing',
      message: 'No sync-worker cron_runs record found — it is not completing runs. A record is only written after the phases execute, so an early exit looks identical to "never scheduled". Check /var/log/sourcelibrary/sync.log on the Hetzner box for the reason before assuming cron is at fault; everything it maintains (page counts, collection counts, gallery images, author slugs, analytics_usage, gemini_usage_daily) is frozen meanwhile.',
    });
  }

  // 8. Pause-age check (#2455): paused_phases sat for 6 days behind a "healthy"
  // status while 1,759 books piled up at archive_complete. Warn after 48h.
  try {
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    const paused = control?.paused_phases || [];
    if (paused.length > 0) {
      const setAt = control.paused_phases_set_at ? new Date(control.paused_phases_set_at) : null;
      const ageHours = setAt ? (now - setAt) / 3600000 : Infinity;
      if (ageHours >= 48) {
        const backlog = await db.collection('books').countDocuments({
          'pipeline_auto.status': { $in: ['archive_complete', 'ocr_complete'] },
        });
        alerts.push({
          level: 'critical',
          check: 'paused_phases_stale',
          message: `paused_phases=[${paused.join(', ')}] set ${setAt ? ageHours.toFixed(0) + 'h ago' : 'at unknown time'} (reason: ${control.paused_phases_reason || 'none recorded'}). ${backlog} books queued behind the pause. Clear system_config.processing_control.paused_phases if no longer needed.`,
        });
      } else {
        console.log(`[health] paused_phases=[${paused.join(', ')}] active for ${ageHours.toFixed(0)}h (alerts at 48h)`);
      }
    }
  } catch (e) {
    console.error(`[health] pause-age check failed: ${e.message}`);
  }

  // 9. Gemini key parity (#2455): batch jobs are visible only to their creating
  // key. If Vercel holds a key this box lacks, the collector falsely fails every
  // job that key submits (the 2026-06-05 key-drift incident). Compare SHA-256
  // fingerprints with the production deployment.
  try {
    const { createHash } = await import('crypto');
    const localFps = new Map();
    for (const [name, value] of Object.entries(process.env)) {
      if (!name.startsWith('GEMINI_API_KEY') || !value) continue;
      localFps.set(createHash('sha256').update(value).digest('hex').slice(0, 12), name);
    }
    const res = await fetch('https://sourcelibrary.org/api/admin/key-fingerprints', {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const { fingerprints: remote } = await res.json();
      const missingHere = Object.entries(remote || {}).filter(([, fp]) => !localFps.has(fp));
      if (missingHere.length > 0) {
        alerts.push({
          level: 'critical',
          check: 'gemini_key_drift',
          message: `Vercel holds ${missingHere.length} Gemini key(s) absent from this box (${missingHere.map(([n]) => n).join(', ')}). Batch jobs submitted with them will 404 for the collector and be falsely failed. Mirror them into /root/sourcelibrary/.env.production.local (see memory/pipeline-ops.md 2026-06-05 lesson).`,
        });
      } else {
        console.log(`[health] Gemini key parity OK (${localFps.size} local keys cover all ${Object.keys(remote || {}).length} Vercel keys)`);
      }
    } else if (res.status === 404) {
      console.log('[health] key-fingerprints endpoint not deployed yet — skipping parity check');
    } else {
      console.error(`[health] key parity check HTTP ${res.status}`);
    }
  } catch (e) {
    console.error(`[health] key parity check failed: ${e.message}`);
  }

  // 10. Index drift check (#2978): compare the checked-in index manifest
  // (scripts/maintenance/ensure-indexes.mjs) against what's actually live.
  // A missing manifest index is a warning (a query this platform relies on
  // may be about to collision-scan, as happened in the #2973 timeline outage).
  // An unknown-live index is informational only — NEVER auto-dropped; it just
  // means someone should figure out where it came from and add it to the
  // manifest (or drop it deliberately, by hand, after verifying it's unused).
  try {
    const drift = await computeIndexDrift(db);
    if (drift.missingFromLive.length > 0) {
      const names = drift.missingFromLive.map((i) => `${i.collection}.${i.options.name}`);
      alerts.push({
        level: 'warning',
        check: 'index_drift_missing',
        message: `${names.length} manifest index(es) not found live: ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', ...' : ''}. Run scripts/maintenance/ensure-indexes.mjs --apply to create them (verify first — see #2978).`,
      });
    }
    if (drift.mismatched.length > 0) {
      const names = drift.mismatched.map((m) => `${m.collection}.${m.name}`);
      alerts.push({
        level: 'warning',
        check: 'index_drift_mismatched',
        message: `${names.length} index(es) share a name with the manifest but differ in key/options: ${names.join(', ')}. Manifest and live have diverged — reconcile in scripts/maintenance/ensure-indexes.mjs.`,
      });
    }
    if (drift.unknownLive.length > 0) {
      const names = drift.unknownLive.map((i) => `${i.collection}.${i.name}`);
      alerts.push({
        level: 'info',
        check: 'index_drift_unknown_live',
        message: `${names.length} live index(es) not in the manifest (informational only, never auto-dropped): ${names.slice(0, 10).join(', ')}${names.length > 10 ? ', ...' : ''}. Add them to scripts/maintenance/ensure-indexes.mjs once their purpose is confirmed.`,
      });
    }
    if (drift.missingFromLive.length === 0 && drift.mismatched.length === 0 && drift.unknownLive.length === 0) {
      console.log('[health] Index manifest matches live state exactly');
    }
  } catch (e) {
    console.error(`[health] index drift check failed: ${e.message}`);
  }

  // 11. Derived-rollup staleness (#3408). These collections are written by
  // sync-worker and read by dashboards; when the writer dies they don't error,
  // they just keep serving the last good value. gemini_usage_daily is the
  // dangerous one — a dead rollup and a genuinely idle pipeline both read
  // $0.00, so cost monitoring fails in the "everything is fine" direction.
  try {
    const newestDaily = await db.collection('gemini_usage_daily')
      .find({}).sort({ date: -1 }).limit(1).next();
    const dailyAgeDays = newestDaily?.date
      ? (now - new Date(newestDaily.date + 'T00:00:00Z')) / 86400000
      : Infinity;
    if (dailyAgeDays > 2) {
      alerts.push({
        level: 'warning',
        check: 'usage_rollup_stale',
        message: `gemini_usage_daily newest row is ${newestDaily?.date || 'MISSING'} (${Number.isFinite(dailyAgeDays) ? dailyAgeDays.toFixed(0) + 'd' : 'never'} old). Cost dashboards read $0.00 whether spend is zero or the rollup is dead. Fix the sync-worker usage_daily phase, then backfill: node scripts/maintenance/backfill-usage-daily.mjs --from <date>`,
      });
    } else {
      console.log(`[health] gemini_usage_daily current through ${newestDaily.date}`);
    }

    const snapshot = await db.collection('system_config').findOne({ _id: 'analytics_usage' });
    const snapAgeH = snapshot?.updated_at ? (now - new Date(snapshot.updated_at)) / 3600000 : Infinity;
    if (snapAgeH > 48) {
      alerts.push({
        level: 'warning',
        check: 'analytics_snapshot_stale',
        message: `system_config.analytics_usage last written ${Number.isFinite(snapAgeH) ? (snapAgeH / 24).toFixed(1) + 'd' : 'never'} ago. The /analytics dashboard is serving that snapshot as if it were current.`,
      });
    }
  } catch (e) {
    console.error(`[health] rollup staleness check failed: ${e.message}`);
  }

  // 7. Quick stats
  const ocrSubmitted = await db.collection('books').countDocuments({
    'pipeline_auto.status': 'ocr_submitted',
  });
  const pendingJobs = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['pending', 'processing'] },
  });
  console.log(`[health] Pipeline: ${ocrSubmitted} books in ocr_submitted, ${pendingJobs} active batch jobs`);

  // Write alerts to system_config for dashboard
  if (alerts.length > 0) {
    console.log('\n=== ALERTS ===');
    for (const alert of alerts) {
      console.log(`[${alert.level.toUpperCase()}] ${alert.check}: ${alert.message}`);
    }

    await db.collection('system_config').updateOne(
      { _id: 'pipeline_health' },
      {
        $set: {
          alerts,
          last_check: now,
          status: alerts.some(a => a.level === 'critical') ? 'critical' : 'warning',
        },
      },
      { upsert: true },
    );

    // Email critical alerts via Resend (with 4h cooldown)
    const hasCritical = alerts.some(a => a.level === 'critical');
    if (hasCritical && process.env.RESEND_API_KEY) {
      const COOLDOWN_MS = 4 * 60 * 60 * 1000;
      const lastAlert = await db.collection('system_config').findOne({ _id: 'pipeline_alert_state' });
      const elapsed = lastAlert?.last_sent_at ? (Date.now() - new Date(lastAlert.last_sent_at).getTime()) : Infinity;
      if (elapsed >= COOLDOWN_MS) {
        try {
          const { Resend } = await import('resend');
          const resend = new Resend(process.env.RESEND_API_KEY);
          const criticalAlerts = alerts.filter(a => a.level === 'critical');
          await resend.emails.send({
            from: 'Source Library <noreply@sourcelibrary.org>',
            to: process.env.ALERT_EMAIL || 'derek@sourcelibrary.org',
            subject: `[PIPELINE] ${criticalAlerts.map(a => a.check).join(', ')}`,
            html: [
              '<h2>Pipeline Health Alert</h2>',
              `<p><strong>Time:</strong> ${now.toISOString()}</p>`,
              '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">',
              '<tr><th>Check</th><th>Level</th><th>Detail</th></tr>',
              ...alerts.map(a => `<tr><td>${a.check}</td><td style="color:${a.level === 'critical' ? 'red' : 'orange'}">${a.level}</td><td>${a.message}</td></tr>`),
              '</table>',
            ].join('\n'),
          });
          await db.collection('system_config').updateOne(
            { _id: 'pipeline_alert_state' },
            { $set: { last_sent_at: new Date(), last_alerts: criticalAlerts } },
            { upsert: true },
          );
          console.log('[health] Email alert sent');
        } catch (emailErr) {
          console.error('[health] Email alert failed:', emailErr.message);
        }
      } else {
        console.log(`[health] Email cooldown: ${((COOLDOWN_MS - elapsed) / 3600000).toFixed(1)}h remaining`);
      }
    }
  } else {
    console.log('\n[health] All checks passed');
    await db.collection('system_config').updateOne(
      { _id: 'pipeline_health' },
      {
        $set: {
          alerts: [],
          last_check: now,
          status: 'healthy',
        },
      },
      { upsert: true },
    );
  }

  await client.close();
}

run().catch(err => { console.error(err); process.exit(1); });
