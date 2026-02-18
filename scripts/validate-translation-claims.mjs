#!/usr/bin/env node
/**
 * Validate AI-claimed translations against real library catalogs.
 *
 * For each book where the verification script found translations,
 * checks Open Library and Google Books to confirm they actually exist.
 *
 * Translations that can be confirmed get added to the census.
 * Unconfirmed ones are flagged for manual review.
 *
 * Usage:
 *   node scripts/validate-translation-claims.mjs --dry-run
 *   node scripts/validate-translation-claims.mjs --apply
 *   node scripts/validate-translation-claims.mjs --apply --limit 50
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';

const DELAY_MS = 1200; // Rate limit: ~50 req/min for Open Library
const CENSUS_CSV = '/Users/dereklomas/secondrenaissance/scripts/latin_translations_master.csv';
const VALIDATED_CSV = '/Users/dereklomas/secondrenaissance/scripts/latin_translations_validated_additions.csv';

// ── Env ─────────────────────────────────────────────────────────────
function loadEnv() {
  const env = {};
  try {
    const content = fs.readFileSync('.env.local', 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^([^=#]+)=(.*)$/);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
          v = v.slice(1, -1);
        env[m[1].trim()] = v;
      }
    }
  } catch {}
  return { ...process.env, ...env };
}

const env = loadEnv();
const MONGODB_URI = env.MONGODB_URI;
const MONGODB_DB = env.MONGODB_DB || 'bookstore';
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

// ── Catalog search helpers ──────────────────────────────────────────

function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

/**
 * Search Open Library for a book.
 * Returns array of matching editions with key, title, author, year, publisher.
 */
async function searchOpenLibrary(title, author) {
  const params = new URLSearchParams();
  if (title) params.set('title', title);
  if (author) params.set('author', author);
  params.set('language', 'eng');
  params.set('limit', '5');

  const url = `https://openlibrary.org/search.json?${params}`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.docs || []).slice(0, 5).map(doc => ({
      source: 'open_library',
      title: doc.title,
      author: (doc.author_name || []).join('; '),
      year: doc.first_publish_year,
      publisher: (doc.publisher || []).slice(0, 3).join('; '),
      key: doc.key,
      isbn: (doc.isbn || []).slice(0, 2),
      edition_count: doc.edition_count,
    }));
  } catch {
    return [];
  }
}

/**
 * Search Google Books for a book (no API key needed for basic search).
 */
