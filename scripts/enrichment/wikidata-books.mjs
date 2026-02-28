#!/usr/bin/env node

/**
 * Wikidata Book Alignment Script
 *
 * Matches Source Library books to Wikidata Q items, then generates:
 * 1. QuickStatements TSV for batch P953 submission to Wikidata
 * 2. Wikipedia edit request templates for talk pages (with COI disclosure)
 *
 * Two-tier matching:
 * 1. Author's works via SPARQL (high confidence) — query all works by authors
 *    who already have Wikidata QIDs in the entities collection, then fuzzy-match titles
 * 2. Direct title search (medium confidence) — search wbsearchentities, validate P31
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/enrichment/wikidata-books.mjs \
 *       --dry-run --limit=50 --min-translated=80 \
 *       --output-qs=scripts/output/quickstatements.tsv \
 *       --output-wiki=scripts/output/wiki-edit-requests.md
 *
 * Options:
 *   --dry-run              Show matches without writing to DB
 *   --limit=N              Max books to process (default: unlimited)
 *   --offset=N             Skip first N books
 *   --min-translated=N     Minimum translation percent (default: 50)
 *   --mode=MODE            author_works | title_search | all (default: all)
 *   --output-qs=PATH       Output QuickStatements TSV file
 *   --output-wiki=PATH     Output Wikipedia edit request templates
 *   --book-id=ID           Process a single book by ID
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

// --- Config ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit) : Infinity;
const OFFSET = parseInt(args.offset || '0');
const MIN_TRANSLATED = parseInt(args['min-translated'] || '50');
const MODE = args.mode || 'all';
const OUTPUT_QS = args['output-qs'] || null;
const OUTPUT_WIKI = args['output-wiki'] || null;
const BOOK_ID = args['book-id'] || null;

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const BASE_URL = 'https://sourcelibrary.org';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI');
  process.exit(1);
}

// --- Helpers ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }
  return res.json();
}

/**
 * Normalize a title for fuzzy comparison.
 * Strips punctuation, diacritics, lowercases, collapses whitespace.
 */
