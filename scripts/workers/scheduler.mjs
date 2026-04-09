#!/usr/bin/env node
/**
 * Unified Pipeline Scheduler
 *
 * Replaces 15+ independent cron entries with a single coordinator that:
 *   1. Checks processing_control.paused — if paused, does nothing (NO auto-resume)
 *   2. Probes DB health before spawning any workers
 *   3. Tracks running workers via lock files
 *   4. Enforces a global connection budget (~40 Atlas connections)
 *   5. Spawns workers in priority order, only when budget allows
 *
 * Crontab: single entry, every 2 minutes
 *   * /2 * * * * cd /root/sourcelibrary && flock -n /tmp/sl-scheduler.lock \
 *     bash -c "set -a; source .env.production.local; set +a; node scripts/workers/scheduler.mjs" \
 *     >> /var/log/sourcelibrary/scheduler.log 2>&1
 *
 * Issue: #646
 */

import { MongoClient } from 'mongodb';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync, appendFileSync } from 'fs';

// ── Config ──

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose') || process.argv.includes('-v');

// Global Atlas connection budget. With capped pools (maxPoolSize 5-20 per worker),
// actual peak is well under Atlas M10 limits. 60 leaves headroom for Vercel SSR/ISR.
const MAX_CONNECTIONS = 60;

// ── Worker Definitions ──
// Each worker has:
//   - name: human-readable identifier
//   - cmd: command to run (relative to project root)
//   - lock: lock file path (flock -n prevents overlap)
//   - connections: estimated peak MongoDB connections this worker uses
//   - tier: priority tier (1=highest, lower tiers run first)
//   - interval: minimum seconds between runs (enforced via last-run tracking)
//   - healthMin: minimum health grade required ('healthy', 'degraded', 'critical')
//   - log: log file path

const WORKERS = [
  // Tier 1: Core pipeline — must always run
  {
    name: 'pipeline-orchestrator',
    cmd: 'node scripts/workers/pipeline-orchestrator.mjs',
    lock: '/tmp/sl-pipeline.lock',
    connections: 5,
    tier: 1,
    interval: 120,      // every 2 min
    healthMin: 'degraded',
    log: '/var/log/sourcelibrary/pipeline.log',
  },

  // Tier 2: Translation — the heaviest single worker
  {
    name: 'translate-worker',
    cmd: 'node scripts/workers/translate-worker.mjs',
    lock: '/tmp/sl-translate.lock',
    connections: 20,
    tier: 2,
    interval: 120,      // every 2 min
    healthMin: 'healthy',
    log: '/var/log/sourcelibrary/translate.log',
  },

  // Tier 3: Batch collection — lightweight, collects Gemini results
  {
    name: 'batch-collector',
    cmd: 'node scripts/workers/batch-collector.mjs',
    lock: '/tmp/sl-collector.lock',
    connections: 5,
    tier: 3,
    interval: 600,      // every 10 min
    healthMin: 'critical', // always run — finishes in-flight batch jobs
    log: '/var/log/sourcelibrary/collector.log',
  },

  // Tier 4: Archiving — I/O bound (HTTP downloads), light on Atlas
  {
    name: 'archive-ocr',
    cmd: 'node scripts/workers/archive-ocr.mjs',
    lock: '/tmp/sl-archive-ocr.lock',
    connections: 5,
    tier: 4,
    interval: 1800,     // every 30 min
    healthMin: 'degraded',
    log: '/var/log/sourcelibrary/archive-ocr.log',
  },
  {
    name: 'archive-bulk',
    cmd: 'node scripts/workers/archive-bulk.mjs --limit=100 --concurrency=6',
    lock: '/tmp/sl-archive-bulk.lock',
    connections: 5,
    tier: 4,
    interval: 600,      // every 10 min
    healthMin: 'degraded',
    log: '/var/log/sourcelibrary/archive-bulk.log',
  },

  // Tier 5: Image processing — R2/sharp bound, light on Atlas
  {
    name: 'resize-worker',
    cmd: 'node scripts/workers/resize-worker.mjs --limit 500 --concurrency 10',
    lock: '/tmp/sl-resize.lock',
    connections: 5,
    tier: 5,
    interval: 1800,     // every 30 min
    healthMin: 'healthy',
    log: '/var/log/sourcelibrary/resize.log',
  },
  {
    name: 'display-backfill',
    cmd: 'node scripts/migration/backfill-display-images.mjs --limit=10000 --concurrency=10 --book-concurrency=2',
    lock: '/tmp/sl-display-backfill.lock',
    connections: 5,
    tier: 5,
    interval: 1800,     // every 30 min
    healthMin: 'healthy',
    log: '/var/log/sourcelibrary/display-backfill.log',
  },

  // Tier 6: Sync — infrequent, moderate load
  {
    name: 'sync-worker',
    cmd: 'node scripts/workers/sync-worker.mjs',
    lock: '/tmp/sl-sync.lock',
    connections: 5,
    tier: 6,
    interval: 7200,     // every 2 hours
    healthMin: 'healthy',
    log: '/var/log/sourcelibrary/sync.log',
  },
];

