#!/usr/bin/env node
/**
 * Batch Import — import discovered candidates into the books collection.
 *
 * Reads from `import_candidates` (status: 'discovered'), dedup-checks
 * against existing books, fetches IIIF manifests, and imports via the
 * same path as /api/import/iiif.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/iiif-discovery/import-batch.mjs
 *
 * Options:
 *   --source=erara         Only import from a specific source
 *   --limit=500            Max candidates per run (default: 500)
 *   --delay=2000           Delay between imports in ms (default: 2000)
 *   --dry-run              Just show what would be imported
 *   --min-year=1400        Filter by earliest date
 *   --max-year=1800        Filter by latest date
 *   --min-pages=5          Skip books with fewer pages
 */

import { ObjectId } from 'mongodb';
import { withMongo } from '../lib/mongo.mjs';
import { getCandidatesForImport, updateCandidateStatus } from './lib/candidate-store.mjs';

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [key, val] = a.slice(2).split('=');
      return [key, val ?? true];
    })
);

const SOURCE = args.source || null;
const LIMIT = parseInt(args.limit) || 500;
const DELAY = parseInt(args.delay) || 2000;
const DRY_RUN = 'dry-run' in args;
const MIN_YEAR = parseInt(args['min-year']) || null;
const MAX_YEAR = parseInt(args['max-year']) || 1800;
const MIN_PAGES = parseInt(args['min-pages']) || 5;

const sleep = ms => new Promise(r => setTimeout(r, ms));

await withMongo(async (db) => {
  console.log(`\nIIIF Batch Import`);
  console.log(`  Source: ${SOURCE || 'all'}`);
  console.log(`  Limit: ${LIMIT}`);
  console.log(`  Date range: ${MIN_YEAR || 'any'} - ${MAX_YEAR || 'any'}`);
  console.log(`  Min pages: ${MIN_PAGES}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log('');

  const candidates = await getCandidatesForImport(db, {
    source: SOURCE,
    limit: LIMIT,
    minYear: MIN_YEAR,
    maxYear: MAX_YEAR,
  });

  console.log(`Found ${candidates.length} candidates to process.\n`);

  let imported = 0, skipped = 0, failed = 0;

  for (const candidate of candidates) {
    const { manifest_url, title, author, source, page_count } = candidate;

    // Skip books with too few pages
    if (page_count && page_count < MIN_PAGES) {
      await updateCandidateStatus(db, manifest_url, 'skipped', { skip_reason: `Too few pages: ${page_count}` });
      skipped++;
      continue;
    }

    // Check dedup against existing books
    const existingByManifest = await db.collection('books').findOne(
      { 'image_source.iiif_manifest': manifest_url, hidden: { $ne: true } },
      { projection: { id: 1, title: 1 } }
    );
    if (existingByManifest) {
      await updateCandidateStatus(db, manifest_url, 'skipped', {
        skip_reason: `Already imported: ${existingByManifest.id}`,
        book_id: existingByManifest.id,
      });
      skipped++;
      continue;
    }

    // Normalized title+author dedup
    const normTitle = normalizeForDedup(title);
    const normAuthor = normalizeForDedup(author);
    if (normTitle.length >= 5) {
      const titleMatch = await db.collection('books').findOne(
        { normalized_title: normTitle, normalized_author: normAuthor, hidden: { $ne: true } },
        { projection: { id: 1, title: 1 } }
      );
      if (titleMatch) {
        await updateCandidateStatus(db, manifest_url, 'skipped', {
          skip_reason: `Title/author match: "${titleMatch.title}" (${titleMatch.id})`,
          book_id: titleMatch.id,
        });
        skipped++;
        continue;
      }
    }

    if (DRY_RUN) {
      console.log(`[DRY RUN] Would import: ${title} (${author}) — ${source}`);
      imported++;
      continue;
    }

    // Mark as importing
    await updateCandidateStatus(db, manifest_url, 'importing');

    try {
      // Fetch IIIF manifest
      const manifestRes = await fetch(manifest_url, {
        headers: {
          'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org; scholarly digital library)',
          'Accept': 'application/json, application/ld+json',
        },
        signal: AbortSignal.timeout(30000),
      });

      if (!manifestRes.ok) {
        throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
      }

      const manifest = await manifestRes.json();

      // Extract canvases
      const canvases = manifest.items || manifest.sequences?.[0]?.canvases || [];
      if (canvases.length < MIN_PAGES) {
        await updateCandidateStatus(db, manifest_url, 'skipped', {
          skip_reason: `Too few canvases: ${canvases.length}`,
        });
        skipped++;
        continue;
      }

      // Import via API
      const apiUrl = process.env.NEXT_PUBLIC_URL || 'https://sourcelibrary.org';
      const importRes = await fetch(`${apiUrl}/api/import/iiif`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.ADMIN_API_KEY || process.env.NEXTAUTH_SECRET}`,
        },
        body: JSON.stringify({
          manifest_url,
          manifest_data: manifest, // pass pre-fetched manifest
          title: candidate.title,
          display_title: candidate.display_title,
          author: candidate.author,
          language: candidate.language,
          published: candidate.date_text || 'Unknown',
          categories: candidate.categories,
          provider: candidate.provider_name,
        }),
        signal: AbortSignal.timeout(60000),
      });

      const result = await importRes.json();

      if (importRes.ok && result.success) {
        await updateCandidateStatus(db, manifest_url, 'imported', {
          book_id: result.bookId,
        });
        imported++;
        console.log(`[${imported}/${candidates.length}] ✓ ${title} — ${result.pagesCreated} pages`);
      } else if (importRes.status === 409) {
        await updateCandidateStatus(db, manifest_url, 'skipped', {
          skip_reason: result.error,
          book_id: result.existingId,
        });
        skipped++;
      } else {
        throw new Error(result.error || `Import failed: ${importRes.status}`);
      }

    } catch (err) {
      await updateCandidateStatus(db, manifest_url, 'failed', {
        skip_reason: err.message,
      });
      failed++;
      console.error(`[FAIL] ${title}: ${err.message}`);
    }

    // Rate limit
    if (!DRY_RUN) await sleep(DELAY);
  }

  console.log(`\n=== Import Complete ===`);
  console.log(`Imported: ${imported} | Skipped: ${skipped} | Failed: ${failed}`);

}, { noTimeout: true });

// Simplified dedup normalization (matches dedup.ts logic)
function normalizeForDedup(str) {
  return (str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|la|gli|i|el|los|las)\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