function normalizeTitle(title) {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')   // punctuation → space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well two titles match (0-1).
 * Handles partial matches, subtitle differences, etc.
 */
function titleSimilarity(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);

  // Exact match
  if (na === nb) return 1.0;

  // One contains the other (common with subtitles)
  if (na.includes(nb) || nb.includes(na)) {
    const shorter = na.length < nb.length ? na : nb;
    const longer = na.length < nb.length ? nb : na;
    return shorter.length / longer.length;
  }

  // Word overlap (Jaccard similarity)
  const wordsA = new Set(na.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(nb.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = new Set([...wordsA, ...wordsB]).size;
  return intersection / union;
}

/**
 * Generate a book URL from slug or ID.
 */
function bookUrl(book) {
  return `${BASE_URL}/book/${book.slug || book.id}`;
}

// --- Wikidata Valid P31 for literary works ---
const VALID_WORK_P31 = new Set([
  'Q7725634',   // literary work
  'Q571',       // book
  'Q47461344',  // written work
  'Q234460',    // text
  'Q49848',     // document
  'Q13442814',  // scholarly article (close enough)
  'Q1238720',   // incunabulum
  'Q429',       // periodical
  'Q5185279',   // poem
  'Q25379',     // play
  'Q17518461',  // creative work
  'Q386724',    // work
  'Q732577',    // publication
  'Q27560760',  // collection of literary works
  'Q1244841',   // literary collection
  'Q3331189',   // edition
]);

// --- Pass 1: Author's Works via SPARQL ---

/**
 * Query all works by a given author QID via Wikidata SPARQL.
 * Returns [{qid, label, description}]
 */
async function getAuthorWorks(authorQid) {
  const sparql = `
    SELECT ?work ?workLabel ?workDescription WHERE {
      ?work wdt:P50 wd:${authorQid} .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en,la,de,fr,it" . }
    }
    LIMIT 500
  `;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;

  const data = await apiFetch(url);
  return (data.results?.bindings || []).map(b => ({
    qid: b.work?.value?.replace('http://www.wikidata.org/entity/', ''),
    label: b.workLabel?.value || '',
    description: b.workDescription?.value || '',
  }));
}

/**
 * Match books against an author's known works on Wikidata.
 */
async function matchAuthorWorks(db, authorEntity, books) {
  const authorQid = authorEntity.wikidata_id;
  const matches = [];

  try {
    const works = await getAuthorWorks(authorQid);
    if (works.length === 0) {
      console.log(`    No works found on Wikidata for ${authorEntity.name} (${authorQid})`);
      return matches;
    }

    console.log(`    ${works.length} works on Wikidata for ${authorEntity.name}`);

    for (const book of books) {
      let bestMatch = null;
      let bestScore = 0;

      for (const work of works) {
        // Compare against both title and display_title
        const titles = [book.title, book.display_title].filter(Boolean);
        for (const bookTitle of titles) {
          const score = titleSimilarity(bookTitle, work.label);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = work;
          }
        }
      }

      if (bestMatch && bestScore >= 0.5) {
        const confidence = bestScore >= 0.8 ? 'high' : 'medium';
        matches.push({
          book,
          qid: bestMatch.qid,
          label: bestMatch.label,
          description: bestMatch.description,
          confidence,
          score: bestScore,
          method: 'author_works',
        });
      }
    }
  } catch (err) {
    console.error(`    [error] SPARQL query for ${authorQid}: ${err.message}`);
  }

  return matches;
}

async function passAuthorWorks(db, candidateBooks) {
  console.log('\n=== Pass 1: Author Works via SPARQL ===\n');

  // Get all person entities with Wikidata QIDs
  const authorEntities = await db.collection('entities')
    .find({
      type: 'person',
      wikidata_id: { $exists: true, $ne: '' },
    })
    .project({ name: 1, wikidata_id: 1, aliases: 1 })
    .toArray();

  console.log(`${authorEntities.length} authors with Wikidata QIDs in entities collection`);

  // Build a lookup: normalized author name → entity
  const authorLookup = new Map();
  for (const ae of authorEntities) {
    authorLookup.set(normalizeTitle(ae.name), ae);
    if (ae.aliases) {
      for (const alias of ae.aliases) {
        authorLookup.set(normalizeTitle(alias), ae);
      }
    }
  }

  // Group books by matched author
  const authorBooks = new Map();
  let unmatchedAuthors = 0;

  for (const book of candidateBooks) {
    if (book.wikidata_id) continue; // Already matched

    const normAuthor = normalizeTitle(book.author || '');
    const authorEntity = authorLookup.get(normAuthor);

    if (authorEntity) {
      const key = authorEntity.wikidata_id;
      if (!authorBooks.has(key)) {
        authorBooks.set(key, { entity: authorEntity, books: [] });
      }
      authorBooks.get(key).books.push(book);
    } else {
      unmatchedAuthors++;
    }
  }

  console.log(`${authorBooks.size} authors matched, ${unmatchedAuthors} books with unrecognized authors`);

  const allMatches = [];
  let authorIdx = 0;

  for (const [qid, { entity, books }] of authorBooks) {
    authorIdx++;
    console.log(`\n  [${authorIdx}/${authorBooks.size}] ${entity.name} (${qid}) — ${books.length} books`);

    const matches = await matchAuthorWorks(db, entity, books);
    for (const m of matches) {
      console.log(`    [${m.confidence}] "${m.book.title}" → ${m.qid} "${m.label}" (score: ${m.score.toFixed(2)})`);
    }
    allMatches.push(...matches);

    await sleep(1000); // Rate limit SPARQL endpoint
  }

  return allMatches;
}

// --- Pass 2: Direct Title Search ---

async function searchWikidataForBook(book) {
  // Build candidate titles: original, display, and short forms (before colon/semicolon)
  const rawTitles = [book.title, book.display_title].filter(Boolean);
  const titles = [...new Set(rawTitles)]; // dedupe

  // Add short forms (before colon or semicolon) if different
  for (const t of rawTitles) {
    const short = t.split(/[;:]/).map(s => s.trim())[0];
    if (short && short !== t && short.length >= 5) {
      titles.push(short);
    }
  }

  for (const title of titles) {
    // Truncate very long titles for search
    const searchTitle = title.length > 100 ? title.substring(0, 100) : title;
    const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(searchTitle)}&language=en&type=item&limit=5&format=json`;

    try {
      const data = await apiFetch(url);
      if (!data.search?.length) continue;

      for (const result of data.search) {
        // Check title similarity
        const score = Math.max(
          titleSimilarity(title, result.label || ''),
          ...(result.aliases || []).map(a => titleSimilarity(title, a))
        );

        if (score < 0.5) continue;

        // Validate P31 — must be a work/book type
        const isWork = await validateP31(result.id);
        if (!isWork) continue;

        return {
          qid: result.id,
          label: result.label,
          description: result.description || '',
          score,
          confidence: score >= 0.8 ? 'medium' : 'suggested', // title search is inherently lower confidence
        };
      }
    } catch (err) {
      // Non-fatal — try next title
    }
  }

  return null;
}

async function validateP31(qid) {
  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P31&format=json`;
    const data = await apiFetch(url);
    const claims = data.claims?.P31 || [];

    for (const claim of claims) {
      const targetId = claim.mainsnak?.datavalue?.value?.id;
      if (targetId && VALID_WORK_P31.has(targetId)) return true;
    }

    // If no P31 at all, it might still be valid — be lenient
    if (claims.length === 0) return true;

    return false;
  } catch {
    return false;
  }
}

