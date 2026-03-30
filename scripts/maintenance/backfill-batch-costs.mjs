#!/usr/bin/env node

/**
 * Backfill batch OCR/translation costs from per-page token data.
 *
 * The batch-collector didn't write cost_usd or token totals to batch_jobs
 * or gemini_usage until 2026-03-30. This script:
 *   1. Aggregates all page tokens grouped by batch_job_id (single query)
 *   2. Calculates cost_usd using batch pricing (50% discount)
 *   3. Bulk-updates batch_jobs with token totals and cost
 *   4. Upserts gemini_usage records (mode: 'batch') with correct costs
 *   5. Rebuilds gemini_usage_daily for affected days
 *
 * Safe to re-run (idempotent).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-batch-costs.mjs
 *   node scripts/maintenance/backfill-batch-costs.mjs --dry-run
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const DRY_RUN = process.argv.includes('--dry-run');

const MODEL_PRICING = {
  'gemini-3.1-flash-lite-preview': { input: 0.25, output: 1.50 },
  'gemini-3-flash-preview': { input: 0.50, output: 3.00 },
  'gemini-3-pro-preview': { input: 2.50, output: 10.00 },
  'gemini-2.5-flash': { input: 0.15, output: 0.60 },
  'gemini-2.5-pro': { input: 1.25, output: 5.00 },
  'gemini-1.5-flash': { input: 0.075, output: 0.30 },
  'gemini-1.5-pro': { input: 1.25, output: 5.00 },
};
const BATCH_DISCOUNT = 0.5;

function calculateCost(model, inputTokens, outputTokens) {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['gemini-2.5-flash'];
  const inputCost = (inputTokens / 1_000_000) * pricing.input * BATCH_DISCOUNT;
  const outputCost = (outputTokens / 1_000_000) * pricing.output * BATCH_DISCOUNT;
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log(`Backfilling batch costs from per-page token data...${DRY_RUN ? ' (dry run)' : ''}`);
  const start = Date.now();

  // Step 1: Build a map of batch_job_id → {model, book_id, completed_at, type}
  const jobs = await db.collection('batch_jobs')
    .find({
      status: { $in: ['saved', 'completed', 'completed_with_errors'] },
      $or: [
        { cost_usd: { $exists: false } },
        { cost_usd: null },
        { cost_usd: 0 },
      ],
    })
    .project({ _id: 1, id: 1, type: 1, book_id: 1, model: 1, completed_at: 1 })
    .toArray();

  console.log(`Found ${jobs.length} batch jobs without cost data`);
  if (jobs.length === 0) { await client.close(); return; }

  const jobMap = new Map();
  for (const j of jobs) {
    const jid = j.id || String(j._id);
    jobMap.set(jid, j);
  }

  // Step 2: Aggregate tokens from pages, grouped by batch_job_id — two queries (OCR + translation)
  console.log('Aggregating OCR page tokens...');
  const ocrTokens = await db.collection('pages').aggregate([
    { $match: { 'ocr.batch_job_id': { $exists: true }, 'ocr.input_tokens': { $gt: 0 } } },
    { $group: {
      _id: '$ocr.batch_job_id',
      inputTokens: { $sum: '$ocr.input_tokens' },
      outputTokens: { $sum: '$ocr.output_tokens' },
      pageCount: { $sum: 1 },
    }},
  ], { allowDiskUse: true }).toArray();
  console.log(`  ${ocrTokens.length} OCR batch groups found`);

  console.log('Aggregating translation page tokens...');
  const transTokens = await db.collection('pages').aggregate([
    { $match: { 'translation.batch_job_id': { $exists: true }, 'translation.input_tokens': { $gt: 0 } } },
    { $group: {
      _id: '$translation.batch_job_id',
      inputTokens: { $sum: '$translation.input_tokens' },
      outputTokens: { $sum: '$translation.output_tokens' },
      pageCount: { $sum: 1 },
    }},
  ], { allowDiskUse: true }).toArray();
  console.log(`  ${transTokens.length} translation batch groups found`);

  // Merge into one map
  const tokenMap = new Map();
  for (const t of [...ocrTokens, ...transTokens]) {
    tokenMap.set(t._id, t);
  }

  // Step 3: Calculate costs and build bulk operations
  const batchJobOps = [];
  const usageOps = [];
  let totalCost = 0;
  let matched = 0;
  const affectedDates = new Set();

  for (const [jobId, tokens] of tokenMap) {
    const job = jobMap.get(jobId);
    if (!job) continue; // already has cost or different status

    const costUsd = calculateCost(job.model, tokens.inputTokens, tokens.outputTokens);
    totalCost += costUsd;
    matched++;

    if (job.completed_at) {
      affectedDates.add(job.completed_at.toISOString().slice(0, 10));
    }

    batchJobOps.push({
      updateOne: {
        filter: { _id: job._id },
        update: {
          $set: {
            input_tokens: tokens.inputTokens,
            output_tokens: tokens.outputTokens,
            cost_usd: costUsd,
          },
        },
      },
    });

    usageOps.push({
      updateOne: {
        filter: { batch_job_id: jobId, mode: 'batch' },
        update: {
          $set: {
            type: job.type === 'ocr' ? 'ocr' : 'translation',
            mode: 'batch',
            model: job.model,
            book_id: job.book_id,
            page_count: tokens.pageCount,
            input_tokens: tokens.inputTokens,
            output_tokens: tokens.outputTokens,
            cost_usd: costUsd,
            status: 'success',
            batch_job_id: jobId,
            timestamp: job.completed_at || new Date(),
          },
        },
        upsert: true,
      },
    });
  }

  console.log(`\nMatched ${matched} jobs with page token data`);
  console.log(`Unmatched (no page tokens): ${jobs.length - matched}`);
  console.log(`Total batch cost: $${totalCost.toFixed(2)}`);
  console.log(`Affected dates: ${affectedDates.size}`);

  if (DRY_RUN) {
    console.log('\nDry run — no writes');
    await client.close();
    return;
  }

  // Step 4: Bulk write
  console.log('\nWriting batch_jobs updates...');
  if (batchJobOps.length > 0) {
    const r = await db.collection('batch_jobs').bulkWrite(batchJobOps, { ordered: false });
    console.log(`  Modified: ${r.modifiedCount}`);
  }

  console.log('Writing gemini_usage upserts...');
  if (usageOps.length > 0) {
    // Process in chunks to avoid memory issues
    const CHUNK = 1000;
    for (let i = 0; i < usageOps.length; i += CHUNK) {
      const chunk = usageOps.slice(i, i + CHUNK);
      const r = await db.collection('gemini_usage').bulkWrite(chunk, { ordered: false });
      console.log(`  Chunk ${Math.floor(i / CHUNK) + 1}: upserted ${r.upsertedCount}, modified ${r.modifiedCount}`);
    }
  }

  // Step 5: Rebuild gemini_usage_daily for affected dates
  console.log(`\nRebuilding gemini_usage_daily for ${affectedDates.size} dates...`);
  for (const dateStr of [...affectedDates].sort()) {
    const dayStart = new Date(dateStr + 'T00:00:00Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const [result] = await db.collection('gemini_usage').aggregate([
      { $match: { timestamp: { $gte: dayStart, $lt: dayEnd } } },
      {
        $group: {
          _id: null,
          totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
          totalInputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
          totalOutputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
          totalRecords: { $sum: 1 },
        },
      },
    ]).toArray();

    if (result && result.totalRecords > 0) {
      await db.collection('gemini_usage_daily').updateOne(
        { date: dateStr },
        {
          $set: {
            totalCost: result.totalCost,
            totalInputTokens: result.totalInputTokens,
            totalOutputTokens: result.totalOutputTokens,
            totalRecords: result.totalRecords,
            updatedAt: new Date(),
          },
        },
        { upsert: true }
      );
    }
  }
  console.log('  Done');

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\nComplete in ${elapsed}s`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
