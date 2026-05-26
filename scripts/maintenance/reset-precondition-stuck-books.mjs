#!/usr/bin/env node
/**
 * Reset books stuck in pipeline_auto.status="failed" with the
 * "Precondition check failed" error so the orchestrator picks them up again.
 *
 * Root cause: the orchestrator submitted OCR batches against the deprecated
 * `gemini-3.1-flash-lite-preview` Gemini alias. Batch CREATE accepts the alias
 * but batch EXECUTION returns FAILED_PRECONDITION for every page (verified
 * 2026-05-26 — 82/82 batches using this alias in last 24h returned 0 saved /
 * 100% failed). The model constants were corrected to `gemini-3.1-flash-lite`
 * (stable) in commit f346e288 (#2042). 1,463 books accumulated in failed state.
 *
 * PREREQUISITE: confirm Hetzner is on the post-f346e288 code BEFORE running
 * with --apply. Otherwise the reset books will fail again on the next
 * orchestrator cycle. Check with:
 *   ssh hetzner-box "cd /root/sourcelibrary && git log -1 --format='%h %s' scripts/workers/pipeline-orchestrator.mjs"
 * The result must show f346e288 or later.
 *
 * Reset strategy:
 *   - Set pipeline_auto.status from 'failed' → 'archive_complete' so the
 *     orchestrator's Phase 2 picks them up for OCR re-submit.
 *   - Reset pipeline_auto.retry_count to 0 (otherwise it'd skip them).
 *   - Preserve original error and failure timestamp in
 *     pipeline_auto.error_history for auditing.
 *   - Books that have pages_ocr >= pages_count (already fully done) get
 *     'complete' instead of 'archive_complete' since there's nothing left.
 *
 * Usage:
 *   node scripts/maintenance/reset-precondition-stuck-books.mjs              # dry-run
 *   node scripts/maintenance/reset-precondition-stuck-books.mjs --apply      # reset
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.production.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';

async function main() {
  const dryRun = !process.argv.includes('--apply');
  console.log('=== Reset Precondition-stuck books ===');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'APPLYING');
  console.log();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 3, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db(MONGODB_DB);

  const baseQ = {
    'pipeline_auto.status': 'failed',
    'pipeline_auto.error': { $regex: 'Precondition check failed' },
  };

  const total = await db.collection('books').countDocuments(baseQ);
  console.log(`Stuck books matching pattern: ${total}`);

  // Triage by how much work is left
  const allDoneQ = { ...baseQ, $expr: { $gte: ['$pages_ocr', '$pages_count'] } };
  const allDone = await db.collection('books').countDocuments(allDoneQ);
  const needsWork = total - allDone;

  console.log(`  Already fully OCR'd (→ complete):       ${allDone}`);
  console.log(`  Needs orchestrator re-pickup (→ archive_complete): ${needsWork}`);
  console.log();

  if (dryRun) {
    console.log('Dry-run complete. Re-run with --apply.');
    await client.close();
    return;
  }

  const now = new Date();
  let updated = 0;

  // Process each book individually to preserve error history
  const cursor = db.collection('books').find(baseQ).project({ _id: 1, id: 1, pages_count: 1, pages_ocr: 1, pipeline_auto: 1 });
  for await (const book of cursor) {
    const isDone = (book.pages_ocr || 0) >= (book.pages_count || 0);
    const newStatus = isDone ? 'complete' : 'archive_complete';

    const errorHistory = book.pipeline_auto?.error_history || [];
    errorHistory.push({
      error: book.pipeline_auto?.error,
      failed_at: book.pipeline_auto?.last_updated,
      retry_count: book.pipeline_auto?.retry_count,
      reset_at: now,
      reset_reason: 'gemini-3.1-flash-lite-preview deprecation (fix: f346e288)',
    });

    const res = await db.collection('books').updateOne(
      { _id: book._id },
      {
        $set: {
          'pipeline_auto.status': newStatus,
          'pipeline_auto.last_updated': now,
          'pipeline_auto.retry_count': 0,
          'pipeline_auto.error_history': errorHistory,
          updated_at: now,
        },
        $unset: { 'pipeline_auto.error': '' },
      }
    );
    if (res.modifiedCount === 1) updated++;
    if (updated % 100 === 0) console.log(`  [${updated}/${total}] reset...`);
  }

  console.log(`\nDone. Reset ${updated} books.`);
  await client.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
