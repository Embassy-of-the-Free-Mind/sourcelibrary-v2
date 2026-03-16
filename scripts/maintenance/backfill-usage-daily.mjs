#!/usr/bin/env node

/**
 * Backfill gemini_usage_daily from gemini_usage collection.
 *
 * Creates one document per UTC day with pre-aggregated cost, token, model,
 * type, endpoint, and error stats. Safe to re-run (upserts by date).
 *
 * Processes one day at a time to avoid MongoDB memory limits.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-usage-daily.mjs
 *
 *   Options:
 *     --dry-run    Show what would be written without writing
 *     --since      Only backfill from this date (YYYY-MM-DD), default: all time
 */

import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const sinceIdx = args.indexOf('--since');
const sinceDate = sinceIdx !== -1 ? args[sinceIdx + 1] : null;

async function aggregateDay(db, dayStart, dayEnd) {
  const [result] = await db.collection('gemini_usage').aggregate([
    { $match: { timestamp: { $gte: dayStart, $lt: dayEnd } } },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        totalCost: { $sum: { $ifNull: ['$cost_usd', 0] } },
        totalInputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
        totalOutputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
        totalRecords: { $sum: 1 },
      }}],
      byType: [{ $group: {
        _id: '$type',
        count: { $sum: 1 },
        cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
        inputTokens: { $sum: { $ifNull: ['$input_tokens', 0] } },
        outputTokens: { $sum: { $ifNull: ['$output_tokens', 0] } },
        successCount: { $sum: { $cond: [{ $eq: ['$status', 'success'] }, 1, 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pageCount: { $sum: { $ifNull: ['$page_count', 0] } },
      }}],
      byModel: [{ $group: {
        _id: '$model',
        count: { $sum: 1 },
        cost: { $sum: { $ifNull: ['$cost_usd', 0] } },
      }}],
      byEndpoint: [
        { $match: { endpoint: { $exists: true, $ne: null } } },
        { $group: { _id: '$endpoint', count: { $sum: 1 } } },
      ],
      byErrorCategory: [
        { $match: { status: 'failed', error_category: { $exists: true } } },
        { $group: {
          _id: '$error_category',
          count: { $sum: 1 },
          lastMessage: { $last: '$error_message' },
        }},
      ],
    }},
  ]).toArray();

  const totals = result?.totals?.[0];
  if (!totals || totals.totalRecords === 0) return null;

  const byType = {};
  for (const t of (result.byType || [])) {
    byType[t._id || 'unknown'] = {
      count: t.count, cost: t.cost, inputTokens: t.inputTokens,
      outputTokens: t.outputTokens, successCount: t.successCount,
      failedCount: t.failedCount, pageCount: t.pageCount,
    };
  }

  const byModel = {};
  for (const m of (result.byModel || [])) {
    byModel[m._id || 'unknown'] = { count: m.count, cost: m.cost };
  }

  const byEndpoint = {};
  for (const e of (result.byEndpoint || [])) {
    byEndpoint[e._id] = e.count;
  }

  const byErrorCategory = {};
  for (const e of (result.byErrorCategory || [])) {
    byErrorCategory[e._id || 'unknown'] = {
      count: e.count,
      lastMessage: (e.lastMessage || '').substring(0, 200),
    };
  }

  return {
    totalCost: totals.totalCost,
    totalInputTokens: totals.totalInputTokens,
    totalOutputTokens: totals.totalOutputTokens,
    totalRecords: totals.totalRecords,
    byType, byModel, byEndpoint, byErrorCategory,
  };
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  console.log('Backfilling gemini_usage_daily (one day at a time)...');
  if (dryRun) console.log('(dry run — no writes)');

  // Find date range
  let startDate;
  if (sinceDate) {
    startDate = new Date(sinceDate + 'T00:00:00Z');
  } else {
    const oldest = await db.collection('gemini_usage')
      .find({ timestamp: { $exists: true } })
      .sort({ timestamp: 1 })
      .limit(1)
      .project({ timestamp: 1 })
      .toArray();
    if (oldest.length === 0) {
      console.log('No gemini_usage records found');
      await client.close();
      return;
    }
    startDate = new Date(oldest[0].timestamp.toISOString().slice(0, 10) + 'T00:00:00Z');
  }

  const now = new Date();
  const endDate = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  endDate.setDate(endDate.getDate() + 1); // include today

  console.log(`Date range: ${startDate.toISOString().slice(0, 10)} → ${now.toISOString().slice(0, 10)}`);

  let daysProcessed = 0;
  let totalRecords = 0;
  let totalCost = 0;
  const overallStart = Date.now();

  // Iterate day by day
  const cursor = new Date(startDate);
  while (cursor < endDate) {
    const dateStr = cursor.toISOString().slice(0, 10);
    const dayStart = new Date(dateStr + 'T00:00:00Z');
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const summary = await aggregateDay(db, dayStart, dayEnd);

    if (summary) {
      if (dryRun) {
        console.log(`  ${dateStr}: ${summary.totalRecords} records, $${summary.totalCost.toFixed(4)}`);
      } else {
        await db.collection('gemini_usage_daily').updateOne(
          { date: dateStr },
          { $set: { date: dateStr, ...summary, updatedAt: new Date() } },
          { upsert: true },
        );
      }
      daysProcessed++;
      totalRecords += summary.totalRecords;
      totalCost += summary.totalCost;

      if (daysProcessed % 50 === 0) {
        console.log(`  ... ${daysProcessed} days processed (${totalRecords} records, $${totalCost.toFixed(2)})`);
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  if (!dryRun && daysProcessed > 0) {
    // Create index
    try {
      await db.collection('gemini_usage_daily').createIndex(
        { date: -1 },
        { unique: true, name: 'gemini_usage_daily_date_idx' }
      );
      console.log('Index created: { date: -1 } (unique)');
    } catch (e) {
      if (e.message?.includes('already exists')) {
        console.log('Index already exists');
      } else {
        console.warn('Index creation warning:', e.message);
      }
    }
  }

  const elapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
  console.log(`\nDone: ${daysProcessed} days, ${totalRecords} records, $${totalCost.toFixed(2)} total cost, ${elapsed}s`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
