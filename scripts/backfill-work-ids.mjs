#!/usr/bin/env node
/**
 * Identify books that are likely editions/translations of the same underlying work
 * by computing entity overlap (Jaccard similarity) from AI-generated indexes.
 *
 * Groups books by normalized author, then computes pairwise Jaccard similarity
 * on their combined entity sets (people + concepts + places). Uses union-find
 * to build transitive work groups.
 *
 * Usage:
 *   secret-lover run -- node scripts/backfill-work-ids.mjs                   # dry run (default)
 *   secret-lover run -- node scripts/backfill-work-ids.mjs --apply           # write work_id to DB
 *   secret-lover run -- node scripts/backfill-work-ids.mjs --threshold 0.15  # adjust similarity bar
 *   secret-lover run -- node scripts/backfill-work-ids.mjs --verbose         # show all pairwise comparisons
 */

import { MongoClient } from 'mongodb';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Use: secret-lover run -- node scripts/backfill-work-ids.mjs');
  process.exit(1);
}

const args = process.argv.slice(2);
const applyMode = args.includes('--apply');
const verboseMode = args.includes('--verbose');
const thresholdIdx = args.indexOf('--threshold');
const SIMILARITY_THRESHOLD = thresholdIdx !== -1
  ? parseFloat(args[thresholdIdx + 1])
  : 0.2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Normalize an author string for grouping: lowercase, trim, collapse whitespace. */
function normalizeAuthor(author) {
  if (!author || author === 'Unknown') return null;
  return author
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation, keep unicode letters/digits
    .replace(/\s+/g, ' ')
    .trim() || null;
}

/** Extract the set of entity term strings from a book's index. */
function extractEntityTerms(book) {
  const terms = new Set();
  for (const entry of (book.index?.people || [])) {
    if (entry.term) terms.add(entry.term.toLowerCase().trim());
  }
  for (const entry of (book.index?.concepts || [])) {
    if (entry.term) terms.add(entry.term.toLowerCase().trim());
  }
  for (const entry of (book.index?.places || [])) {
    if (entry.term) terms.add(entry.term.toLowerCase().trim());
  }
  return terms;
}

/** Jaccard similarity: |A ∩ B| / |A ∪ B| */
function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Normalize a title to significant keywords for comparison. */
function titleKeywords(title) {
  if (!title) return new Set();
  const stopWords = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'de', 'la', 'le', 'les',
    'der', 'die', 'das', 'von', 'und', 'del', 'di', 'il', 'et', 'cum', 'ad',
    'to', 'from', 'by', 'with', 'for', 'his', 'her', 'its', 'their', 'that',
    'this', 'vol', 'volume', 'book', 'edition', 'first', 'second', 'third',
    'new', 'old', 'great', 'part', 'parts', 'tomus', 'liber', 'libri',
  ]);
  return new Set(
    title
      .toLowerCase()
      .replace(/\(.*?\)/g, '')         // strip parentheticals (e.g., "(1543 First Edition)")
      .replace(/[^\p{L}\p{N}\s]/gu, '') // strip punctuation
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w))
  );
}

/**
 * Combined similarity score for two books by the same author.
 * Blends entity Jaccard with title keyword overlap.
 *
 * Returns { score, entityJaccard, titleJaccard, reason }
 */
function combinedSimilarity(bookA, bookB, entitySetA, entitySetB) {
  const entJ = jaccard(entitySetA, entitySetB);
  const titleA = titleKeywords(bookA.display_title || bookA.title);
  const titleB = titleKeywords(bookB.display_title || bookB.title);
  const titJ = jaccard(titleA, titleB);

  // Weighted blend:
  // - If both have entities (10+), lean on entity overlap (70/30)
  // - If one/both have few entities, lean more on title (40/60)
  const bothHaveEntities = entitySetA.size >= 10 && entitySetB.size >= 10;
  const entWeight = bothHaveEntities ? 0.7 : 0.4;
  const titWeight = 1 - entWeight;

  const score = entJ * entWeight + titJ * titWeight;

  return { score, entityJaccard: entJ, titleJaccard: titJ };
}

// ---------------------------------------------------------------------------
// Union-Find for connected components
// ---------------------------------------------------------------------------

class UnionFind {
  constructor() {
    this.parent = new Map();
    this.rank = new Map();
  }

