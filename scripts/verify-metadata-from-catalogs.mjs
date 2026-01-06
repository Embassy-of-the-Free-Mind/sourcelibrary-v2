#!/usr/bin/env node
/**
 * Verify and fix book metadata using EFM/USTC catalogs
 *
 * This script:
 * 1. Finds books with Unknown year/language
 * 2. Searches EFM and USTC catalogs for matches
 * 3. Reports matches for manual review
 * 4. Optionally applies high-confidence matches
 *
 * Usage:
 *   node scripts/verify-metadata-from-catalogs.mjs --dry-run        # Report only
 *   node scripts/verify-metadata-from-catalogs.mjs --apply          # Apply high-confidence matches
 *   node scripts/verify-metadata-from-catalogs.mjs --book "title"   # Check specific book
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

// Load env
function loadEnv() {
  const env = {};
  try {
    const envContent = fs.readFileSync('.env.local', 'utf8');
    for (const line of envContent.split('\n')) {
      const match = line.match(/^([^=]+)=(.*)$/);
      if (match) {
        // Remove surrounding quotes if present
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[match[1].trim()] = value;
      }
    }
  } catch (e) {
    console.log('No .env.local found');
  }
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB;

if (!MONGODB_URI) {
  console.error('MONGODB_URI not set');
  process.exit(1);
}

// Normalize text for matching
function normalize(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Calculate word similarity with fuzzy matching for Latin names
function similarity(a, b) {
  const normA = normalize(a);
  const normB = normalize(b);
  if (!normA || !normB) return 0;

  const wordsA = normA.split(' ').filter(w => w.length > 2);
  const wordsB = normB.split(' ').filter(w => w.length > 2);

  if (wordsA.length === 0 || wordsB.length === 0) return 0;

  // Count matches with fuzzy prefix matching (handles Latin endings)
  let matches = 0;
  const matchedB = new Set();

  for (const wordA of wordsA) {
    for (const wordB of wordsB) {
      if (matchedB.has(wordB)) continue;

      // Exact match
      if (wordA === wordB) {
        matches++;
        matchedB.add(wordB);
        break;
      }
      // Prefix match (handles "agrippa" vs "agrippae", "cornelius" vs "cornelii")
      const minLen = Math.min(wordA.length, wordB.length);
      const prefixLen = Math.min(5, minLen - 1); // Compare first 5 chars or less
      if (prefixLen >= 4 && wordA.substring(0, prefixLen) === wordB.substring(0, prefixLen)) {
        matches += 0.8; // Partial credit for prefix match
        matchedB.add(wordB);
        break;
      }
    }
  }

  const maxWords = Math.max(wordsA.length, wordsB.length);
  return Math.round((matches / maxWords) * 100);
}

// Extract year from text
function extractYear(text) {
  if (!text) return null;
  const match = text.match(/\b(1[4-9]\d{2}|20[0-2]\d)\b/);
  return match ? match[1] : null;
}

// Escape special regex characters
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function findMatches(db, book) {
  const matches = [];

  // Extract author surname (most distinctive identifier)
  const authorWords = (book.author || '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  // Try last word first (surname), then first word
  const authorTerms = [];
  if (authorWords.length > 0) {
    authorTerms.push(authorWords[authorWords.length - 1]); // surname
    if (authorWords.length > 1) authorTerms.push(authorWords[0]); // first name
  }

  // Extract title keywords
  const titleWords = (book.title || '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  let catalogDocs = [];

  // Strategy: Search by author in the author field
  for (const term of authorTerms) {
    if (catalogDocs.length > 0) break;

    catalogDocs = await db.collection('external_catalog')
      .find({ author: { $regex: escapeRegex(term), $options: 'i' } })
      .limit(100)
      .toArray();
  }

  // Fallback: Search by distinctive title words if no author match
  if (catalogDocs.length === 0 && titleWords.length >= 2) {
    const query = {
      $and: titleWords.slice(0, 2).map(w => ({
        title: { $regex: escapeRegex(w), $options: 'i' }
      }))
    };
    catalogDocs = await db.collection('external_catalog')
      .find(query)
      .limit(50)
      .toArray();
  }

  // Debug: show what we found
  if (process.env.DEBUG) {
    console.log(`   DEBUG: Author terms: ${authorTerms.join(', ')}, Title words: ${titleWords.slice(0,3).join(', ')}`);
    console.log(`   DEBUG: Found ${catalogDocs.length} catalog docs`);
  }

  for (const doc of catalogDocs) {
    // Combine title+author for comparison (handles EFM's short titles)
    const bookCombined = `${book.title} ${book.author}`.toLowerCase();
    const docCombined = `${doc.title} ${doc.author}`.toLowerCase();

    // Cross-compare: book title vs doc title+author and vice versa
    const titleSim = similarity(book.title, doc.title);
    const authorSim = similarity(book.author, doc.author);
    const crossSim1 = similarity(book.title, docCombined); // Our title vs their combined
    const crossSim2 = similarity(bookCombined, doc.title); // Our combined vs their title
    const combinedSim = similarity(bookCombined, docCombined); // Full comparison

    // Check for distinctive title words match (e.g., "Opera", "Duos", "Tomos")
    const bookTitleWords = new Set(normalize(book.title).split(' ').filter(w => w.length > 3));
    const docTitleWords = new Set(normalize(doc.title).split(' ').filter(w => w.length > 3));
    const titleWordMatches = [...bookTitleWords].filter(w => docTitleWords.has(w)).length;
    const titleWordBonus = titleWordMatches >= 3 ? 15 : titleWordMatches >= 2 ? 8 : 0;

    // Take the best matching approach
    const bestSim = Math.max(
      (titleSim * 0.7) + (authorSim * 0.3) + titleWordBonus,  // Traditional + bonus
      crossSim1 * 0.9,                        // Cross-match
      crossSim2 * 0.9,
      combinedSim + titleWordBonus            // Full combined + bonus
    );
    const confidence = Math.round(bestSim);

    if (confidence > 40) {
      matches.push({
        source: doc.source === 'bph' ? 'EFM' : 'IA',
        confidence,
        identifier: doc.identifier,
        title: doc.title,
        author: doc.author,
        year: doc.year?.toString(),
        language: doc.language,
        place: doc.placeOfPublication,
        publisher: doc.publisher,
      });
    }
  }

  // Sort by confidence
  matches.sort((a, b) => b.confidence - a.confidence);
  return matches.slice(0, 5);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run') || !args.includes('--apply');
  const specificBook = args.includes('--book') ? args[args.indexOf('--book') + 1] : null;
  const minConfidence = 70; // Only apply matches above this

  console.log(`Mode: ${dryRun ? 'DRY RUN (report only)' : 'APPLY CHANGES'}`);
  console.log(`Minimum confidence for auto-apply: ${minConfidence}%`);
  console.log('');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find books needing verification
  const filter = {
    $or: [
      { published: 'Unknown' },
      { published: { $exists: false } },
      { language: 'Unknown' },
    ]
  };

  if (specificBook) {
    filter.title = { $regex: specificBook, $options: 'i' };
  }

  const books = await db.collection('books')
    .find(filter)
    .sort({ title: 1 })
    .toArray();

  console.log(`Found ${books.length} books to verify\n`);

  const report = {
    verified: [],
    needsReview: [],
    noMatches: [],
    applied: [],
  };

  for (const book of books) {
    const matches = await findMatches(db, book);
    const bestMatch = matches[0];

    console.log(`📖 ${book.title}`);
    console.log(`   Author: ${book.author}`);
    console.log(`   Current: year=${book.published || 'Unknown'}, lang=${book.language || 'Unknown'}`);

    if (!bestMatch) {
      console.log(`   ❌ No catalog matches found\n`);
      report.noMatches.push({ id: book.id, title: book.title, author: book.author });
      continue;
    }

    console.log(`   Best match (${bestMatch.confidence}%): ${bestMatch.source}`);
    console.log(`     Title: ${bestMatch.title}`);
    console.log(`     Author: ${bestMatch.author || 'N/A'}`);
    console.log(`     Year: ${bestMatch.year || 'N/A'}`);
    console.log(`     Language: ${bestMatch.language || 'N/A'}`);

    // Determine what to update
    const updates = {};
    const changes = [];

    if ((book.published === 'Unknown' || !book.published) && bestMatch.year) {
      const year = extractYear(bestMatch.year) || bestMatch.year;
      if (year && year !== 'Unknown') {
        updates.published = year;
        changes.push(`year: Unknown → ${year}`);
      }
    }

    if ((book.language === 'Unknown' || !book.language) &&
        bestMatch.language && bestMatch.language !== 'Unknown') {
      updates.language = bestMatch.language;
      changes.push(`language: Unknown → ${bestMatch.language}`);
    }

    if (changes.length === 0) {
      console.log(`   ✓ Already has required metadata\n`);
      continue;
    }

    if (bestMatch.confidence >= minConfidence) {
      console.log(`   ✅ High confidence - changes: ${changes.join(', ')}`);

      if (!dryRun) {
        updates.updated_at = new Date();
        updates.metadata_verified = {
          date: new Date(),
          source: bestMatch.source,
          confidence: bestMatch.confidence,
          catalog_id: bestMatch.identifier,
          changes,
        };

        await db.collection('books').updateOne(
          { id: book.id },
          { $set: updates }
        );
        console.log(`   📝 Applied changes`);
        report.applied.push({
          id: book.id,
          title: book.title,
          source: bestMatch.source,
          confidence: bestMatch.confidence,
          changes,
        });
      } else {
        report.verified.push({
          id: book.id,
          title: book.title,
          source: bestMatch.source,
          confidence: bestMatch.confidence,
          changes,
        });
      }
    } else {
      console.log(`   ⚠️  Low confidence (${bestMatch.confidence}%) - needs review`);
      report.needsReview.push({
        id: book.id,
        title: book.title,
        author: book.author,
        currentYear: book.published,
        currentLanguage: book.language,
        match: {
          source: bestMatch.source,
          confidence: bestMatch.confidence,
          title: bestMatch.title,
          year: bestMatch.year,
          language: bestMatch.language,
        },
        suggestedChanges: changes,
      });
    }
    console.log('');
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Total books checked: ${books.length}`);
  console.log(`High confidence matches: ${dryRun ? report.verified.length : report.applied.length}`);
  console.log(`Needs manual review: ${report.needsReview.length}`);
  console.log(`No matches found: ${report.noMatches.length}`);

  if (dryRun && report.verified.length > 0) {
    console.log('\nWould apply these changes:');
    for (const r of report.verified) {
      console.log(`  - ${r.title}: ${r.changes.join(', ')} [${r.source} ${r.confidence}%]`);
    }
    console.log('\nRun with --apply to make changes');
  }

  if (report.needsReview.length > 0) {
    console.log('\nBooks needing manual review:');
    for (const r of report.needsReview) {
      console.log(`  - ${r.title}`);
      console.log(`    Current: year=${r.currentYear}, lang=${r.currentLanguage}`);
      console.log(`    Suggested: year=${r.match.year}, lang=${r.match.language} [${r.match.source} ${r.match.confidence}%]`);
    }
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
