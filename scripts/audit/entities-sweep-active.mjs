#!/usr/bin/env node

/**
 * Is a bulk `entities` writer running right now? (the pre-merge interlock)
 *
 * WHY THIS EXISTS
 * `/explore` is ISR and prerenders at BUILD time, and its counts run
 * `countDocuments` + `distinct('type')` over ~1M `entities` docs with
 * `maxTimeMS: 25000`. They already sit close to that cap, so a concurrent bulk
 * writer tips them over and the production build exits 1 — losing a ten-minute
 * deploy. Since a merge to `main` builds production, the check belongs at MERGE
 * time. See CLAUDE.md, "Pause `entities` bulk sweeps before deploying prod".
 *
 * THIS DOES NOT REPLACE THE pgrep CHECK — it covers the case pgrep cannot.
 * CLAUDE.md prescribes `pgrep -af "[r]epair-entity"` on both machines, and the
 * `[r]` bracket (added 2026-08-13) correctly stops the pattern matching its own
 * command line. The remaining gap is different: **the ssh half needs the box to
 * answer.** On 2026-08-17 ssh to Hetzner connected and was then reset on every
 * attempt, so the interlock simply could not be evaluated — and "I could not
 * check" must never be read as "clear".
 *
 * This asks the database instead: has anything bulk-written `entities`
 * recently? That is the condition the build actually cares about. It works when
 * the box is unreachable, it catches a sweep run from ANY machine (including
 * one nobody remembers), and it cannot self-match.
 *
 * Prefer pgrep when ssh works — it names the process. Use this when ssh cannot
 * answer, or as the second opinion before a risky merge.
 *
 * USAGE
 *   node --env-file=.env.production.local scripts/audit/entities-sweep-active.mjs
 *   exit 0 = quiet, safe to merge/deploy · exit 1 = active writer · exit 2 = error
 *
 * Flags: --window-min N (default 10), --threshold N (default 50)
 */

import { MongoClient } from 'mongodb';

function arg(flag, dflt) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
}

const WINDOW_MIN = arg('--window-min', 10);
const THRESHOLD = arg('--threshold', 50);

const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
if (!uri) {
  console.error('Missing MONGODB_URI.');
  process.exit(2);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

try {
  await client.connect();
  const db = client.db(process.env.DB_NAME || 'bookstore');
  const since = new Date(Date.now() - WINDOW_MIN * 60_000);

  // Indexed-ish and bounded: we only need "are there many", not the exact count.
  const recent = await db.collection('entities').countDocuments(
    { updated_at: { $gte: since } },
    { maxTimeMS: 20000, limit: THRESHOLD + 1 },
  );

  const active = recent > THRESHOLD;
  console.log(`entities updated in the last ${WINDOW_MIN}m: ${recent}${recent > THRESHOLD ? '+' : ''} (threshold ${THRESHOLD})`);

  if (active) {
    console.log('\n!! A bulk `entities` writer looks ACTIVE.');
    console.log('   Do not merge to main / deploy prod yet — the /explore prerender');
    console.log('   runs its counts with maxTimeMS 25000 and will tip over, failing');
    console.log('   the build. Wait for the sweep to finish, then re-run this.');
  } else {
    console.log('\nQuiet — safe to merge/deploy as far as the entities interlock goes.');
  }

  await client.close();
  process.exit(active ? 1 : 0);
} catch (err) {
  // Fail LOUD, never silently "clear": an unanswerable check is not an all-clear.
  console.error(`Check could not run: ${err.message || err}`);
  console.error('Treat this as UNKNOWN, not as safe.');
  try { await client.close(); } catch {}
  process.exit(2);
}
