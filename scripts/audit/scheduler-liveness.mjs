#!/usr/bin/env node
/**
 * Is the scheduler alive? — the watchdog that #4528 asked for.
 *
 * On 2026-08-31 06:41 `cron.service` on the Hetzner box was OOM-killed and
 * stayed dead for 25 hours. Archiving stopped, the hourly auto-pull that
 * deploys `main` stopped, health snapshots stopped. **Nothing noticed**,
 * because every check that would have reported it was itself a cron on that
 * box — and a dead scheduler writes no logs to alarm on. The archive log sat
 * at 0 bytes, which reads exactly like "nothing to do".
 *
 * So this script must run OFF the machine it watches. It is wired to GitHub
 * Actions (`.github/workflows/scheduler-liveness.yml`), not to Hetzner cron and
 * not to Vercel — the point is that its failure domain is disjoint from the
 * thing it is checking.
 *
 * Signal: `cron_runs`. Every Hetzner worker writes a row there when it runs, so
 * "when did anything last run?" is one indexed query and needs no new
 * bookkeeping. Two questions, deliberately separate:
 *
 *   SCHEDULER — has ANY cron reported recently? Catches total cron death, which
 *               is the incident that happened.
 *   ARCHIVER  — has an archive-* cron reported recently? Catches the archiver
 *               dying while the rest of the scheduler lives.
 *
 * Exit codes: 0 healthy · 1 stale (alert pushed) · 2 could not measure.
 * A 2 is UNKNOWN, never "fine" — if this script cannot reach Mongo it says so
 * rather than reporting silence as health, which is the same mistake the
 * outage was made of.
 *
 * Usage:
 *   node scripts/audit/scheduler-liveness.mjs
 *   node scripts/audit/scheduler-liveness.mjs --no-push        # test quietly
 *   node scripts/audit/scheduler-liveness.mjs --scheduler-hours 3 --archive-hours 6
 */
import { MongoClient } from 'mongodb';

const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';
const NO_PUSH = process.argv.includes('--no-push');

function arg(name, fallback) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (hit) return Number(hit.split('=')[1]);
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return fallback;
}

// Normal cadence measured 2026-09-01: archive-bulk every ~20 min,
// pipeline-orchestrator every ~2 min. These thresholds are deliberately loose
// so a slow hour is not an alert — the failure this catches lasted 25 hours.
const SCHEDULER_HOURS = arg('scheduler-hours', 3);
const ARCHIVE_HOURS = arg('archive-hours', 6);

async function pushNtfy(title, message) {
  if (NO_PUSH) { console.log('[liveness] --no-push: skipping ntfy'); return; }
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: 'high', Tags: 'rotating_light' },
      body: message,
    });
    console.log('[liveness] ntfy push sent');
  } catch (err) {
    console.error(`[liveness] ntfy push FAILED: ${err.message}`);
  }
}

const hoursSince = (d) => d ? (Date.now() - new Date(d).getTime()) / 3600000 : Infinity;
const fmt = (h) => Number.isFinite(h) ? `${h.toFixed(1)}h` : 'never';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('[liveness] MONGODB_URI not set — cannot measure. Exiting UNKNOWN (2), not healthy.');
    process.exit(2);
  }

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 20000 });
  let anyLast, archiveRows;
  try {
    await client.connect();
    const runs = client.db('bookstore').collection('cron_runs');
    // Fall back to the ObjectId's embedded timestamp: not every cron_runs row
    // carries `started_at` (the `scheduler` rows do not), and reading a missing
    // field as "never ran" is a false alarm — caught in testing, and an alert
    // that cries wolf is worse than no alert.
    const [latest] = await runs.find({}, { projection: { started_at: 1, cron: 1 } })
      .sort({ _id: -1 }).limit(1).toArray();
    anyLast = latest?.started_at ?? latest?._id?.getTimestamp?.() ?? null;

    archiveRows = await runs.aggregate([
      { $match: { cron: /archive/i } },
      { $group: { _id: '$cron', last: { $max: '$started_at' } } },
      { $sort: { last: -1 } },
    ], { maxTimeMS: 60000 }).toArray();
  } catch (err) {
    console.error(`[liveness] could not read cron_runs: ${err.message}`);
    console.error('[liveness] exiting UNKNOWN (2) — silence here is not evidence of health.');
    await client.close().catch(() => {});
    process.exit(2);
  }
  await client.close().catch(() => {});

  // `archive-uva` last ran in April and is not a live lane; judge on the
  // freshest archive cron rather than requiring all of them.
  const archiveFreshest = archiveRows.length ? archiveRows[0] : null;
  const schedulerAge = hoursSince(anyLast);
  const archiveAge = hoursSince(archiveFreshest?.last);

  console.log(`scheduler: last cron_runs entry ${fmt(schedulerAge)} ago (threshold ${SCHEDULER_HOURS}h)`);
  console.log(`archiver:  freshest archive cron ${archiveFreshest?._id ?? 'none'} ${fmt(archiveAge)} ago (threshold ${ARCHIVE_HOURS}h)`);
  for (const r of archiveRows.slice(0, 6)) {
    console.log(`   ${String(r._id).padEnd(22)} ${fmt(hoursSince(r.last))} ago`);
  }

  const problems = [];
  if (schedulerAge > SCHEDULER_HOURS) {
    problems.push(`SCHEDULER SILENT ${fmt(schedulerAge)} — no cron of any kind has reported. This is what an OOM-killed cron.service looks like (2026-08-31, #4528). Check: ssh root@46.224.122.120 'systemctl status cron'`);
  }
  if (archiveAge > ARCHIVE_HOURS) {
    problems.push(`ARCHIVER SILENT ${fmt(archiveAge)} — freshest archive cron is ${archiveFreshest?._id ?? 'none'}. Archiving has stopped even if other crons run.`);
  }

  if (!problems.length) {
    console.log('\nHEALTHY — scheduler and archiver both reporting.');
    process.exit(0);
  }

  const message = problems.join('\n\n');
  console.error(`\nSTALE:\n${message}`);
  await pushNtfy('Source Library: scheduler/archiver stopped', message);
  process.exit(1);
}

main().catch(err => {
  console.error(`[liveness] unexpected: ${err.message}`);
  process.exit(2);
});
