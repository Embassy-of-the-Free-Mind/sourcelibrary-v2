#!/usr/bin/env node
/**
 * Analyze split adjustments to improve the algorithm
 *
 * Usage: node scripts/analyze-split-adjustments.js
 *
 * Requires MONGODB_URI environment variable
 */

const { MongoClient } = require('mongodb');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI not set');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  console.log('=== Split Adjustment Analysis ===\n');

  // Get all adjustments
  const adjustments = await db.collection('split_adjustments')
    .find({})
    .sort({ timestamp: -1 })
    .toArray();

  if (adjustments.length === 0) {
    console.log('No adjustments logged yet. Split some pages and manually adjust them to collect data.');
    await client.close();
    return;
  }

  console.log(`Total adjustments: ${adjustments.length}\n`);

  // Basic stats
  const deltas = adjustments.map(a => a.delta);
  const absDeltas = deltas.map(d => Math.abs(d));
  const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  const avgAbsDelta = absDeltas.reduce((a, b) => a + b, 0) / absDeltas.length;
  const maxAbsDelta = Math.max(...absDeltas);

  console.log('--- Delta Statistics ---');
  console.log(`Average delta: ${avgDelta.toFixed(1)} (${(avgDelta / 10).toFixed(2)}%)`);
  console.log(`Average |delta|: ${avgAbsDelta.toFixed(1)} (${(avgAbsDelta / 10).toFixed(2)}%)`);
  console.log(`Max |delta|: ${maxAbsDelta} (${(maxAbsDelta / 10).toFixed(1)}%)`);

  // Direction bias
  const leftAdjustments = deltas.filter(d => d < 0).length;
  const rightAdjustments = deltas.filter(d => d > 0).length;
  console.log(`\nDirection: ${leftAdjustments} left, ${rightAdjustments} right`);
  if (leftAdjustments > rightAdjustments * 1.5) {
    console.log('→ Algorithm tends to detect too far RIGHT');
  } else if (rightAdjustments > leftAdjustments * 1.5) {
    console.log('→ Algorithm tends to detect too far LEFT');
  }

  // Distribution of detected positions
  console.log('\n--- Detected Position Distribution ---');
  const buckets = { '45-47%': 0, '47-49%': 0, '49-51%': 0, '51-53%': 0, '53-55%': 0, 'other': 0 };
  adjustments.forEach(a => {
    const pct = a.detectedPosition / 10;
    if (pct >= 45 && pct < 47) buckets['45-47%']++;
    else if (pct >= 47 && pct < 49) buckets['47-49%']++;
    else if (pct >= 49 && pct < 51) buckets['49-51%']++;
    else if (pct >= 51 && pct < 53) buckets['51-53%']++;
    else if (pct >= 53 && pct < 55) buckets['53-55%']++;
    else buckets['other']++;
  });
  Object.entries(buckets).forEach(([k, v]) => {
    if (v > 0) console.log(`  ${k}: ${v} (${(v / adjustments.length * 100).toFixed(0)}%)`);
  });

  // Biggest errors - pages to investigate
  console.log('\n--- Biggest Errors (investigate these pages) ---');
  const sorted = [...adjustments].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  sorted.slice(0, 10).forEach((a, i) => {
    console.log(`${i + 1}. Page ${a.pageId}: ${a.detectedPosition} → ${a.chosenPosition} (Δ${a.delta > 0 ? '+' : ''}${a.delta})`);
  });

  // Get page details for worst errors
  console.log('\n--- Page Details for Worst Errors ---');
  const worstPageIds = sorted.slice(0, 5).map(a => a.pageId);
  const worstPages = await db.collection('pages')
    .find({ id: { $in: worstPageIds } })
    .toArray();

  for (const pageId of worstPageIds) {
    const page = worstPages.find(p => p.id === pageId);
    const adj = sorted.find(a => a.pageId === pageId);
    if (page && adj) {
      console.log(`\nPage ${pageId}:`);
      console.log(`  Book: ${page.book_id}`);
      console.log(`  Page #: ${page.page_number}`);
      console.log(`  Error: ${adj.delta > 0 ? '+' : ''}${adj.delta} (${(adj.delta / 10).toFixed(1)}%)`);
      console.log(`  Image: ${page.photo_original || page.photo}`);
    }
  }

  await client.close();
}

main().catch(console.error);
