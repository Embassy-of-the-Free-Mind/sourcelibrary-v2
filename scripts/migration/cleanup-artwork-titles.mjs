#!/usr/bin/env node
/**
 * Clean up artwork titles:
 * 1. Strip Wikidata label cruft (e.g., "titleLabel QS:Len,..." → "title")
 * 2. Strip language prefixes (e.g., "German: Venus Venus..." → "Venus")
 * 3. For titles that are catalog IDs or gibberish, use enrichment.subject as display_title
 * 4. For titles with embedded Structured Data cruft, clean and set display_title
 *
 * Idempotent — only sets display_title, never overwrites title (preserving original).
 * Only touches artworks that have been enriched (enrichment.subject exists).
 *
 * Usage: set -a; source .env.production.local; set +a; node scripts/migration/cleanup-artwork-titles.mjs [--dry-run]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const client = new MongoClient(process.env.MONGODB_URI);

// Patterns that indicate a bad title
const WIKIDATA_CRUFT = /label\s+QS:L\w+,/i;
const STRUCTURED_DATA = /title\s+QS:P\d+/i;
const LANGUAGE_PREFIX = /^(German|Dutch|French|Italian|Spanish|Portuguese|Latin|English|Swedish|Danish|Norwegian|Polish|Czech|Hungarian|Russian|Japanese|Chinese|Arabic|Hebrew|Greek):\s*/i;
const CATALOG_ID = /^(RP-P-|RP-T-|SK-|BK-|NG-|AK-|FM-)\d/;
const JUST_NUMBERS = /^\d{1,5}(\s*[-–]\s*\d{1,5})?$/;
const FILENAME_PATTERN = /\.(jpg|jpeg|png|tif|tiff)$/i;

function cleanTitle(rawTitle) {
  if (!rawTitle) return null;
  let cleaned = rawTitle;

  // Strip "label QS:Lxx,"..." suffixes (Wikidata structured data)
  // Pattern: legitimate title followed by "label QS:Len,"English title"label QS:Lfr,..."
  cleaned = cleaned.replace(/label\s+QS:L\w+,"[^"]*"/g, '');
  cleaned = cleaned.replace(/label\s+QS:L\w+,[^,\s]*/g, '');

  // Strip "title QS:P1476,xx:"..." (Wikidata property claims)
  cleaned = cleaned.replace(/title\s+QS:P\d+,\w+:"[^"]*"/g, '');
  cleaned = cleaned.replace(/title\s+QS:P\d+,[^,\s]*/g, '');

  // Strip language prefix: "German: Title" → "Title"
  cleaned = cleaned.replace(LANGUAGE_PREFIX, '');

  // Strip Wikimedia Commons "File:" prefix
  cleaned = cleaned.replace(/^File:/i, '');

  // Strip file extensions
  cleaned = cleaned.replace(FILENAME_PATTERN, '');

  // Strip orphaned quotes and extra whitespace
  cleaned = cleaned.replace(/"\s*$/, '').replace(/^\s*"/, '');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned !== rawTitle ? cleaned : null;
}

function isBadTitle(title) {
  if (!title) return true;
  if (WIKIDATA_CRUFT.test(title)) return true;
  if (STRUCTURED_DATA.test(title)) return true;
  if (CATALOG_ID.test(title)) return true;
  if (JUST_NUMBERS.test(title)) return true;
  if (FILENAME_PATTERN.test(title)) return true;
  if (title.length < 3) return true;
  return false;
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const books = db.collection('books');

  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE RUN ===');

  let cleaned = 0, enrichmentFallback = 0, alreadyGood = 0, noEnrichment = 0;

  // Process enriched artworks via cursor
  const cursor = books.find(
    { resource_type: { $exists: true } },
    { projection: { _id: 1, title: 1, display_title: 1, author: 1, 'enrichment.subject': 1 } }
  );

  for await (const doc of cursor) {
    const title = doc.title || '';
    const currentDisplay = doc.display_title;
    const subject = doc.enrichment?.subject;

    // Skip if display_title is already manually set and looks good
    if (currentDisplay && !isBadTitle(currentDisplay) && !WIKIDATA_CRUFT.test(currentDisplay)) {
      alreadyGood++;
      continue;
    }

    // Try cleaning the original title first
    const cleanedTitle = cleanTitle(title);

    if (cleanedTitle && !isBadTitle(cleanedTitle) && cleanedTitle.length > 5) {
      // Cleaned title is usable
      if (!DRY_RUN) {
        await books.updateOne({ _id: doc._id }, { $set: { display_title: cleanedTitle } });
      }
      cleaned++;
      if (cleaned <= 20) {
        console.log(`  CLEAN: "${title.substring(0, 60)}" → "${cleanedTitle.substring(0, 60)}"`);
      }
    } else if (subject) {
      // Fall back to enrichment subject as display_title
      // Trim trailing period from subject if present
      const displayFromSubject = subject.replace(/\.\s*$/, '');
      if (!DRY_RUN) {
        await books.updateOne({ _id: doc._id }, { $set: { display_title: displayFromSubject } });
      }
      enrichmentFallback++;
      if (enrichmentFallback <= 20) {
        console.log(`  ENRICH: "${title.substring(0, 50)}" → "${displayFromSubject.substring(0, 60)}"`);
      }
    } else {
      noEnrichment++;
    }
  }

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Cleaned (strip cruft): ${cleaned}`);
  console.log(`Enrichment fallback (subject as display_title): ${enrichmentFallback}`);
  console.log(`Already good: ${alreadyGood}`);
  console.log(`No enrichment yet (skipped): ${noEnrichment}`);
  console.log(`Total processed: ${cleaned + enrichmentFallback + alreadyGood + noEnrichment}`);

  await client.close();
  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
