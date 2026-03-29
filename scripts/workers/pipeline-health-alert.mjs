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

const MONGODB_URI = process.env.MONGODB_URI;
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALL_KEYS = [
  process.env.GEMINI_API_KEY_TIER3,
  process.env.GEMINI_API_KEY_2,
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

  // 3. Check for stale batch jobs
  const staleBatchJobs = await db.collection('batch_jobs').countDocuments({
    status: { $in: ['pending', 'processing'] },
    created_at: { $lt: sixHoursAgo },
  });

  if (staleBatchJobs > 0) {
    alerts.push({
      level: 'warning',
      check: 'stale_batch_jobs',
      message: `${staleBatchJobs} batch jobs stuck for >6h.`,
    });
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
    alerts.push({
      level: 'warning',
      check: 'sync_worker_missing',
      message: 'No sync-worker cron_runs record found. Worker may never have run.',
    });
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
