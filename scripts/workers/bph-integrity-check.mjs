#!/usr/bin/env node
/**
 * BPH catalogue integrity check — makes "distorted" knowable.
 *
 * Backups protect against losing the catalogue. The revision trail records
 * edits made through the editor. Neither notices a script, a stray credential,
 * or a well-meaning bulk sweep silently rewriting thousands of rows — nothing
 * is missing, nothing errors, and the catalogue simply says something slightly
 * different than it used to. That is the failure this exists to catch.
 *
 * Each run fingerprints every record in five column groups and compares
 * against the stored baseline, then classifies every change:
 *
 *   revision    — a matching bph_works_revisions row exists. Accounted for.
 *   automation  — only automation-owned columns moved (sl_book_id sync, IA
 *                 matching, Memorix file bookkeeping). Expected churn.
 *   UNEXPLAINED — anything else. Someone should look.
 *
 * Only UNEXPLAINED pages a human, and only on the run that finds it — a
 * detector that repeats itself nightly trains you to ignore it (the same
 * reason traffic-anomaly-alert pushes on state change only).
 *
 * The heavy lifting is a Postgres function (bph_integrity_scan) so this is one
 * round trip rather than 30K rows over the wire. See
 * scripts/migration/add-bph-integrity-monitor.sql for the column grouping —
 * that file is where you declare which group a new column belongs to.
 *
 * Cron: 30 4 * * *  (after the 04:00 backup, before restic at 05:00, so a
 * flagged night is captured in that night's snapshot)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/bph-integrity-check.mjs [--no-push] [--json]
 */

import { createClient } from '@supabase/supabase-js';

const NO_PUSH = process.argv.includes('--no-push');
const AS_JSON = process.argv.includes('--json');
const NTFY_TOPIC = 'https://ntfy.sh/sourcelibrary-uptime';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[bph-integrity] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function push(title, body, priority = 'default') {
  if (NO_PUSH) {
    console.log(`[bph-integrity] --no-push: would send "${title}"`);
    return;
  }
  try {
    await fetch(NTFY_TOPIC, {
      method: 'POST',
      headers: { Title: title, Priority: priority },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    console.log('[bph-integrity] ntfy push sent');
  } catch (err) {
    console.error(`[bph-integrity] ntfy push failed: ${err.message}`);
  }
}

async function main() {
  const { data, error } = await sb.rpc('bph_integrity_scan');

  if (error) {
    // A scan that cannot run is itself an alert: the detector going quiet and
    // the catalogue being untouched look identical from the outside.
    console.error(`[bph-integrity] scan failed: ${error.message}`);
    await push(
      'BPH integrity check FAILED to run',
      `The catalogue integrity scan could not complete: ${error.message}\n\n` +
        'Nothing is known about changes since the last successful run.',
      'high',
    );
    process.exit(1);
  }

  const events = data || [];
  const unexplained = events.filter((e) => e.explanation === 'UNEXPLAINED');
  const byRevision = events.filter((e) => e.explanation === 'revision');
  const byAutomation = events.filter((e) => e.explanation === 'automation');

  if (AS_JSON) {
    console.log(JSON.stringify({ total: events.length, unexplained, byRevision: byRevision.length, byAutomation: byAutomation.length }, null, 2));
  } else {
    console.log(`[bph-integrity] ${events.length} change(s) since last scan`);
    console.log(`  explained by a revision : ${byRevision.length}`);
    console.log(`  expected automation     : ${byAutomation.length}`);
    console.log(`  UNEXPLAINED             : ${unexplained.length}`);
  }

  if (unexplained.length === 0) {
    console.log('[bph-integrity] catalogue accounted for.');
    return;
  }

  // Group for a readable alert: "17 records, bibliography + location" beats a
  // wall of UBNs, and the UBNs are in the events table for whoever follows up.
  const groups = new Map();
  for (const e of unexplained) {
    const key = (e.groups_changed || []).join('+') || e.kind;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const summary = [...groups.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `  ${n} × ${g}`)
    .join('\n');
  const sample = unexplained.slice(0, 10).map((e) => e.ubn).join(', ');

  const body =
    `${unexplained.length} catalogue record(s) changed with no revision and outside automation:\n\n` +
    `${summary}\n\n` +
    `UBNs: ${sample}${unexplained.length > 10 ? ` … +${unexplained.length - 10} more` : ''}\n\n` +
    'Review: select * from bph_works_integrity_events where explanation=\'UNEXPLAINED\' and reviewed_at is null;\n' +
    'Prior values are in that night\'s backup (/root/backups/bph-catalog-latest) and, for editor changes, bph_works_revisions.';

  console.error(`[bph-integrity] UNEXPLAINED changes:\n${body}`);
  await push(`BPH catalogue: ${unexplained.length} unexplained change(s)`, body, 'high');
}

main().catch(async (err) => {
  console.error(`[bph-integrity] fatal: ${err.message}`);
  await push('BPH integrity check CRASHED', String(err.message), 'high');
  process.exit(1);
});