async function passTitleSearch(db, candidateBooks) {
  console.log('\n=== Pass 2: Direct Title Search ===\n');

  // Only search books that weren't matched in Pass 1
  const unmatched = candidateBooks.filter(b => !b._matched);
  console.log(`${unmatched.length} books to search by title`);

  const matches = [];

  for (let i = 0; i < unmatched.length; i++) {
    const book = unmatched[i];
    const progress = `[${i + 1}/${unmatched.length}]`;

    try {
      const result = await searchWikidataForBook(book);
      if (result) {
        console.log(`  ${progress} [${result.confidence}] "${book.title}" → ${result.qid} "${result.label}" (${result.score.toFixed(2)})`);
        matches.push({
          book,
          qid: result.qid,
          label: result.label,
          description: result.description,
          confidence: result.confidence,
          score: result.score,
          method: 'title_search',
        });
      } else {
        console.log(`  ${progress} [miss] "${book.title}"`);
      }
    } catch (err) {
      console.error(`  ${progress} [error] "${book.title}": ${err.message}`);
    }

    await sleep(500); // Rate limit
  }

  return matches;
}

// --- Output Generators ---

/**
 * Generate QuickStatements TSV for batch P953 submission.
 * P953 = full work available at URL
 * P407 = language of work (Q1860 = English for our translations)
 * S854 = reference URL
 */
function generateQuickStatements(matches) {
  const lines = ['// QuickStatements v1 batch — Source Library full text links'];
  lines.push('// P953 = full work available at URL, P407 = language of work or name, S854 = reference URL');
  lines.push('// Submit at: https://quickstatements.toolforge.org/#/batch');
  lines.push('');

  for (const m of matches) {
    if (m.confidence === 'suggested') continue; // Only submit high/medium confidence
    const url = bookUrl(m.book);
    // TAB-separated: entity, property, value, qualifier property, qualifier value, source property, source value
    lines.push(`${m.qid}\tP953\t"${url}"\tP407\tQ1860\tS854\t"${BASE_URL}"`);
  }

  return lines.join('\n');
}

/**
 * Generate Wikipedia talk page edit request templates.
 */