async function searchGoogleBooks(title, author) {
  const q = [title, author].filter(Boolean).join(' ');
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&langRestrict=en&maxResults=5`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.items || []).slice(0, 5).map(item => {
      const info = item.volumeInfo || {};
      return {
        source: 'google_books',
        title: info.title,
        subtitle: info.subtitle,
        author: (info.authors || []).join('; '),
        year: info.publishedDate?.match(/\d{4}/)?.[0],
        publisher: info.publisher,
        isbn: (info.industryIdentifiers || []).map(i => i.identifier).slice(0, 2),
        language: info.language,
        google_books_id: item.id,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Check if a claimed translation matches a catalog result.
 * Uses fuzzy matching on title and optional year/translator.
 */
function isMatch(claim, catalogEntry) {
  const claimTitle = normalize(claim.english_title || '');
  const catalogTitle = normalize(catalogEntry.title || '');
  const catalogSubtitle = normalize(catalogEntry.subtitle || '');

  // Title must have significant overlap
  const claimWords = claimTitle.split(/\s+/).filter(w => w.length > 2);
  const catalogWords = (catalogTitle + ' ' + catalogSubtitle).split(/\s+/).filter(w => w.length > 2);

  if (claimWords.length === 0 || catalogWords.length === 0) return false;

  let matchCount = 0;
  for (const w of claimWords) {
    if (catalogWords.some(cw => cw.includes(w) || w.includes(cw))) matchCount++;
  }

  const matchRatio = matchCount / claimWords.length;
  if (matchRatio < 0.5) return false;

  // If year is claimed, it should be close
  if (claim.pub_year && catalogEntry.year) {
    const claimYear = parseInt(claim.pub_year);
    const catYear = parseInt(catalogEntry.year);
    if (!isNaN(claimYear) && !isNaN(catYear) && Math.abs(claimYear - catYear) > 10) {
      return false; // Year too far off
    }
  }

  return true;
}

/** Try to validate a single translation claim */
async function validateClaim(claim, originalAuthor) {
  const results = {
    claim,
    open_library: [],
    google_books: [],
    validated: false,
    validation_source: null,
    best_match: null,
  };

  // Search Open Library
  const olResults = await searchOpenLibrary(claim.english_title, claim.translator || originalAuthor);
  results.open_library = olResults;

  for (const entry of olResults) {
    if (isMatch(claim, entry)) {
      results.validated = true;
      results.validation_source = 'open_library';
      results.best_match = entry;
      return results;
    }
  }

  await new Promise(r => setTimeout(r, DELAY_MS));

  // Search Google Books
  const gbResults = await searchGoogleBooks(claim.english_title, claim.translator || originalAuthor);
  results.google_books = gbResults;

  for (const entry of gbResults) {
    if (isMatch(claim, entry)) {
      results.validated = true;
      results.validation_source = 'google_books';
      results.best_match = entry;
      return results;
    }
  }

  return results;
}

// ── CSV output ──────────────────────────────────────────────────────

function escapeCsv(s) {
  if (!s) return '';
  if (s.includes(',') || s.includes('"') || s.includes('\n'))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function toValidatedCsvRow(book, claim, validation) {
  const author = book.author || '';
  const canonical = author.split(',')[0].trim() || author;
  return [
    `Source Library + ${validation.validation_source}`,
    validation.best_match?.isbn?.[0] || '',
    escapeCsv(canonical),
    escapeCsv(claim.english_title || ''),
    escapeCsv(book.display_title || book.title || ''),
    escapeCsv(claim.translator || ''),
    claim.pub_year || validation.best_match?.year || '',
    '',
    escapeCsv(claim.publisher || validation.best_match?.publisher || ''),
    '',
    book.published?.match(/\d{4}/)?.[0] || '',
    '',
    escapeCsv(canonical),
    escapeCsv(book.display_title || book.title || ''),
  ].join(',');
}

// ── Main ────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const dryRun = !args.includes('--apply');
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : 500;

  console.log(`=== Translation Claim Validation ===`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'APPLYING'}`);
  console.log(`Searches: Open Library + Google Books`);
  console.log(`Limit: ${limit}\n`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB);

  // Find books with unvalidated translation claims
  const books = await db.collection('books')
    .find({
      'translation_verification.has_english_translation': true,
      'translation_verification.translations': { $exists: true, $not: { $size: 0 } },
      'translation_verification.validated': { $exists: false },
    })
    .sort({ title: 1 })
    .limit(limit)
    .project({ id: 1, title: 1, display_title: 1, author: 1, published: 1,
               translation_verification: 1, translation_census: 1 })
    .toArray();

  console.log(`Found ${books.length} books with unvalidated claims\n`);

  let total = 0;
  let validated = 0;
  let unverified = 0;
  const validatedRows = [];
  const allValidations = [];

  for (const book of books) {
    total++;
    const shortTitle = (book.display_title || book.title || '').substring(0, 55);
    const claims = book.translation_verification?.translations || [];
    const bookValidations = [];
    let anyValidated = false;

    for (const claim of claims) {
      const result = await validateClaim(claim, book.author);
      bookValidations.push(result);

      if (result.validated) {
        anyValidated = true;
        validated++;
        validatedRows.push(toValidatedCsvRow(book, claim, result));
        allValidations.push({ book, claim, result });
      } else {
        unverified++;
      }

      await new Promise(r => setTimeout(r, DELAY_MS));
    }

    const icon = anyValidated ? '+' : '?';
    const validCount = bookValidations.filter(v => v.validated).length;
    console.log(`${icon} [${total}/${books.length}] ${shortTitle}`);
    console.log(`    Claims: ${claims.length} | Validated: ${validCount} | Unverified: ${claims.length - validCount}`);

    if (anyValidated) {
      const first = bookValidations.find(v => v.validated);
      console.log(`    CONFIRMED via ${first.validation_source}: "${first.best_match?.title?.substring(0, 60)}" (${first.best_match?.year || '?'})`);
    }

    // Store validation results
    if (!dryRun) {
      const validationData = {
        validated: anyValidated,
        claims_checked: claims.length,
        claims_validated: validCount,
        validations: bookValidations.map(v => ({
          claim_title: v.claim.english_title,
          validated: v.validated,
          validation_source: v.validation_source,
          best_match: v.best_match ? {
            title: v.best_match.title,
            author: v.best_match.author,
            year: v.best_match.year,
            publisher: v.best_match.publisher,
            source: v.best_match.source,
          } : null,
        })),
        checked_at: new Date(),
      };

      await db.collection('books').updateOne(
        { id: book.id },
        { $set: {
          'translation_verification.validated': anyValidated,
          'translation_verification.validation_details': validationData,
          updated_at: new Date(),
        }}
      );
    }
  }

  // Write validated rows to CSV
  if (validatedRows.length > 0 && !dryRun) {
    const header = 'source,series,author,english_title,original_title,translator,pub_year,place,publisher,country,original_year,era,canonical_author,canonical_work';
    const fileExists = fs.existsSync(VALIDATED_CSV);
    const content = fileExists
      ? '\n' + validatedRows.join('\n')
      : header + '\n' + validatedRows.join('\n');
    fs.appendFileSync(VALIDATED_CSV, content + '\n');
    console.log(`\nWrote ${validatedRows.length} validated rows to ${VALIDATED_CSV}`);
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  console.log(`Books checked: ${total}`);
  console.log(`Claims validated (in catalogs): ${validated}`);
  console.log(`Claims unverified: ${unverified}`);
  console.log(`Validation rate: ${total > 0 ? ((validated / (validated + unverified)) * 100).toFixed(1) : 0}%`);

  if (dryRun) console.log('\n(Dry run — use --apply to write to DB + CSV)');

  await client.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
