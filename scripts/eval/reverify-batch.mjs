#!/usr/bin/env npx tsx
/**
 * Batch re-verify first-translation books with the new 7-tool pipeline.
 * Targets books verified with the old pipeline (≤5 tools).
 * Writes results to DB and logs all disposition changes.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/reverify-batch.mjs [--concurrency=5] [--limit=100] [--dry-run]
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_PATH = path.join(__dirname, 'reverify-batch-log.jsonl');

// Parse args
const args = process.argv.slice(2);
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0');
const DRY_RUN = args.includes('--dry-run');
const MAX_TOOLS_OLD = 5; // Books verified with this many tools or fewer get re-verified

// Env loading
for (const file of ['.env.production.local', '.env.local']) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        if (!process.env[m[1].trim()]) process.env[m[1].trim()] = v;
      }
    }
    break;
  } catch { /* next */ }
}

// Dynamic import for tsx compatibility
let verifyFirstTranslation;
try {
  const mod = await import('../../src/lib/verify-first-translation.ts');
  verifyFirstTranslation = mod.verifyFirstTranslation;
} catch (err) {
  console.error('Cannot import. Run with: npx tsx scripts/eval/reverify-batch.mjs');
  console.error(err.message);
  process.exit(1);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Find all first-translation books verified with old pipeline
  // Can't use $expr/$size in countDocuments reliably when field may be missing.
  // Use aggregation to find books with old-pipeline tool counts.
  // Re-verify books with old pipeline. Focus on Latin — the largest and
  // most important corpus for first-translation claims.
  const matchStage = {
    'translation_verification.tools_called': { $exists: true, $type: 'array' },
    language: 'Latin',
  };
  const sizeFilter = {
    $expr: {
      $and: [
        { $isArray: '$translation_verification.tools_called' },
        { $lte: [{ $size: '$translation_verification.tools_called' }, MAX_TOOLS_OLD] },
      ]
    },
  };

  const countResult = await db.collection('books').aggregate([
    { $match: matchStage },
    { $match: sizeFilter },
    { $count: 'total' },
  ]).toArray();
  const total = countResult[0]?.total || 0;
  const effectiveLimit = LIMIT > 0 ? Math.min(LIMIT, total) : total;

  console.log(`\nBatch Re-verification`);
  console.log(`=====================`);
  console.log(`Target: ${total} books verified with ≤${MAX_TOOLS_OLD} tools`);
  console.log(`Processing: ${effectiveLimit}${LIMIT > 0 ? ' (limited)' : ''}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no DB writes)' : 'LIVE (writing to DB)'}`);
  console.log(`Log: ${LOG_PATH}\n`);

  const books = await db.collection('books').aggregate([
    { $match: matchStage },
    { $match: sizeFilter },
    { $project: { id: 1, author: 1, display_title: 1, title: 1, language: 1,
      'translation_verification.disposition': 1 } },
    { $limit: effectiveLimit },
  ]).toArray();

  // Open log file (append mode)
  const logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
  logStream.write(JSON.stringify({
    type: 'run_start',
    date: new Date().toISOString(),
    total: books.length,
    concurrency: CONCURRENCY,
    dry_run: DRY_RUN,
  }) + '\n');

  let completed = 0;
  let changed = 0;
  let becameNotFirst = 0;
  let errors = 0;
  let totalCost = 0;
  const startTime = Date.now();

  // Process in batches of CONCURRENCY
  for (let i = 0; i < books.length; i += CONCURRENCY) {
    const batch = books.slice(i, i + CONCURRENCY);
    const promises = batch.map(async (book) => {
      const oldDisp = book.translation_verification?.disposition;
      const title = (book.display_title || book.title || '').slice(0, 45);
      const author = (book.author || '?').slice(0, 20);

      try {
        const result = await verifyFirstTranslation(db, book.id, {
          dryRun: DRY_RUN,
          force: true,
        });

        if (!result.success) {
          errors++;
          return { book, oldDisp, error: result.error };
        }

        const v = result.verification;
        totalCost += v.cost_usd || 0;
        const newDisp = v.disposition;
        const dispChanged = oldDisp !== newDisp;
        const wasFirst = ['confirmed_first', 'first_from_source', 'first_complete_translation', 'first_modern_translation'].includes(oldDisp);
        const isFirst = result.is_first_translation;

        if (dispChanged) {
          changed++;
          if (wasFirst && !isFirst) becameNotFirst++;

          // Log change
          logStream.write(JSON.stringify({
            type: 'change',
            book_id: book.id,
            author: book.author,
            title,
            language: book.language,
            old_disposition: oldDisp,
            new_disposition: newDisp,
            new_confidence: v.confidence,
            new_is_first: isFirst,
            tools_count: v.tools_called.length,
            cost_usd: v.cost_usd,
            reasoning: v.reasoning?.slice(0, 300),
            translations_found: v.translations_found?.slice(0, 3).map(t => ({
              title: t.english_title, source: t.evidence_source,
            })),
          }) + '\n');
        }

        return { book, oldDisp, newDisp, dispChanged, isFirst };
      } catch (err) {
        errors++;
        return { book, oldDisp, error: err.message };
      }
    });

    const results = await Promise.all(promises);
    completed += results.length;

    // Progress line
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
    const eta = completed > 0 ? Math.round((books.length - completed) / (completed / (Date.now() - startTime) * 1000) / 60) : '?';

    // Show status for changed items, compact for unchanged
    for (const r of results) {
      if (r.error) {
        process.stdout.write('E');
      } else if (r.dispChanged) {
        const arrow = r.isFirst ? '~' : '!';
        console.log(`\n  ${arrow} ${r.book.author?.slice(0, 20).padEnd(22)} ${r.oldDisp.padEnd(28)} → ${r.newDisp}`);
      } else {
        process.stdout.write('.');
      }
    }

    // Periodic status
    if (completed % 50 === 0 || completed === books.length) {
      console.log(`\n  [${completed}/${books.length}] ${rate}/s, ${changed} changed (${becameNotFirst} no longer first), ${errors} errors, ~${eta}min left, $${totalCost.toFixed(2)}`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);

  // Final summary
  logStream.write(JSON.stringify({
    type: 'run_complete',
    date: new Date().toISOString(),
    completed,
    changed,
    became_not_first: becameNotFirst,
    errors,
    cost_usd: totalCost,
    elapsed_minutes: parseFloat(elapsed),
  }) + '\n');
  logStream.end();

  console.log('\n' + '='.repeat(60));
  console.log('BATCH RE-VERIFICATION COMPLETE');
  console.log('='.repeat(60));
  console.log(`Processed:          ${completed}`);
  console.log(`Disposition changed: ${changed} (${(changed / completed * 100).toFixed(1)}%)`);
  console.log(`No longer "first":  ${becameNotFirst} ← real corrections`);
  console.log(`Errors:             ${errors}`);
  console.log(`Cost:               $${totalCost.toFixed(2)}`);
  console.log(`Time:               ${elapsed} minutes`);
  console.log(`Log:                ${LOG_PATH}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