// Workers NOT managed by the scheduler (HTTP-only, no Atlas load):
// - cron-caller.mjs (social-post, social-reset, daily-pipeline-report)
// - warm-author-pages.mjs (HTTP revalidation)
// - prewarm-browse.mjs (HTTP revalidation)
// - pipeline-health-alert.mjs (reads only, runs daily)
// - embedding-server.mjs (long-running, Supabase not Atlas)
// - snapshot-stats.mjs (daily 4:30am, catalog coverage + SL progress snapshot)
// These keep their own cron lines.

// ── Health grades ranked for comparison ──
const HEALTH_RANK = { critical: 0, degraded: 1, healthy: 2 };

function healthAllows(grade, minimum) {
  return HEALTH_RANK[grade] >= HEALTH_RANK[minimum];
}

// ── Lock file checking ──
// Uses flock -n to test if a lock is held without acquiring it.
function isLocked(lockPath) {
  try {
    // flock -n --nb exits 1 if locked, 0 if available
    execSync(`flock -n "${lockPath}" true 2>/dev/null`, { timeout: 2000 });
    return false; // lock is free
  } catch {
    return true; // lock is held (another process running)
  }
}

// ── Last-run tracking ──
// Stores last spawn time per worker in a JSON file so we respect intervals
// across scheduler invocations.
const LAST_RUN_FILE = '/tmp/sl-scheduler-last-run.json';

