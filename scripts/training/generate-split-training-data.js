#!/usr/bin/env node

/**
 * Generate training data for split ML model using Gemini as ground truth
 *
 * Usage:
 *   node scripts/generate-split-training-data.js <bookId> [limit]
 *
 * Example:
 *   node scripts/generate-split-training-data.js 6909cfe3cf28baa1b4caff19 50
 *
 * This script calls the /api/split-ml/label endpoint to:
 * 1. Fetch pages from the specified book
 * 2. Use Gemini to analyze each image and determine optimal split position
 * 3. Extract features from the image
 * 4. Store as training examples in MongoDB
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

async function main() {
  const bookId = process.argv[2];
  const limit = parseInt(process.argv[3]) || 50;

  if (!bookId) {
    console.error('Usage: node scripts/generate-split-training-data.js <bookId> [limit]');
    process.exit(1);
  }

  console.log(`Generating training data for book ${bookId} (limit: ${limit})`);

  // First, check current status
  const statusRes = await fetch(`${BASE_URL}/api/split-ml/label?bookId=${bookId}`);
  const status = await statusRes.json();

  console.log(`Current status: ${status.labeledPages}/${status.totalPages} pages labeled (${status.progress}%)`);

  if (status.labeledPages >= status.totalPages) {
    console.log('All pages already labeled!');
    return;
  }

  // Generate labels
  console.log(`\nLabeling up to ${limit} unlabeled pages...`);

  const labelRes = await fetch(`${BASE_URL}/api/split-ml/label`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookId, limit }),
  });

  if (!labelRes.ok) {
    const error = await labelRes.json();
    console.error('Error:', error);
    process.exit(1);
  }

  const result = await labelRes.json();

  console.log(`\nLabeled ${result.labeled} pages`);
  if (result.errorCount > 0) {
    console.log(`Errors: ${result.errorCount}`);
    result.errors?.forEach(e => console.log(`  - ${e.pageId}: ${e.error}`));
  }

  console.log('\nResults:');
  result.results?.forEach(r => {
    console.log(`  ${r.pageId}: position=${r.position} (${r.confidence}) - ${r.reasoning?.slice(0, 50)}...`);
  });

  // Check training data status
  const trainRes = await fetch(`${BASE_URL}/api/split-ml/train`);
  const trainStatus = await trainRes.json();

  console.log(`\nTotal training examples: ${trainStatus.trainingData.totalExamples}`);
  console.log('By confidence:', trainStatus.trainingData.byConfidence);

  if (trainStatus.trainingData.totalExamples >= 10) {
    console.log('\nYou have enough data to train! Run:');
    console.log('  curl -X POST http://localhost:3000/api/split-ml/train');
  }
}

main().catch(console.error);
