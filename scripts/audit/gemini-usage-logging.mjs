#!/usr/bin/env node
/**
 * Standing audit: which Gemini call sites do NOT log usage?
 *
 * WHY. Spend metering failed the same way the entity writers and the search
 * boxes did — a new caller was added and nobody remembered to log it, and
 * forgetting produces SILENCE, not an error. In Aug 2026 that meant ~4.9M
 * embeddings were invisible to every cost surface, and total recorded spend
 * read $7.5K against a corpus that plainly cost far more (#3576).
 *
 * This makes the omission visible instead of silent. It does NOT fail the
 * build: many call sites are legitimately unmetered (one-off analysis scripts,
 * validate-key probes). The point is that the list is SHORT and REVIEWED, not
 * that it is empty.
 *
 *   node scripts/audit/gemini-usage-logging.mjs            # pipeline paths
 *   node scripts/audit/gemini-usage-logging.mjs --all      # every caller
 *   node scripts/audit/gemini-usage-logging.mjs --strict   # exit 1 if a WORKER is unlogged
 */

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ALL = process.argv.includes('--all');
const STRICT = process.argv.includes('--strict');

const CALL_RE = /generateContent|batchEmbedContents|generativelanguage\.googleapis/;
const LOG_RE = /logUsage|logUsageAsync|logGeminiUsage|completeBatchUsage|buildUsagePayload|gemini_usage/;

// Paths that run repeatedly at scale. An unlogged caller here is a real hole;
// elsewhere it is usually a one-off and only worth listing.
const PIPELINE = ['scripts/workers/', 'src/workers/', 'src/lib/', 'src/app/api/'];

/**
 * Known-and-accepted omissions. Each needs a REASON — an unexplained entry
 * here is how a real hole gets grandfathered in.
 */
const ACCEPTED = {
  'src/app/api/contribute/validate-key/route.ts': 'probes a user-supplied key; no corpus work, cost is the caller\'s',
};

const files = execSync(
  "git grep -lE 'generateContent|batchEmbedContents|generativelanguage\\.googleapis' -- scripts src ':!*_archived*'",
  { encoding: 'utf8' }
).trim().split('\n').filter(Boolean);

const rows = [];
for (const f of files) {
  let src = '';
  try { src = readFileSync(f, 'utf8'); } catch { continue; }
  if (!CALL_RE.test(src)) continue;
  const logged = LOG_RE.test(src);
  const isPipeline = PIPELINE.some(p => f.startsWith(p));
  const isWorker = f.startsWith('scripts/workers/') || f.startsWith('src/workers/');
  if (!ALL && !isPipeline) continue;
  rows.push({ f, logged, isWorker, accepted: ACCEPTED[f] });
}

const unlogged = rows.filter(r => !r.logged && !r.accepted);
const workers = unlogged.filter(r => r.isWorker);

console.log(`Gemini call sites scanned: ${rows.length}${ALL ? ' (all)' : ' (pipeline paths)'}`);
console.log(`  logged:   ${rows.filter(r => r.logged).length}`);
console.log(`  accepted: ${rows.filter(r => r.accepted).length}`);
console.log(`  UNLOGGED: ${unlogged.length}${workers.length ? `  (${workers.length} of them WORKERS)` : ''}`);

if (workers.length) {
  console.log('\n── WORKERS with no usage logging — these run at scale, fix them ──');
  for (const r of workers) console.log(`  ${r.f}`);
}
const rest = unlogged.filter(r => !r.isWorker);
if (rest.length) {
  console.log('\n── other unlogged call sites (review; many are legitimately one-off) ──');
  for (const r of rest) console.log(`  ${r.f}`);
}
if (rows.some(r => r.accepted)) {
  console.log('\n── accepted omissions ──');
  for (const r of rows.filter(x => x.accepted)) console.log(`  ${r.f}\n      ${r.accepted}`);
}

console.log('\nMetering notes:');
console.log('  · Log via scripts/workers/lib/supabase-usage-logger.mjs (logUsage/logUsageAsync).');
console.log('    It writes Supabase and falls back to Mongo — do NOT insert to gemini_usage directly.');
console.log('  · Log BEFORE any early return on empty output: an empty candidate is still billed.');
console.log('  · Batch spend belongs in batch_jobs, not gemini_usage — batch usage rows are');
console.log('    placeholders written at submit time (#3452). See scripts/analysis/true-gemini-spend.mjs.');

if (STRICT && workers.length) {
  console.error(`\nFAIL: ${workers.length} worker(s) call Gemini without logging usage.`);
  process.exit(1);
}