function getLastRuns() {
  try {
    return JSON.parse(readFileSync(LAST_RUN_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveLastRuns(runs) {
  writeFileSync(LAST_RUN_FILE, JSON.stringify(runs, null, 2));
}

// ── DB Health Probe (simplified from pipeline-orchestrator) ──

async function probeDbHealth(db) {
  const t0 = Date.now();
  let findMs = 0, countMs = 0;

  try {
    const t1 = Date.now();
    await db.collection('books').findOne(
      { visible: true, pages_count: { $gt: 0 } },
      { projection: { _id: 1 }, maxTimeMS: 3000 }
    );
    findMs = Date.now() - t1;

    const t2 = Date.now();
    await db.collection('books').find(
      { visible: true, pages_count: { $gt: 0 } }
    ).sort({ created_at: -1 }).limit(10).project({ _id: 1 }).toArray();
    countMs = Date.now() - t2;
  } catch {
    findMs = 3000;
    countMs = 3000;
  }

  let grade = 'healthy';
  if (findMs > 1000 || countMs > 1500) grade = 'critical';
  else if (findMs > 300 || countMs > 500) grade = 'degraded';

  const duration = Date.now() - t0;
  console.log(`[scheduler] health=${grade} find=${findMs}ms browse=${countMs}ms (${duration}ms)`);
  return grade;
}

// ── Spawn a worker ──

function spawnWorker(worker) {
  // Syntax-check the worker script before spawning — catches broken .mjs files early
  const scriptMatch = worker.cmd.match(/node\s+([\w./\-]+\.mjs)/);
  if (scriptMatch) {
    try {
      execSync(`node --check ${scriptMatch[1]}`, {
        cwd: process.env.HOME ? `${process.env.HOME}/sourcelibrary` : '/root/sourcelibrary',
        timeout: 5000,
      });
    } catch (err) {
      console.error(`[scheduler] SYNTAX ERROR in ${scriptMatch[1]} — skipping ${worker.name}`);
      return null;
    }
  }

  const timestamp = new Date().toISOString();
  appendFileSync(worker.log, `\n--- Spawned by scheduler at ${timestamp} ---\n`);

  // Open log file as fd for spawn stdio (streams don't work with spawn)
  const logFd = openSync(worker.log, 'a');

  // Use flock so the worker's own lock is held while it runs
  const fullCmd = `flock -n "${worker.lock}" bash -c "set -a; source .env.production.local; set +a; ${worker.cmd}"`;

  const child = spawn('bash', ['-c', fullCmd], {
    cwd: process.env.HOME ? `${process.env.HOME}/sourcelibrary` : '/root/sourcelibrary',
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: process.env,
  });

  child.unref();
  closeSync(logFd);
  console.log(`[scheduler] SPAWNED ${worker.name} (pid=${child.pid})`);
  return child.pid;
}

// ── Main ──

async function main() {
  const startTime = Date.now();
  console.log(`\n[scheduler] === Run at ${new Date().toISOString()} ===`);

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 2, serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db('bookstore');

    // 1. Check pause state — NO auto-resume. The scheduler does not second-guess manual pauses.
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    if (control?.paused) {
      const ageMin = control.paused_at
        ? Math.round((Date.now() - new Date(control.paused_at).getTime()) / 60000)
        : '?';
      console.log(`[scheduler] PAUSED (${ageMin}min ago, reason: ${control.paused_reason || control.paused_by || 'unknown'}). Skipping all workers.`);

      await db.collection('cron_runs').insertOne({
        cron: 'scheduler', timestamp: new Date(),
        duration_ms: Date.now() - startTime, status: 'skipped',
        summary: `paused (${ageMin}min)`,
      }).catch(() => {});

      await client.close();
      return;
    }

    // 2. Probe DB health
    const healthGrade = await probeDbHealth(db);

    // Persist health for admin dashboard
    await db.collection('system_config').updateOne(
      { _id: 'adaptive_limits' },
      {
        $set: {
          'health.grade': healthGrade,
          'health.measured_at': new Date(),
          'health.source': 'scheduler',
        },
      },
      { upsert: true }
    ).catch(() => {});

    // 2b. Reap zombie jobs — any job stuck in "processing" with no update for >30min
    //     Workers crash, get OOM-killed, or time out — their jobs rot forever.
    const ZOMBIE_THRESHOLD_MS = 30 * 60 * 1000;
    const zombieCutoff = new Date(Date.now() - ZOMBIE_THRESHOLD_MS);
    // First find zombie jobs so we can clean up their book locks too
    const zombieJobs = await db.collection('jobs').find({
      status: 'processing',
      $or: [
        { updated_at: { $lt: zombieCutoff } },
        { updated_at: { $exists: false }, started_at: { $lt: zombieCutoff } },
      ],
    }).project({ _id: 1, book_id: 1 }).toArray().catch(err => {
      console.log(`[scheduler] zombie find failed: ${err.message}`);
      return [];
    });

    if (zombieJobs.length > 0) {
      // Cancel the zombie jobs
      await db.collection('jobs').updateMany(
        { _id: { $in: zombieJobs.map(j => j._id) } },
        {
          $set: {
            status: 'cancelled',
            cancelled_at: new Date(),
            cancel_reason: 'scheduler: zombie reaper (no heartbeat for >30min)',
          },
        }
      ).catch(err => { console.log(`[scheduler] zombie cancel failed: ${err.message}`); });

      // Unset book.job on affected books so they can be re-dispatched
      const zombieBookIds = zombieJobs.map(j => j.book_id).filter(Boolean);
      if (zombieBookIds.length > 0) {
        const bookCleanup = await db.collection('books').updateMany(
          { id: { $in: zombieBookIds }, 'job': { $exists: true } },
          { $unset: { job: '' }, $set: { updated_at: new Date() } },
        ).catch(err => { console.log(`[scheduler] zombie book cleanup failed: ${err.message}`); return { modifiedCount: 0 }; });
        console.log(`[scheduler] REAPED ${zombieJobs.length} zombie jobs, unset book.job on ${bookCleanup.modifiedCount} books`);
      } else {
        console.log(`[scheduler] REAPED ${zombieJobs.length} zombie jobs (no book_ids to clean)`);
      }
    }

    // 3. Survey running workers and compute used connection budget
    const lastRuns = getLastRuns();
    const now = Date.now();
    let usedConnections = 0;
    const runningWorkers = [];

    for (const worker of WORKERS) {
      if (isLocked(worker.lock)) {
        usedConnections += worker.connections;
        runningWorkers.push(worker.name);
      }
    }

    console.log(`[scheduler] running=[${runningWorkers.join(', ')}] connections=${usedConnections}/${MAX_CONNECTIONS} health=${healthGrade}`);

    // 4. Decide which workers to spawn — in tier priority order
    const sorted = [...WORKERS].sort((a, b) => a.tier - b.tier);
    const spawned = [];
    const skipped = [];

    for (const worker of sorted) {
      // Already running?
      if (isLocked(worker.lock)) {
        if (VERBOSE) console.log(`[scheduler]   ${worker.name}: already running`);
        continue;
      }

      // Interval not elapsed?
      const lastRun = lastRuns[worker.name] || 0;
      const elapsed = (now - lastRun) / 1000;
      if (elapsed < worker.interval) {
        if (VERBOSE) console.log(`[scheduler]   ${worker.name}: interval not elapsed (${Math.round(elapsed)}/${worker.interval}s)`);
        skipped.push(`${worker.name}(interval)`);
        continue;
      }

      // Health allows?
      if (!healthAllows(healthGrade, worker.healthMin)) {
        console.log(`[scheduler]   ${worker.name}: SKIPPED (health=${healthGrade}, needs=${worker.healthMin})`);
        skipped.push(`${worker.name}(health)`);
        continue;
      }

      // Budget allows?
      if (usedConnections + worker.connections > MAX_CONNECTIONS) {
        console.log(`[scheduler]   ${worker.name}: SKIPPED (budget: ${usedConnections}+${worker.connections}>${MAX_CONNECTIONS})`);
        skipped.push(`${worker.name}(budget)`);
        continue;
      }

      // Spawn it
      if (DRY_RUN) {
        console.log(`[scheduler]   ${worker.name}: WOULD SPAWN (dry-run)`);
      } else {
        const pid = spawnWorker(worker);
        if (pid === null) {
          skipped.push(`${worker.name}(syntax)`);
          continue;
        }
        lastRuns[worker.name] = now;
      }
      usedConnections += worker.connections;
      spawned.push(worker.name);
    }

    // Save last-run times
    if (!DRY_RUN) {
      saveLastRuns(lastRuns);
    }

    // 5. Log run
    const summary = `spawned=[${spawned.join(', ')}] skipped=[${skipped.join(', ')}] running=[${runningWorkers.join(', ')}] health=${healthGrade}`;
    console.log(`[scheduler] ${summary}`);

    await db.collection('cron_runs').insertOne({
      cron: 'scheduler', timestamp: new Date(),
      duration_ms: Date.now() - startTime, status: 'ok',
      actions: { spawned, skipped, running: runningWorkers, health: healthGrade, connections: usedConnections },
      summary,
    }).catch(() => {});

    await client.close();
  } catch (err) {
    console.error(`[scheduler] FATAL: ${err.message}`);
    try { await client.close(); } catch {}
    process.exit(1);
  }

  console.log(`[scheduler] done in ${Date.now() - startTime}ms`);
}

main();
