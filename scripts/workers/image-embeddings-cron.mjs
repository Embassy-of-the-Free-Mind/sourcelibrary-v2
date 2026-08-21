#!/usr/bin/env node
/**
 * Nightly incremental update for the three image-side embedding tables that
 * don't have an inline writer in the pipeline:
 *
 *   - artwork_embeddings       (Gemini text on artwork metadata)
 *   - gallery_text_embeddings  (Gemini text on gallery image descriptions)
 *   - clip_embeddings          (CLIP visual on artworks, book covers, gallery)
 *
 * book_embeddings is intentionally NOT here — enrich-worker writes it inline
 * during Phase 6.5. See issue #2021 for context.
 *
 * Each underlying backfill script is already idempotent: it loads the set of
 * already-embedded ids from Supabase and only embeds the diff. So this
 * wrapper is safe to run repeatedly; if interrupted it will resume on the
 * next run.
 *
 * Required env (in production): MONGODB_URI, SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL, GEMINI_API_KEY.
 *
 * The cron entry on Hetzner re-exports
 *   GEMINI_API_KEY=$GEMINI_API_KEY_TIER3
 * so the Gemini calls run on the paid tier 3 quota (matches the existing
 * embed-gemini cron pattern in .claude/docs/hetzner-scheduler-crontab.md).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { budgetAllowsDispatch } from '../lib/spend-guard.mjs';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');

const PHASES = [
  {
    name: 'artwork',
    script: 'scripts/migration/backfill-artwork-embeddings.mjs',
    args: ['--incremental'],
  },
  {
    name: 'gallery-text',
    script: 'scripts/migration/backfill-gallery-text-embeddings.mjs',
    args: [],
  },
  {
    name: 'clip',
    script: 'scripts/backfill-clip-embeddings.mjs',
    args: [],
  },
];

function runPhase(phase) {
  return new Promise((resolve) => {
    const started = Date.now();
    console.log(`\n[${new Date().toISOString()}] === ${phase.name} starting ===`);
    const child = spawn(
      process.execPath,
      [path.join(REPO_ROOT, phase.script), ...phase.args],
      { cwd: REPO_ROOT, stdio: 'inherit', env: process.env },
    );
    child.on('exit', (code) => {
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `[${new Date().toISOString()}] === ${phase.name} exit ${code} (${secs}s) ===`,
      );
      resolve(code ?? 1);
    });
    child.on('error', (err) => {
      console.error(`[${phase.name}] spawn error:`, err.message);
      resolve(1);
    });
  });
}

async function main() {
  // Pause + dial gate (#3826). This cron ran nightly on the paid TIER3 key
  // with NO pause check and NO budget check — an ungated paid path straight
  // through the incident pause. The child backfills are idempotent, so a
  // skipped night simply resumes later.
  {
    const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 2 });
    await client.connect();
    const db = client.db('bookstore');
    const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
    if (control?.paused) {
      console.log('[image-embeddings] Pipeline paused — exiting.');
      await client.close();
      process.exit(0);
    }
    const allowed = await budgetAllowsDispatch(db, 'image-embeddings-cron', { control });
    await client.close();
    if (!allowed) process.exit(0);
  }

  const results = [];
  for (const phase of PHASES) {
    const code = await runPhase(phase);
    results.push({ name: phase.name, code });
  }

  const failed = results.filter((r) => r.code !== 0);
  console.log(
    `\n[${new Date().toISOString()}] summary: ${results.length - failed.length}/${results.length} ok` +
      (failed.length ? `, failed: ${failed.map((f) => `${f.name}(${f.code})`).join(', ')}` : ''),
  );
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});
