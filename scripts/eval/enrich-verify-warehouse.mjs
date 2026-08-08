#!/usr/bin/env npx tsx
/**
 * Enrich and verify warehouse books in one pass.
 *
 * Step 1: Run metadata enrichment on warehouse books missing ai_metadata
 * Step 2: Run first-translation verification on warehouse books missing verification
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/enrich-verify-warehouse.mjs [--limit=500] [--concurrency=3] [--dry-run]
 *   npx tsx scripts/eval/enrich-verify-warehouse.mjs --verify-only    # Skip enrichment
 *   npx tsx scripts/eval/enrich-verify-warehouse.mjs --enrich-only    # Skip verification
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parse args
const args = process.argv.slice(2);
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '500');
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3');
const DRY_RUN = args.includes('--dry-run');
const VERIFY_ONLY = args.includes('--verify-only');
const ENRICH_ONLY = args.includes('--enrich-only');

// Western languages worth verifying for first-translation
const WESTERN_LANGS = ['Latin', 'German', 'French', 'Greek', 'Hebrew', 'Italian', 'Dutch', 'Spanish', 'Portuguese', 'Arabic', 'Syriac', 'Armenian'];

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

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  console.log('\nWarehouse Pipeline: Enrich + Verify');
  console.log('===================================');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Limit: ${LIMIT} | Concurrency: ${CONCURRENCY}\n`);

  // ── Step 1: Enrichment ───────────────────────────────────────────

  if (!VERIFY_ONLY) {
    const needsEnrichment = await db.collection('books_warehouse').countDocuments({
      pages_ocr: { $gt: 0 },
      'ai_metadata.enriched_at': { $exists: false },
      language: { $ne: 'English' },
    });

    console.log(`Step 1: Enrichment — ${needsEnrichment} warehouse books need metadata enrichment`);

    if (needsEnrichment > 0) {
      const enrichLimit = Math.min(LIMIT, needsEnrichment);
      console.log(`Running enrichment on ${enrichLimit} books...\n`);

      // Shell out to the enrichment script with --warehouse flag
      const { execSync } = await import('child_process');
      const cmd = `npx tsx scripts/enrichment/enrich-metadata-text.mjs --warehouse --ocr-only ${DRY_RUN ? '' : '--apply'} --limit ${enrichLimit}`;
      try {
        execSync(cmd, { stdio: 'inherit', timeout: 600000 });
      } catch (err) {
        console.error('Enrichment failed:', err.message);
      }

      console.log('\n');
    } else {
      console.log('  All warehouse books with OCR are already enriched.\n');
    }
  }

  // ── Step 2: First-translation verification ───────────────────────

  if (!ENRICH_ONLY) {
    // Import verification function
    let verifyFirstTranslation;
    try {
      const mod = await import('../../src/lib/verify-first-translation.ts');
      verifyFirstTranslation = mod.verifyFirstTranslation;
    } catch (err) {
      console.error('Cannot import verify-first-translation. Run with npx tsx.');
      await client.close();
      process.exit(1);
    }

    // Find warehouse books that are enriched but not verified
    const needsVerification = await db.collection('books_warehouse').find({
      pages_ocr: { $gt: 0 },
      language: { $in: WESTERN_LANGS },
      'translation_verification.tools_called': { $exists: false },
    }).project({
      id: 1, author: 1, display_title: 1, title: 1, language: 1,
    }).limit(LIMIT).toArray();

    console.log(`Step 2: FT Verification — ${needsVerification.length} warehouse books need verification`);

    if (needsVerification.length === 0) {
      console.log('  All eligible warehouse books are already verified.\n');
      await client.close();
      return;
    }

    let completed = 0;
    let changed = 0;
    let firsts = 0;
    let errors = 0;
    let totalCost = 0;
    const startTime = Date.now();

    for (let i = 0; i < needsVerification.length; i += CONCURRENCY) {
      const batch = needsVerification.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (book) => {
        try {
          const result = await verifyFirstTranslation(db, book.id, {
            dryRun: DRY_RUN,
            force: false,
            collection: 'books_warehouse',
            writeBadge: true, // warehouse only — not the public badge (#3726)
          });
          if (!result.success) {
            errors++;
            return null;
          }
          totalCost += result.verification?.cost_usd || 0;
          if (result.is_first_translation) firsts++;
          return result;
        } catch {
          errors++;
          return null;
        }
      }));

      completed += results.length;
      const successCount = results.filter(r => r !== null).length;

      // Progress dots
      for (const r of results) {
        process.stdout.write(r === null ? 'E' : r.is_first_translation ? '*' : '.');
      }

      if (completed % 50 === 0 || completed === needsVerification.length) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const eta = completed > 0 ? Math.round((needsVerification.length - completed) / (completed / (Date.now() - startTime) * 1000) / 60) : '?';
        console.log(`\n  [${completed}/${needsVerification.length}] ${firsts} firsts, ${errors} errors, ~${eta}min left, $${totalCost.toFixed(2)}`);
      }
    }

    console.log('\n');
    console.log('Verification complete');
    console.log(`  Processed: ${completed}`);
    console.log(`  First translations found: ${firsts}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Cost: $${totalCost.toFixed(2)}`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
