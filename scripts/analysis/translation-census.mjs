/**
 * Translation Census: Phase 1
 *
 * Match USTC Latin editions against known English translation catalogs.
 * Produces the first real count of what has and hasn't been translated.
 *
 * Strategy:
 * 1. Pull all distinct author surnames from USTC Latin editions (via Supabase pagination)
 * 2. For each surname that appears in the translation catalog, pull USTC works by that author
 * 3. Fuzzy-match USTC titles against translated works
 * 4. Count: translated authors/works vs untranslated
 *
 * Output: summary stats + detailed JSON for further analysis
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlraHhhZWNiYnhhYXFsdWp1emRlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwNjExMDEsImV4cCI6MjA4MDYzNzEwMX0.O2chfnHGQWLOaVSFQ-F6UJMlya9EzPbsUh848SEOPj4';

const headers = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
};

// --- Step 1: Build translation catalog lookup ---
async function buildCatalogLookup() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  const catalogs = await db.collection('translation_catalogs').find({}, {
    projection: {
      canonical_author_normalized: 1,
      canonical_work_normalized: 1,
      author_surname: 1,
      english_title_normalized: 1,
      source: 1,
    }
  }).toArray();

  // Build surname -> [{ author, work, english_title }] map
  const bySurname = new Map();

  for (const c of catalogs) {
    const surname = (c.author_surname || '').toLowerCase().trim();
    if (!surname || surname.length < 2) continue;

    if (!bySurname.has(surname)) bySurname.set(surname, []);
    bySurname.get(surname).push({
      author: (c.canonical_author_normalized || '').toLowerCase().trim(),
      work: (c.canonical_work_normalized || '').toLowerCase().trim(),
      englishTitle: (c.english_title_normalized || '').toLowerCase().trim(),
    });
  }

  await client.close();
  return bySurname;
}

// --- Step 2: Get distinct authors from USTC Latin editions ---
// USTC has author_1 in "Surname, Given" format
// We can't pull all 503K rows, but we can get distinct authors via the enrichments table
// or paginate through editions grouped by author

async function getUstcLatinAuthorCounts() {
  // Use RPC or paginated approach to get unique author_1 values for Latin editions
  // Supabase doesn't support DISTINCT natively via REST, so we'll sample heavily

  console.log('Fetching USTC Latin edition authors (paginated sampling)...');

  const authorEditionCount = new Map(); // surname -> edition count
  const authorTitles = new Map(); // surname -> Set of distinct titles

  // Paginate through Latin editions, sampling by year ranges to cover the full corpus
  const yearRanges = [];
  for (let y = 1450; y <= 1700; y += 5) {
    yearRanges.push([y, y + 4]);
  }

  let totalEditionsScanned = 0;

  for (const [startYear, endYear] of yearRanges) {
    let offset = 0;
    const limit = 1000;

    while (true) {
      const url = new URL(`${SUPABASE_URL}/rest/v1/ustc_editions`);
      url.searchParams.set('select', 'author_1,title');
      url.searchParams.set('language_1', 'eq.Latin');
      url.searchParams.set('year', `gte.${startYear}`);
      url.searchParams.set('and', `(year.lte.${endYear})`);
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('order', 'id');

      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        console.error(`Failed for ${startYear}-${endYear} offset ${offset}: ${res.status}`);
        break;
      }

      const data = await res.json();
      if (data.length === 0) break;

      for (const row of data) {
        const author = (row.author_1 || '').trim();
        if (!author) continue;

        // Extract surname (before first comma)
        const surname = author.split(',')[0].toLowerCase().trim();
        if (!surname || surname.length < 2) continue;

        authorEditionCount.set(surname, (authorEditionCount.get(surname) || 0) + 1);

        if (!authorTitles.has(surname)) authorTitles.set(surname, new Set());
        const title = (row.title || '').toLowerCase().trim();
        if (title) authorTitles.get(surname).add(title);
      }

      totalEditionsScanned += data.length;
      offset += limit;

      if (data.length < limit) break;
    }

    if ((startYear - 1450) % 50 === 0) {
      console.log(`  ${startYear}... (${totalEditionsScanned.toLocaleString()} editions, ${authorEditionCount.size.toLocaleString()} authors)`);
    }
  }

  console.log(`Total: ${totalEditionsScanned.toLocaleString()} Latin editions scanned, ${authorEditionCount.size.toLocaleString()} distinct author surnames`);

  return { authorEditionCount, authorTitles, totalEditionsScanned };
}

// --- Step 3: Match ---
function matchAuthors(catalogBySurname, ustcAuthorEditions, ustcAuthorTitles) {
  const results = {
    matchedAuthors: [],      // authors in both USTC and catalog
    unmatchedUstcAuthors: 0,  // authors in USTC but not in catalog
    totalUstcAuthors: ustcAuthorEditions.size,
    totalCatalogSurnames: catalogBySurname.size,

    // Edition-level counts
    editionsWithTranslatedAuthor: 0,
    editionsWithUntranslatedAuthor: 0,

    // Work-level estimates
    ustcWorksWithTranslatedAuthor: 0,
    ustcWorksWithUntranslatedAuthor: 0,
  };

  for (const [surname, editionCount] of ustcAuthorEditions.entries()) {
    const titles = ustcAuthorTitles.get(surname);
    const workCount = titles ? titles.size : 0;

    if (catalogBySurname.has(surname)) {
      const catalogEntries = catalogBySurname.get(surname);
      const catalogWorks = new Set(catalogEntries.map(e => e.work).filter(w => w));

      results.matchedAuthors.push({
        surname,
        ustcEditions: editionCount,
        ustcDistinctWorks: workCount,
        catalogTranslations: catalogEntries.length,
        catalogDistinctWorks: catalogWorks.size,
        sampleUstcTitles: titles ? [...titles].slice(0, 5) : [],
        sampleCatalogWorks: [...catalogWorks].slice(0, 5),
      });
      results.editionsWithTranslatedAuthor += editionCount;
      results.ustcWorksWithTranslatedAuthor += workCount;
    } else {
      results.unmatchedUstcAuthors++;
      results.editionsWithUntranslatedAuthor += editionCount;
      results.ustcWorksWithUntranslatedAuthor += workCount;
    }
  }

  // Sort matched authors by edition count (most prolific first)
  results.matchedAuthors.sort((a, b) => b.ustcEditions - a.ustcEditions);

  return results;
}

// --- Main ---
async function main() {
  console.log('=== Translation Census: Phase 1 ===\n');

  console.log('Step 1: Building translation catalog lookup...');
  const catalogBySurname = await buildCatalogLookup();
  console.log(`  ${catalogBySurname.size} distinct author surnames in translation catalogs\n`);

  console.log('Step 2: Scanning USTC Latin editions...');
  const { authorEditionCount, authorTitles, totalEditionsScanned } = await getUstcLatinAuthorCounts();
  console.log();

  console.log('Step 3: Matching...');
  const results = matchAuthors(catalogBySurname, authorEditionCount, authorTitles);

  // --- Report ---
  console.log('\n========================================');
  console.log('  TRANSLATION CENSUS: LATIN EDITIONS');
  console.log('========================================\n');

  console.log(`Total Latin editions scanned:    ${totalEditionsScanned.toLocaleString()}`);
  console.log(`Distinct author surnames (USTC): ${results.totalUstcAuthors.toLocaleString()}`);
  console.log(`Distinct author surnames (catalog): ${results.totalCatalogSurnames.toLocaleString()}`);
  console.log(`Authors matched:                 ${results.matchedAuthors.length.toLocaleString()}`);
  console.log(`Authors unmatched (no known translation): ${results.unmatchedUstcAuthors.toLocaleString()}`);
  console.log();

  const pctAuthorsMatched = (results.matchedAuthors.length / results.totalUstcAuthors * 100).toFixed(1);
  const pctEditionsMatched = (results.editionsWithTranslatedAuthor / totalEditionsScanned * 100).toFixed(1);

  console.log(`% of USTC authors with ANY known translation: ${pctAuthorsMatched}%`);
  console.log(`% of Latin editions by a translated author:   ${pctEditionsMatched}%`);
  console.log();

  console.log('NOTE: "Translated author" means at least one work by this author');
  console.log('has a known English translation. Most of their works likely do NOT.');
  console.log('The actual % of translated WORKS is much lower.\n');

  // Estimate work-level translation rate
  let estimatedTranslatedWorks = 0;
  for (const author of results.matchedAuthors) {
    // Conservative: assume only the catalog works are translated, not all works by that author
    estimatedTranslatedWorks += Math.min(author.catalogDistinctWorks, author.ustcDistinctWorks);
  }
  const totalDistinctWorks = results.ustcWorksWithTranslatedAuthor + results.ustcWorksWithUntranslatedAuthor;
  const pctWorksTranslated = (estimatedTranslatedWorks / totalDistinctWorks * 100).toFixed(2);

  console.log(`Distinct works (all USTC Latin authors): ${totalDistinctWorks.toLocaleString()}`);
  console.log(`Works with likely translation (upper bound): ${estimatedTranslatedWorks.toLocaleString()}`);
  console.log(`Estimated % of distinct Latin works translated: ${pctWorksTranslated}%`);
  console.log();

  // Top matched authors
  console.log('Top 25 matched authors (most USTC editions):');
  console.log('-'.repeat(90));
  console.log('Surname'.padEnd(25) + 'USTC editions'.padEnd(15) + 'USTC works'.padEnd(12) + 'Known translations'.padEnd(20) + 'Catalog works');
  console.log('-'.repeat(90));
  for (const a of results.matchedAuthors.slice(0, 25)) {
    console.log(
      a.surname.padEnd(25) +
      String(a.ustcEditions).padEnd(15) +
      String(a.ustcDistinctWorks).padEnd(12) +
      String(a.catalogTranslations).padEnd(20) +
      String(a.catalogDistinctWorks)
    );
  }

  // Top unmatched authors (by edition count)
  console.log('\nTop 25 UNMATCHED authors (most editions, no known translation):');
  console.log('-'.repeat(60));
  const unmatched = [];
  for (const [surname, count] of authorEditionCount.entries()) {
    if (!catalogBySurname.has(surname)) {
      unmatched.push({ surname, editions: count, works: authorTitles.get(surname)?.size || 0 });
    }
  }
  unmatched.sort((a, b) => b.editions - a.editions);
  console.log('Surname'.padEnd(30) + 'Editions'.padEnd(12) + 'Distinct works');
  console.log('-'.repeat(60));
  for (const a of unmatched.slice(0, 25)) {
    console.log(a.surname.padEnd(30) + String(a.editions).padEnd(12) + String(a.works));
  }

  // Save full results
  const fs = await import('fs');
  const outputPath = 'scripts/analysis/census-results.json';
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalLatinEditionsScanned: totalEditionsScanned,
    totalDistinctAuthors: results.totalUstcAuthors,
    totalDistinctWorks: totalDistinctWorks,
    authorsWithKnownTranslation: results.matchedAuthors.length,
    authorsWithNoKnownTranslation: results.unmatchedUstcAuthors,
    pctAuthorsWithTranslation: parseFloat(pctAuthorsMatched),
    pctEditionsByTranslatedAuthor: parseFloat(pctEditionsMatched),
    estimatedWorksTranslated: estimatedTranslatedWorks,
    pctWorksTranslated: parseFloat(pctWorksTranslated),
    topMatchedAuthors: results.matchedAuthors.slice(0, 100),
    topUnmatchedAuthors: unmatched.slice(0, 100),
  }, null, 2));
  console.log(`\nFull results saved to ${outputPath}`);
}

main().catch(console.error);