function generateWikiEditRequests(matches) {
  const lines = ['# Wikipedia Edit Requests — Source Library'];
  lines.push('');
  lines.push('Post each request on the relevant Wikipedia article\'s Talk page.');
  lines.push('Always disclose COI (conflict of interest) per Wikipedia policy.');
  lines.push('');

  // Only generate for high-confidence matches with good translations
  const eligible = matches.filter(m =>
    m.confidence === 'high' &&
    m.book.pages_translated > 0
  );

  // Sort by read_count desc — highest traffic first
  eligible.sort((a, b) => (b.book.read_count || 0) - (a.book.read_count || 0));

  for (const m of eligible) {
    const url = bookUrl(m.book);
    const book = m.book;
    const translatedPages = book.pages_translated || 0;
    const totalPages = book.pages_count || 0;
    const pct = totalPages > 0 ? Math.round((translatedPages / totalPages) * 100) : 0;
    const year = book.published || 'unknown';
    const wdLink = `https://www.wikidata.org/wiki/${m.qid}`;

    lines.push(`---`);
    lines.push('');
    lines.push(`## ${book.display_title || book.title}`);
    lines.push(`- **Author:** ${book.author}`);
    lines.push(`- **Year:** ${year}`);
    lines.push(`- **Wikidata:** [${m.qid}](${wdLink})`);
    lines.push(`- **Translation:** ${pct}% (${translatedPages}/${totalPages} pages)`);
    lines.push(`- **URL:** ${url}`);
    lines.push('');
    lines.push('### Talk page post:');
    lines.push('');
    lines.push('```wiki');
    lines.push(`== External link suggestion: English translation at Source Library ==`);
    lines.push('');
    lines.push('{{edit COI}} I\'m affiliated with Source Library.');
    lines.push('');
    lines.push(`* [${url} ${book.display_title || book.title}] — page-by-page English translation of ${book.author}'s ${year} text (${translatedPages} pages, ${pct}% complete). Original language alongside translation. Free access, CC-BY-4.0 license.`);
    lines.push('');
    lines.push('~~~~');
    lines.push('```');
    lines.push('');
  }

  if (eligible.length === 0) {
    lines.push('No high-confidence matches with translations found.');
  } else {
    lines.push(`---`);
    lines.push(`Total: ${eligible.length} edit requests generated.`);
  }

  return lines.join('\n');
}

// --- Main ---

