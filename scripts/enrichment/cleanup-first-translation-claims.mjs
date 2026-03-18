#!/usr/bin/env node
/**
 * Verify first-translation status for non-English books using the
 * catalog-backed verification pipeline (Gemini function calling).
 *
 * Modes:
 *   --apply           Persist results to MongoDB (default is dry-run)
 *   --all             Verify ALL non-English books without new-style verification
 *   --force           Re-verify even if tools_called already exists
 *   --book-id=ID      Verify a single book
 *   (no flags)        Re-verify books currently marked is_first_translation=true
 *                     that lack new-style verification
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/enrichment/cleanup-first-translation-claims.mjs --apply --all
 *   npx tsx scripts/enrichment/cleanup-first-translation-claims.mjs --book-id=SOME_ID
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  for (const file of ['.env.production.local', '.env.local']) {
    try {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const m = line.match(/^([^=#]+)=(.*)$/);
        if (m) {
          let v = m[2].trim();
          if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
            v = v.slice(1, -1);
          env[m[1].trim()] = v;
        }
      }
      break;
    } catch {}
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
const DRY_RUN = !process.argv.includes('--apply');
const ALL_MODE = process.argv.includes('--all');
const VISIBLE_MODE = process.argv.includes('--visible');
const FORCE = process.argv.includes('--force');
const SINGLE_BOOK = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];

// ── Dynamic import of verification function ─────────────────────────
// We can't import the TS module directly from an .mjs script, so we
// replicate the core logic: call the verification via the API or
// use the same Gemini function-calling approach inline.
// For simplicity, this script calls verifyFirstTranslation via a
// dynamic import of the compiled Next.js module.

async function main() {
  if (!MONGODB_URI) {
    console.error('MONGODB_URI not found. Source .env.production.local first.');
    process.exit(1);
  }

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  const startMs = Date.now();
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (use --apply to make changes)' : 'APPLY'}`);

  // Find candidates
  let query;
  if (SINGLE_BOOK) {
    query = { id: SINGLE_BOOK };
  } else if (ALL_MODE && FORCE) {
    // All non-English books — re-verify everything
    query = {
      language: { $nin: ['English', 'english', null, ''] },
    };
  } else if (VISIBLE_MODE) {
    // Visible translated non-English books without Stage 2 verification
    query = {
      hidden: { $ne: true },
      pages_count: { $gt: 0 },
      pages_translated: { $gt: 0 },
      language: { $nin: ['English', 'english', null, ''] },
      'translation_verification.tools_called': { $exists: false },
    };
  } else if (ALL_MODE) {
    // All non-English books that don't yet have new-style verification
    query = {
      language: { $nin: ['English', 'english', null, ''] },
      'translation_verification.tools_called': { $exists: false },
    };
  } else {
    // Default: only re-verify books already marked as first translations
    query = {
      $or: [
        { is_first_translation: true, 'translation_verification.verified_at': { $exists: false } },
        { is_first_translation: true, 'translation_verification.tools_called': { $exists: false } },
        { is_first_translation: true, 'translation_verification.confidence': 'low' },
      ],
      language: { $nin: ['English', 'english'] },
    };
  }

  const candidates = await db.collection('books')
    .find(query)
    .project({
      id: 1, title: 1, display_title: 1, author: 1, language: 1, published: 1,
      is_first_translation: 1, translation_verification: 1,
    })
    .sort({ title: 1 })
    .toArray();

  console.log(`\nFound ${candidates.length} books to re-verify\n`);

  if (candidates.length === 0) {
    console.log('Nothing to do.');
    await client.close();
    return;
  }

  // Show what we found
  const stats = { first: 0, first_complete: 0, first_modern: 0, exists: 0, needs_review: 0, errors: 0 };
  const mismatches = [];
  const newFirstTranslations = [];

  // Import verification function dynamically
  let verifyFirstTranslation;
  try {
    // Try importing from compiled output
    const mod = await import('../../src/lib/verify-first-translation.ts');
    verifyFirstTranslation = mod.verifyFirstTranslation;
  } catch {
    console.error('Cannot import verify-first-translation.ts directly.');
    console.error('Run with: npx tsx scripts/enrichment/cleanup-first-translation-claims.mjs');
    await client.close();
    process.exit(1);
  }

  const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '3');
  console.log(`Concurrency: ${CONCURRENCY}`);

  async function processBook(book, idx) {
    const label = `[${idx + 1}/${candidates.length}]`;
    const title = book.display_title || book.title;

    try {
      const result = await verifyFirstTranslation(db, book.id, { dryRun: DRY_RUN, force: FORCE });
      if (result.success && result.verification) {
        const v = result.verification;
        const dispKey = v.disposition === 'translation_found' || v.disposition === 'translation_exists' ? 'exists' :
              v.disposition === 'first_complete_translation' ? 'first_complete' :
              v.disposition === 'first_modern_translation' ? 'first_modern' :
              v.disposition === 'needs_review' ? 'needs_review' : 'first';
        stats[dispKey]++;

        const wasFirst = book.is_first_translation;
        const isNowFirst = ['confirmed_first', 'first_complete_translation', 'first_modern_translation'].includes(v.disposition);
        const wouldChange = wasFirst && v.disposition === 'translation_found';
        const newDiscovery = !wasFirst && isNowFirst;
        const marker = wouldChange ? ' ** MISMATCH **' : newDiscovery ? ' ** NEW **' : '';
        console.log(`${label} ${title} → ${v.disposition} (${v.confidence || 'n/a'})${marker}`);

        if (wouldChange) {
          mismatches.push({
            id: book.id, title, author: book.author,
            disposition: v.disposition, confidence: v.confidence,
            reasoning: v.reasoning, translations_found: v.translations_found,
          });
        }
        if (newDiscovery && !DRY_RUN) {
          newFirstTranslations.push({ id: book.id, title, author: book.author });
        }
      } else {
        stats.errors++;
        console.log(`${label} ${title} → ERROR: ${result.error}`);
      }
    } catch (err) {
      stats.errors++;
      console.log(`${label} ${title} → ERROR: ${err.message}`);
    }
  }

  // Process in parallel batches
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const batch = candidates.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((book, j) => processBook(book, i + j)));

    // Progress summary every 100 books
    const done = Math.min(i + CONCURRENCY, candidates.length);
    if (done % 100 < CONCURRENCY) {
      const elapsed = (Date.now() - startMs) / 1000;
      const rate = done / elapsed;
      const eta = Math.round((candidates.length - done) / rate / 60);
      console.log(`\n── Progress: ${done}/${candidates.length} (${(done/candidates.length*100).toFixed(1)}%) | ${rate.toFixed(1)}/sec | ETA: ${eta}min ──\n`);
    }
  }

  console.log('\n── Summary ──');
  console.log(`  Confirmed first translation: ${stats.first}`);
  console.log(`  First COMPLETE translation (partial existed): ${stats.first_complete}`);
  console.log(`  First MODERN translation (old trans existed): ${stats.first_modern}`);
  console.log(`  Translation exists: ${stats.exists}`);
  console.log(`  Needs manual review: ${stats.needs_review}`);
  console.log(`  Errors: ${stats.errors}`);

  if (newFirstTranslations.length > 0) {
    console.log(`\n── ${newFirstTranslations.length} Newly Discovered First Translations ──\n`);
    for (const b of newFirstTranslations) {
      console.log(`  ${b.title} (${b.author}) — ${b.id}`);
    }
  }

  if (DRY_RUN && mismatches.length > 0) {
    console.log(`\n── ${mismatches.length} Mismatches (would change is_first_translation to false) ──\n`);
    for (const m of mismatches) {
      console.log(`  ${m.title} (${m.author})`);
      console.log(`    ID: ${m.id}`);
      console.log(`    Disposition: ${m.disposition} (${m.confidence || 'n/a'})`);
      console.log(`    Reasoning: ${m.reasoning}`);
      if (m.translations_found?.length > 0) {
        console.log(`    Known translations:`);
        for (const t of m.translations_found.slice(0, 3)) {
          console.log(`      - ${t.title} (${t.translator}, ${t.year}) [${t.source}]`);
        }
      }
      console.log();
    }
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
