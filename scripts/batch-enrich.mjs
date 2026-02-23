#!/usr/bin/env node
/**
 * Batch enrichment script — generates summaries + indexes for books
 * that already have sufficient OCR/translation but are missing enrichment.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/batch-enrich.mjs [--limit=50] [--dry-run]
 *
 * Targets books with >50% translation that lack reading_summary.
 * Calls GET /api/books/{id}/index on production for each book.
 */

const BASE_URL = 'https://sourcelibrary.org';
const DEFAULT_LIMIT = 50;

// Parse args
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1]) : DEFAULT_LIMIT;

async function enrichBook(book, idx, total, db) {
  process.stdout.write(`  [${idx}/${total}] ${book.title?.substring(0, 55)} (${book.pages_count}pg)...`);
  const start = Date.now();

  const res = await fetch(`${BASE_URL}/api/books/${book.id}/index`, {
    method: 'GET',
    signal: AbortSignal.timeout(300000),
  });

  // Consume and discard body to free connection
  await res.text();

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  if (!res.ok) {
    console.log(` FAIL (HTTP ${res.status}) ${elapsed}s`);
    return false;
  }

  console.log(` OK ${elapsed}s`);

  // Advance pipeline — these books already have translations, skip ahead to enriched
  const advanceable = ['translate_complete', 'metadata_enriched'];
  if (advanceable.includes(book.pipeline_auto?.status)) {
    await db.collection('books').updateOne(
      { id: book.id },
      { $set: { 'pipeline_auto.status': 'enriched', 'pipeline_auto.last_updated': new Date() } }
    );
  }

  return true;
}

async function main() {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const candidates = await db.collection('books').aggregate([
    {
      $match: {
        reading_summary: { $exists: false },
        pages_ocr: { $gte: 10 },
        hidden: { $ne: true },
        $expr: { $gt: [{ $divide: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] }, 0.5] }
      }
    },
    {
      $addFields: {
        translation_pct: { $divide: [{ $ifNull: ['$pages_translated', 0] }, '$pages_count'] }
      }
    },
    { $sort: { pages_count: 1 } },
    { $limit: limit },
    { $project: { _id: 0, id: 1, title: 1, pages_count: 1, pages_ocr: 1, pages_translated: 1, translation_pct: 1, 'pipeline_auto.status': 1 } }
  ]).toArray();

  console.log(`Found ${candidates.length} books needing enrichment (limit: ${limit})`);
  if (dryRun) {
    candidates.forEach((b, i) => {
      const pct = Math.round(b.translation_pct * 100);
      const pipe = b.pipeline_auto?.status || 'none';
      console.log(`  ${i + 1}. ${b.title?.substring(0, 60)} | tr:${pct}% (${b.pages_translated}/${b.pages_count}) | pipe:${pipe}`);
    });
    console.log('\nDry run — no changes made.');
    await client.close();
    return;
  }

  let success = 0, failed = 0;
  const errors = [];

  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];
    try {
      const ok = await enrichBook(book, i + 1, candidates.length, db);
      if (ok) success++;
      else {
        failed++;
        errors.push({ title: book.title, error: 'HTTP error' });
      }
    } catch (err) {
      failed++;
      const msg = err.message || 'unknown';
      console.log(` ERROR: ${msg.substring(0, 100)}`);
      errors.push({ title: book.title, error: msg });
    }

    // Brief pause between books
    if (i < candidates.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  console.log(`\nDone: ${success} enriched, ${failed} failed out of ${candidates.length}`);
  if (errors.length) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  ${e.title?.substring(0, 50)}: ${e.error.substring(0, 100)}`));
  }

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
