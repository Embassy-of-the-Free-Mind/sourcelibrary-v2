#!/usr/bin/env npx tsx
/**
 * First-Translation Catalog Cross-Check
 *
 * Tests whether our verification tool correctly handles books whose authors
 * have known English translations in our translation_catalogs collection.
 *
 * The question: when the catalog HAS a translation for a matching author+work,
 * did the tool correctly identify it? If the tool says "confirmed_first" but
 * the catalog has a translation of the SAME work, that's a real false positive.
 *
 * Three tiers of matching:
 *   Tier 1: Author surname + title keyword overlap → probable same work
 *   Tier 2: Author surname match, different work → tool is correct to say "first"
 *   Tier 3: Surname collision (different person) → noise, skip
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/eval/ft-catalog-crosscheck.mjs
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = path.join(__dirname, 'ft-crosscheck-report.json');

// ── Env ──────────────────────────────────────────────────────────────

function loadEnv() {
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
}

loadEnv();

// ── Helpers ──────────────────────────────────────────────────────────

function normalize(s) {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
}

function extractSurname(author) {
  const norm = normalize(author);
  if (norm.includes(',')) return norm.split(',')[0].trim();
  const parts = norm.split(/\s+/);
  return parts[parts.length - 1];
}

function extractFirstName(author) {
  const norm = normalize(author);
  if (norm.includes(',')) {
    const after = norm.split(',').slice(1).join(' ').trim();
    return after.split(/\s+/)[0] || '';
  }
  const parts = norm.split(/\s+/);
  return parts[0] || '';
}

const STOP_WORDS = new Set([
  'the', 'of', 'and', 'in', 'on', 'a', 'an', 'or', 'to', 'for', 'with', 'from', 'by',
  'de', 'des', 'du', 'le', 'la', 'les', 'von', 'van', 'der', 'das', 'die', 'den', 'het',
  'een', 'et', 'pour', 'par', 'sur', 'con', 'del', 'della', 'delle', 'degli', 'nei',
  'nella', 'per', 'una', 'il', 'lo', 'gli', 'di', 'ad', 'que', 'quae', 'qui', 'quod',
  'cum', 'ut', 'vel', 'seu', 'sive', 'atque', 'liber', 'libri', 'opus', 'opera',
  'new', 'old', 'vol', 'volume', 'part', 'book', 'books', 'first', 'second', 'third',
  'complete', 'selected', 'works', 'collected', 'translation', 'translated', 'english',
]);

function contentWords(text) {
  return normalize(text).split(/\s+/).filter(w => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Score how likely two texts refer to the same work.
 * Returns 0-1 where higher = more likely same work.
 */
function titleSimilarity(bookTitle, catalogTitle, catalogOriginalTitle) {
  const bookWords = contentWords(bookTitle);
  if (bookWords.length === 0) return 0;

  // Check against both the English title and original title from the catalog
  const catEnWords = contentWords(catalogTitle);
  const catOrigWords = contentWords(catalogOriginalTitle || '');
  const allCatWords = new Set([...catEnWords, ...catOrigWords]);

  if (allCatWords.size === 0) return 0;

  // Count overlapping words
  const matches = bookWords.filter(w => allCatWords.has(w));
  // Jaccard-like: overlap / min(bookWords, catWords)
  const denom = Math.min(bookWords.length, allCatWords.size);
  return denom > 0 ? matches.length / denom : 0;
}

// Surnames that are too common or ambiguous for reliable matching
const SKIP_SURNAMES = new Set([
  'anonymous', 'unknown', 'anon', 'pseudo',
  // Very common European surnames that cause collisions
  'smith', 'brown', 'miller', 'fischer', 'weber', 'mueller', 'meyer',
]);

