#!/usr/bin/env node
/**
 * Backfill USTC matches for Source Library books using the AI matcher.
 *
 * Two-tier approach:
 *   1. Fast word-overlap (free) — handles ~60% of books
 *   2. Gemini tool-calling (flash-lite, ~$0.001/book) — handles cross-language and variant names
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/catalog-coverage/backfill-ustc-matches.mjs
 *
 *   Options:
 *     --limit N        Process at most N books (default: all)
 *     --force          Re-match books that already have ustc_id
 *     --dry-run        Don't write to DB, just log matches
 *     --provider NAME  Only match books from this image_source.provider (e.g., "bph", "efm")
 *     --skip-fast      Skip word-overlap, go straight to AI for all books
 *
 * GitHub issue: #343
 */

import { MongoClient } from 'mongodb';

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) { console.error('MONGODB_URI not set'); process.exit(1); }
if (!process.env.GEMINI_API_KEY) { console.error('GEMINI_API_KEY not set'); process.exit(1); }

// Parse args
const args = process.argv.slice(2);
const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : Infinity;
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const skipFast = args.includes('--skip-fast');
const providerIdx = args.indexOf('--provider');
const provider = providerIdx >= 0 ? args[providerIdx + 1] : null;

// Dynamic import of the TS module via tsx
const { matchToUstc } = await import('../../src/lib/ustc-matcher.ts');

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Build query for unmatched books
  const query = {};
  if (!force) {
    query.ustc_id = { $exists: false };
  }
  if (provider) {
    query['image_source.provider'] = provider;
  }
  // Only books in USTC date range
  query.$or = [
    { year: { $gte: 1450, $lte: 1700 } },
    { published: { $gte: 1450, $lte: 1700 } },
  ];

  const total = await db.collection('books').countDocuments(query);
  const toProcess = Math.min(total, limit);
  console.log(`Found ${total} books to match${provider ? ` (provider: ${provider})` : ''}`);
  if (limit < total) console.log(`Processing first ${limit}`);
  if (dryRun) console.log('DRY RUN — no writes');

  const cursor = db.collection('books')
    .find(query, { projection: { id: 1, title: 1, display_title: 1, author: 1, year: 1, published: 1, language: 1, original_language: 1 } })
    .limit(toProcess);

  let processed = 0, matched = 0, fastMatched = 0, aiMatched = 0, noMatch = 0, errors = 0;
  let totalCost = 0;

  for await (const book of cursor) {
    processed++;
    const title = book.display_title || book.title;
    const year = book.year || book.published;
    const lang = book.language || book.original_language;

    try {
      const result = await matchToUstc(db, {
        title,
        author: book.author,
        year,
        language: lang,
        id: book.id,
      }, { force, skipFastPath: skipFast });

      if (result.success && result.match) {
        matched++;
        totalCost += result.match.cost_usd;
        if (result.match.match_method === 'word_overlap') fastMatched++;
        else aiMatched++;

        if (!dryRun) {
          await db.collection('books').updateOne(
            { id: book.id },
            { $set: {
              ustc_id: result.match.ustc_sn,
              ustc_match: result.match,
              'field_provenance.ustc_id': {
                source: 'ai-matcher',
                method: result.match.match_method,
                confidence: result.match.confidence,
                date: new Date(),
              },
              'field_provenance.ustc_match': {
                source: 'ai-matcher',
                method: result.match.match_method,
                confidence: result.match.confidence,
                date: new Date(),
              },
            } },
          );
        }

        console.log(`  ✓ [${processed}/${toProcess}] "${title}" → USTC ${result.match.ustc_sn} (${result.match.confidence}, ${result.match.match_method})`);
      } else if (result.skipped) {
        noMatch++;
        console.log(`  - [${processed}/${toProcess}] "${title}" — ${result.skipped}`);
      } else {
        errors++;
        console.log(`  ✗ [${processed}/${toProcess}] "${title}" — ${result.error}`);
      }
    } catch (err) {
      errors++;
      console.error(`  ✗ [${processed}/${toProcess}] "${title}" — ${err.message}`);
    }

    // Rate limit for Gemini calls
    if (processed % 10 === 0) {
      process.stdout.write(`\n--- ${processed}/${toProcess} | matched: ${matched} (fast: ${fastMatched}, AI: ${aiMatched}) | no match: ${noMatch} | errors: ${errors} | cost: $${totalCost.toFixed(4)} ---\n\n`);
    }

    // Small delay between AI calls to avoid rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  console.log('\n=== FINAL ===');
  console.log(`Processed: ${processed}`);
  console.log(`Matched: ${matched} (fast: ${fastMatched}, AI: ${aiMatched})`);
  console.log(`No match: ${noMatch}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