async function main() {
  console.log('Wikidata Book Alignment');
  console.log('=======================');
  console.log(`Mode: ${MODE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Min translation: ${MIN_TRANSLATED}%`);
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT}`);
  if (OFFSET > 0) console.log(`Offset: ${OFFSET}`);
  if (BOOK_ID) console.log(`Book ID: ${BOOK_ID}`);
  if (OUTPUT_QS) console.log(`QuickStatements output: ${OUTPUT_QS}`);
  if (OUTPUT_WIKI) console.log(`Wiki edit requests output: ${OUTPUT_WIKI}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    // --- Fetch candidate books ---
    const bookFilter = {
      wikidata_id: { $exists: false },
      hidden: { $ne: true },
    };

    if (BOOK_ID) {
      bookFilter.id = BOOK_ID;
    }

    // Get books with their page stats
    let booksQuery = db.collection('books')
      .find(bookFilter)
      .project({
        id: 1, slug: 1, title: 1, display_title: 1, author: 1,
        language: 1, published: 1, pages_count: 1, pages_translated: 1,
        pages_ocr: 1, read_count: 1, license: 1, doi: 1,
        ia_identifier: 1, image_source: 1,
      })
      .sort({ read_count: -1 });

    if (!BOOK_ID) {
      booksQuery = booksQuery.skip(OFFSET);
      if (LIMIT < Infinity) booksQuery = booksQuery.limit(LIMIT);
    }

    let candidateBooks = await booksQuery.toArray();

    // Filter by translation percent
    candidateBooks = candidateBooks.filter(b => {
      const pct = b.pages_count > 0 ? ((b.pages_translated || 0) / b.pages_count) * 100 : 0;
      return pct >= MIN_TRANSLATED;
    });

    console.log(`\n${candidateBooks.length} candidate books (${MIN_TRANSLATED}%+ translated, no wikidata_id)`);
    if (candidateBooks.length === 0) {
      console.log('No books to process.');
      return;
    }

    // --- Run matching ---
    let allMatches = [];

    if (MODE === 'author_works' || MODE === 'all') {
      const authorMatches = await passAuthorWorks(db, candidateBooks);
      // Mark matched books so Pass 2 skips them
      for (const m of authorMatches) {
        m.book._matched = true;
      }
      allMatches.push(...authorMatches);
    }

    if (MODE === 'title_search' || MODE === 'all') {
      const titleMatches = await passTitleSearch(db, candidateBooks);
      allMatches.push(...titleMatches);
    }

    // Deduplicate (prefer higher confidence)
    const bestByBook = new Map();
    for (const m of allMatches) {
      const existing = bestByBook.get(m.book.id);
      if (!existing || confidenceRank(m.confidence) > confidenceRank(existing.confidence)) {
        bestByBook.set(m.book.id, m);
      }
    }
    const deduped = [...bestByBook.values()];

    // --- Write to DB ---
    if (!DRY_RUN) {
      let written = 0;
      for (const m of deduped) {
        if (m.confidence === 'suggested') continue; // Don't write suggestions to DB

        await db.collection('books').updateOne(
          { id: m.book.id },
          {
            $set: {
              wikidata_id: m.qid,
              wikidata_label: m.label,
              wikidata_match: {
                confidence: m.confidence,
                method: m.method,
                matched_at: new Date(),
              },
              updated_at: new Date(),
            },
          }
        );
        written++;
      }
      console.log(`\nWrote ${written} matches to database`);
    }

    // --- Generate outputs ---
    if (OUTPUT_QS && deduped.length > 0) {
      const qs = generateQuickStatements(deduped);
      mkdirSync(dirname(OUTPUT_QS), { recursive: true });
      writeFileSync(OUTPUT_QS, qs);
      console.log(`\nQuickStatements TSV written to ${OUTPUT_QS}`);
    }

    if (OUTPUT_WIKI && deduped.length > 0) {
      const wiki = generateWikiEditRequests(deduped);
      mkdirSync(dirname(OUTPUT_WIKI), { recursive: true });
      writeFileSync(OUTPUT_WIKI, wiki);
      console.log(`Wikipedia edit requests written to ${OUTPUT_WIKI}`);
    }

    // --- Summary ---
    console.log('\n=== Summary ===');
    const byConfidence = { high: 0, medium: 0, suggested: 0 };
    const byMethod = { author_works: 0, title_search: 0 };
    for (const m of deduped) {
      byConfidence[m.confidence]++;
      byMethod[m.method]++;
    }
    console.log(`Total matches: ${deduped.length}`);
    console.log(`  By confidence: high=${byConfidence.high}, medium=${byConfidence.medium}, suggested=${byConfidence.suggested}`);
    console.log(`  By method: author_works=${byMethod.author_works}, title_search=${byMethod.title_search}`);
    console.log(`  Unmatched: ${candidateBooks.length - deduped.length}`);

    if (DRY_RUN) {
      console.log('\n(dry run — no DB changes written)');
    }

    // Print top matches for review
    if (deduped.length > 0) {
      console.log('\n=== Top Matches ===\n');
      const top = deduped
        .filter(m => m.confidence !== 'suggested')
        .sort((a, b) => (b.book.read_count || 0) - (a.book.read_count || 0))
        .slice(0, 20);

      for (const m of top) {
        const url = bookUrl(m.book);
        console.log(`  [${m.confidence}/${m.method}] ${m.book.title}`);
        console.log(`    → ${m.qid} "${m.label}" (score: ${m.score.toFixed(2)})`);
        console.log(`    ${url}`);
        console.log(`    https://www.wikidata.org/wiki/${m.qid}`);
        console.log('');
      }
    }

  } finally {
    await client.close();
  }
}

function confidenceRank(c) {
  return c === 'high' ? 3 : c === 'medium' ? 2 : 1;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