  makeSet(x) {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x) {
    if (this.parent.get(x) !== x) {
      this.parent.set(x, this.find(this.parent.get(x))); // path compression
    }
    return this.parent.get(x);
  }

  union(x, y) {
    const rootX = this.find(x);
    const rootY = this.find(y);
    if (rootX === rootY) return;
    const rankX = this.rank.get(rootX);
    const rankY = this.rank.get(rootY);
    if (rankX < rankY) {
      this.parent.set(rootX, rootY);
    } else if (rankX > rankY) {
      this.parent.set(rootY, rootX);
    } else {
      this.parent.set(rootY, rootX);
      this.rank.set(rootX, rankX + 1);
    }
  }

  /** Return groups as Map<root, string[]> */
  groups() {
    const result = new Map();
    for (const x of this.parent.keys()) {
      const root = this.find(x);
      if (!result.has(root)) result.set(root, []);
      result.get(root).push(x);
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// Work ID slug generation
// ---------------------------------------------------------------------------

/** Generate a work_id slug from author + title. */
function generateWorkId(author, title) {
  const raw = (author || 'unknown').trim();

  // Detect "Surname, Firstname" format (common in library catalogs)
  let lastName;
  if (raw.includes(',')) {
    lastName = raw.split(',')[0].replace(/[^\p{L}]/gu, '').trim().toLowerCase();
  } else {
    // "Firstname Lastname" or single name — use last word
    const authorClean = raw
      .replace(/\(.*?\)/g, '')
      .replace(/[^\p{L}\s-]/gu, '')
      .trim();
    const authorParts = authorClean.split(/\s+/);
    lastName = (authorParts[authorParts.length - 1] || 'unknown').toLowerCase();
  }

  // Simplify title: take first meaningful words
  const titleClean = (title || 'untitled')
    .replace(/\(.*?\)/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();

  const stopWords = new Set([
    'the', 'a', 'an', 'of', 'in', 'on', 'and', 'or', 'de', 'la', 'le', 'les',
    'der', 'die', 'das', 'von', 'und', 'del', 'di', 'il', 'et', 'cum', 'ad',
    'seu', 'sive', 'ac', 'atque', 'quae', 'qui', 'ex', 'per', 'pro', 'ab',
  ]);

  const titleWords = titleClean
    .split(/\s+/)
    .map(w => w.toLowerCase())
    .filter(w => w.length > 1 && !stopWords.has(w));

  // Take up to 4 significant words
  const titleSlug = titleWords.slice(0, 4).join('-');

  const slug = `${lastName}-${titleSlug}`
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 60);

  return slug || 'unknown-work';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('='.repeat(72));
  console.log('  WORK GROUP DETECTION — Entity Overlap Analysis');
  console.log('='.repeat(72));
  console.log(`  Mode:       ${applyMode ? 'APPLY (will write work_id to database)' : 'DRY RUN (read-only)'}`);
  console.log(`  Threshold:  Jaccard >= ${SIMILARITY_THRESHOLD}`);
  console.log('');

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const booksCol = db.collection('books');

  // ------------------------------------------------------------------
  // Step 1: Pull books with index data
  // ------------------------------------------------------------------

  const totalBooks = await booksCol.countDocuments();
  const booksWithIndex = await booksCol
    .find({ 'index.people': { $exists: true } })
    .project({
      id: 1,
      title: 1,
      display_title: 1,
      author: 1,
      language: 1,
      published: 1,
      work_id: 1,
      'index.people': 1,
      'index.concepts': 1,
      'index.places': 1,
    })
    .toArray();

  const booksWithoutIndex = totalBooks - booksWithIndex.length;

  console.log(`  Books in database:    ${totalBooks}`);
  console.log(`  Books with indexes:   ${booksWithIndex.length}`);
  console.log(`  Books without indexes: ${booksWithoutIndex}`);
  console.log('');

  // ------------------------------------------------------------------
  // Step 2: Group by normalized author
  // ------------------------------------------------------------------

  const authorGroups = new Map(); // normalizedAuthor -> book[]

  for (const book of booksWithIndex) {
    const normAuthor = normalizeAuthor(book.author);
    if (!normAuthor) continue; // skip books with no/unknown author
    if (!authorGroups.has(normAuthor)) authorGroups.set(normAuthor, []);
    authorGroups.get(normAuthor).push(book);
  }

  // Only keep author groups with 2+ books (can't have edition pairs with 1 book)
  const multiBookAuthors = [...authorGroups.entries()]
    .filter(([, books]) => books.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`  Authors with 2+ indexed books: ${multiBookAuthors.length}`);
  console.log('');

  // Pre-compute entity sets
  const entitySets = new Map();
  for (const book of booksWithIndex) {
    entitySets.set(book.id, extractEntityTerms(book));
  }

  // Verbose: show author groups and entity counts
  if (verboseMode) {
    console.log('  --- Author groups with entity counts ---');
    for (const [author, books] of multiBookAuthors) {
      console.log(`\n  Author: "${author}" (${books.length} books)`);
      for (const book of books) {
        const title = (book.display_title || book.title || '').substring(0, 60);
        const entities = entitySets.get(book.id);
        console.log(`    ${title.padEnd(62)} ${entities.size} entities`);
      }
    }
    console.log('');
  }

  // ------------------------------------------------------------------
  // Step 3: Pairwise Jaccard within each author group, union-find
  // ------------------------------------------------------------------

  const uf = new UnionFind();
  let pairsCompared = 0;
  let pairsMatched = 0;

  for (const [authorName, books] of multiBookAuthors) {
    for (const book of books) {
      uf.makeSet(book.id);
    }
    for (let i = 0; i < books.length; i++) {
      for (let j = i + 1; j < books.length; j++) {
        pairsCompared++;
        const setA = entitySets.get(books[i].id);
        const setB = entitySets.get(books[j].id);
        const { score, entityJaccard, titleJaccard } = combinedSimilarity(
          books[i], books[j], setA, setB
        );

        if (verboseMode) {
          const titleA = (books[i].display_title || books[i].title || '').substring(0, 30);
          const titleB = (books[j].display_title || books[j].title || '').substring(0, 30);
          let inter = 0;
          for (const item of setA) { if (setB.has(item)) inter++; }
          console.log(`    ${titleA.padEnd(32)} <-> ${titleB.padEnd(32)}  combined=${(score*100).toFixed(1)}%  (ent=${(entityJaccard*100).toFixed(1)}% tit=${(titleJaccard*100).toFixed(1)}%  ${inter} shared entities)`);
        }

        if (score >= SIMILARITY_THRESHOLD) {
          pairsMatched++;
          uf.union(books[i].id, books[j].id);
        }
      }
    }
  }

  console.log(`  Pairs compared: ${pairsCompared}`);
  console.log(`  Pairs matched (>= ${SIMILARITY_THRESHOLD}): ${pairsMatched}`);
  console.log('');

  // ------------------------------------------------------------------
  // Step 4: Extract work groups, filter, format output
  // ------------------------------------------------------------------

  // Build lookup
  const bookById = new Map();
  for (const book of booksWithIndex) {
    bookById.set(book.id, book);
  }

  const groups = uf.groups();
  const workGroups = []; // { workId, books[] }

  for (const [, memberIds] of groups) {
    if (memberIds.length < 2) continue; // skip singletons

    const members = memberIds.map(id => bookById.get(id)).filter(Boolean);
    if (members.length < 2) continue;

    // Check if all already share the same work_id
    const existingWorkIds = new Set(members.map(b => b.work_id).filter(Boolean));
    if (existingWorkIds.size === 1) {
      const allHaveIt = members.every(b => b.work_id);
      if (allHaveIt) continue; // all already tagged with the same work_id — skip
    }

    // Pick the shortest title for the slug (usually the most canonical form)
    const sortedByTitleLen = [...members].sort(
      (a, b) => ((a.display_title || a.title) || '').length - ((b.display_title || b.title) || '').length
    );
    const representative = sortedByTitleLen[0];
    const suggestedWorkId = generateWorkId(representative.author, representative.display_title || representative.title);

    // If there's already a work_id on some members, prefer the existing one
    const existingWorkId = existingWorkIds.size === 1 ? [...existingWorkIds][0] : null;
    const workId = existingWorkId || suggestedWorkId;

    // Sort members by year for display
    members.sort((a, b) => {
      const yearA = parseInt(a.published) || 9999;
      const yearB = parseInt(b.published) || 9999;
      return yearA - yearB;
    });

    workGroups.push({ workId, existingWorkId, members });
  }

  // Sort groups by size descending, then by workId
  workGroups.sort((a, b) => b.members.length - a.members.length || a.workId.localeCompare(b.workId));

  // ------------------------------------------------------------------
  // Step 5: Output
  // ------------------------------------------------------------------

  if (workGroups.length === 0) {
    console.log('  No new work groups detected.');
    await client.close();
    return;
  }

  console.log(`${'='.repeat(72)}`);
  console.log(`  PROPOSED WORK GROUPS: ${workGroups.length}`);
  console.log(`${'='.repeat(72)}`);
  console.log('');

  let totalBooksToUpdate = 0;

  for (let i = 0; i < workGroups.length; i++) {
    const group = workGroups[i];
    const booksNeedingUpdate = group.members.filter(b => b.work_id !== group.workId);
    totalBooksToUpdate += booksNeedingUpdate.length;

    const statusTag = group.existingWorkId ? '[EXTEND]' : '[NEW]';

    console.log(`  ${statusTag} work_id: "${group.workId}"  (${group.members.length} books)`);
    console.log(`  ${'─'.repeat(68)}`);

    for (const book of group.members) {
      const title = book.display_title || book.title;
      const lang = book.language || '?';
      const year = book.published || '?';
      const entityCount = entitySets.get(book.id)?.size || 0;
      const alreadyTagged = book.work_id === group.workId;
      const marker = alreadyTagged ? '  ' : '+ ';

      console.log(`    ${marker}${title}`);
      console.log(`       ${lang}, ${year}  |  ${entityCount} entities  |  id: ${book.id}${alreadyTagged ? '  [already tagged]' : ''}`);
    }

    // Show pairwise similarities within the group
    if (group.members.length <= 6) {
      console.log('');
      console.log('    Pairwise similarity:');
      for (let a = 0; a < group.members.length; a++) {
        for (let b = a + 1; b < group.members.length; b++) {
          const { score, entityJaccard, titleJaccard } = combinedSimilarity(
            group.members[a], group.members[b],
            entitySets.get(group.members[a].id),
            entitySets.get(group.members[b].id)
          );
          const titleA = (group.members[a].display_title || group.members[a].title).substring(0, 30);
          const titleB = (group.members[b].display_title || group.members[b].title).substring(0, 30);
          console.log(`      ${titleA.padEnd(32)} <-> ${titleB.padEnd(32)}  ${(score * 100).toFixed(1)}% (ent=${(entityJaccard*100).toFixed(0)}% tit=${(titleJaccard*100).toFixed(0)}%)`);
        }
      }
    }
    console.log('');
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------

  console.log('='.repeat(72));
  console.log(`  SUMMARY`);
  console.log('='.repeat(72));
  console.log(`  Work groups found:     ${workGroups.length}`);
  console.log(`  Books in groups:       ${workGroups.reduce((s, g) => s + g.members.length, 0)}`);
  console.log(`  Books needing update:  ${totalBooksToUpdate}`);
  console.log('');

  // ------------------------------------------------------------------
  // Step 6: Apply (if --apply)
  // ------------------------------------------------------------------

  if (applyMode) {
    console.log('  Applying work_id updates...');
    console.log('');

    let updated = 0;
    let skipped = 0;

    for (const group of workGroups) {
      for (const book of group.members) {
        if (book.work_id === group.workId) {
          skipped++;
          continue;
        }

        const result = await booksCol.updateOne(
          { id: book.id },
          { $set: { work_id: group.workId } }
        );

        if (result.modifiedCount > 0) {
          const title = (book.display_title || book.title).substring(0, 50);
          console.log(`    [SET] ${title} -> "${group.workId}"`);
          updated++;
        } else {
          // Try _id fallback
          const result2 = await booksCol.updateOne(
            { _id: book._id },
            { $set: { work_id: group.workId } }
          );
          if (result2.modifiedCount > 0) {
            const title = (book.display_title || book.title).substring(0, 50);
            console.log(`    [SET] ${title} -> "${group.workId}"`);
            updated++;
          } else {
            console.log(`    [FAIL] Could not update ${book.id}`);
          }
        }
      }
    }

    // Ensure sparse index on work_id
    await booksCol.createIndex({ work_id: 1 }, { sparse: true });

    console.log('');
    console.log(`  Updated: ${updated}  |  Already tagged: ${skipped}`);
  } else {
    console.log('  This was a dry run. To apply changes:');
    console.log('    secret-lover run -- node scripts/backfill-work-ids.mjs --apply');
  }

  console.log('');
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