// ── Main ─────────────────────────────────────────────────────────────

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  console.log('\nFirst-Translation Catalog Cross-Check');
  console.log('=====================================\n');

  // Step 1: Load all catalog entries into memory
  const allCatalog = await db.collection('translation_catalogs').find({}).project({
    author: 1, author_surname: 1, author_normalized: 1, canonical_author: 1,
    english_title: 1, original_title: 1, canonical_work: 1,
    translator: 1, pub_year: 1, publisher: 1, source: 1, series: 1, completeness: 1,
  }).toArray();

  console.log(`Catalog entries loaded: ${allCatalog.length}`);

  // Build surname index, excluding anonymous
  const bySurname = {};
  for (const entry of allCatalog) {
    const surname = (entry.author_surname || '').toLowerCase().trim();
    if (!surname || surname.length < 3 || SKIP_SURNAMES.has(surname)) continue;
    if (!bySurname[surname]) bySurname[surname] = [];
    bySurname[surname].push(entry);
  }
  console.log(`Indexed ${Object.keys(bySurname).length} distinct author surnames\n`);

  // Step 2: Load all books where we claim "first translation" (any first-* disposition)
  const firstBooks = await db.collection('books').find({
    is_first_translation: true,
    'translation_verification.tools_called': { $exists: true },
    author: { $exists: true, $ne: null, $ne: '', $ne: 'Unknown' },
    pages_count: { $gt: 0 },
  }).project({
    id: 1, author: 1, title: 1, display_title: 1, language: 1,
    'translation_verification.disposition': 1,
    'translation_verification.confidence': 1,
    'translation_verification.reasoning': 1,
    'translation_verification.translations_found': 1,
    'translation_verification.tools_called': 1,
  }).toArray();

  console.log(`Books claiming first translation (with authors): ${firstBooks.length}`);

  // Step 3: Cross-check each book against the catalog
  const tier1_sameWork = [];    // High title similarity — probable false positive
  const tier2_diffWork = [];    // Same author, different work — tool is correct
  const tier3_diffPerson = [];  // Surname collision — noise
  let noMatch = 0;
  let skipped = 0;

  for (const book of firstBooks) {
    const bookAuthor = book.author || '';
    const bookSurname = extractSurname(bookAuthor);
    const bookFirstName = extractFirstName(bookAuthor);
    const bookTitle = book.display_title || book.title || '';

    if (!bookSurname || bookSurname.length < 3 || SKIP_SURNAMES.has(bookSurname)) {
      skipped++;
      continue;
    }

    // Check for author matches
    const hits = bySurname[bookSurname];
    if (!hits || hits.length === 0) {
      noMatch++;
      continue;
    }

    // For each catalog hit, score whether it's the same person and same work
    let bestScore = 0;
    let bestHit = null;
    let samePersonHits = [];

    for (const hit of hits) {
      // Check if it's the same person (not just same surname)
      const catAuthor = normalize(hit.canonical_author || hit.author || '');
      const catFirstName = catAuthor.split(/[\s,]+/).find(p => p !== bookSurname && p.length > 1) || '';

      let samePerson = false;
      if (bookFirstName.length >= 2 && catFirstName.length >= 2) {
        // Compare first names (or initials)
        samePerson = catFirstName.startsWith(bookFirstName.slice(0, 3)) ||
                     bookFirstName.startsWith(catFirstName.slice(0, 3)) ||
                     catAuthor.includes(bookFirstName);
      } else {
        // Can't confirm — assume same person if surname matches exactly
        // (will produce some false matches, but better than missing real ones)
        samePerson = true;
      }

      if (!samePerson) continue;
      samePersonHits.push(hit);

      // Score title similarity
      const score = titleSimilarity(
        bookTitle,
        hit.english_title || '',
        hit.original_title || hit.canonical_work || '',
      );

      if (score > bestScore) {
        bestScore = score;
        bestHit = hit;
      }
    }

    if (samePersonHits.length === 0) {
      tier3_diffPerson.push({ book, hits: hits.slice(0, 3) });
      continue;
    }

    if (bestScore >= 0.3) {
      // Tier 1: Probable same work — this is a potential false positive
      tier1_sameWork.push({
        book_id: book.id,
        author: bookAuthor,
        title: bookTitle,
        language: book.language,
        disposition: book.translation_verification?.disposition,
        confidence: book.translation_verification?.confidence,
        reasoning: book.translation_verification?.reasoning,
        tools_called: book.translation_verification?.tools_called?.length,
        title_similarity: bestScore,
        best_catalog_match: {
          source: bestHit.source,
          english_title: bestHit.english_title,
          original_title: bestHit.original_title || bestHit.canonical_work,
          translator: bestHit.translator,
          year: bestHit.pub_year,
          publisher: bestHit.publisher,
          series: bestHit.series,
          completeness: bestHit.completeness,
        },
        all_catalog_hits: samePersonHits.length,
      });
    } else {
      // Tier 2: Same author, different work — tool is likely correct
      tier2_diffWork.push({
        book_id: book.id,
        author: bookAuthor,
        title: bookTitle.slice(0, 60),
        best_catalog_title: (bestHit?.english_title || '').slice(0, 60),
        similarity: bestScore,
        catalog_hits: samePersonHits.length,
      });
    }
  }

  // ── Report ─────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('CROSS-CHECK RESULTS');
  console.log('='.repeat(70));
  console.log(`Total first-translation books checked: ${firstBooks.length}`);
  console.log(`  Skipped (anonymous/short surname):   ${skipped}`);
  console.log(`  No catalog match at all:             ${noMatch}`);
  console.log(`  Surname collision (different person): ${tier3_diffPerson.length}`);
  console.log(`  Same author, different work:          ${tier2_diffWork.length}`);
  console.log(`  PROBABLE SAME WORK (review needed):   ${tier1_sameWork.length}`);
  console.log('');

  if (tier1_sameWork.length > 0) {
    // Sort by title similarity descending
    tier1_sameWork.sort((a, b) => b.title_similarity - a.title_similarity);

    console.log('POTENTIAL FALSE POSITIVES — catalog has a translation that may match this work');
    console.log('='.repeat(70));
    console.log('(Sorted by title similarity score. Higher = more likely the same work.)\n');

    for (const fp of tier1_sameWork) {
      const m = fp.best_catalog_match;
      const score = (fp.title_similarity * 100).toFixed(0);
      console.log(`[${score}% match] ${fp.author} — ${fp.title.slice(0, 65)}`);
      console.log(`  Our claim:  ${fp.disposition} (${fp.confidence}, ${fp.tools_called} tools)`);
      console.log(`  Catalog:    "${m.english_title}"`);
      if (m.original_title) console.log(`  Orig title: "${m.original_title}"`);
      console.log(`  Translator: ${m.translator || '?'} (${m.year || '?'}) [${m.source}${m.series ? ', ' + m.series : ''}, ${m.completeness || '?'}]`);
      console.log(`  Reasoning:  ${fp.reasoning?.slice(0, 180) || '(none)'}`);
      console.log(`  Book ID:    ${fp.book_id}`);
      console.log('');
    }
  }

  if (tier2_diffWork.length > 0) {
    console.log(`\nSAME AUTHOR, DIFFERENT WORK (${tier2_diffWork.length} books — tool is likely correct)`);
    console.log('-'.repeat(70));
    // Just show a sample
    for (const dw of tier2_diffWork.slice(0, 10)) {
      console.log(`  ${dw.author.slice(0, 25).padEnd(27)} Our: "${dw.title}" | Cat: "${dw.best_catalog_title}" (sim: ${(dw.similarity * 100).toFixed(0)}%)`);
    }
    if (tier2_diffWork.length > 10) console.log(`  ... and ${tier2_diffWork.length - 10} more`);
  }

  // Save full report
  const report = {
    metadata: {
      date: new Date().toISOString(),
      total_checked: firstBooks.length,
      skipped,
      no_catalog_match: noMatch,
      surname_collision: tier3_diffPerson.length,
      different_work: tier2_diffWork.length,
      probable_same_work: tier1_sameWork.length,
    },
    potential_false_positives: tier1_sameWork,
    different_work_sample: tier2_diffWork.slice(0, 50),
  };

  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2) + '\n');
  console.log(`\nFull report saved to: ${REPORT_PATH}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review the "probable same work" cases manually`);
  console.log(`  2. For confirmed false positives, re-run verification with --force`);
  console.log(`  3. False positive rate estimate: ${tier1_sameWork.length}/${firstBooks.length} = ${(tier1_sameWork.length / firstBooks.length * 100).toFixed(1)}% (upper bound — some may be different works)`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
