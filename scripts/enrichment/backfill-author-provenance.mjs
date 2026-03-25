#!/usr/bin/env node
/**
 * Backfill provenance for existing author_entity_id links.
 *
 * The VIAF author linking script (PR #346) wrote author_entity_id on ~2,700 books
 * without recording HOW the match was made. This script retroactively classifies
 * each link's confidence and records field_provenance.
 *
 * Also fixes: author_entity_id was stored as string, should be ObjectId for $lookup.
 *
 * Confidence classification:
 *   HIGH   — entity has VIAF ID + raw author name is exact/close match to canonical
 *   MEDIUM — entity has Wikidata ID + name partially matches
 *   LOW    — name match only, no authority IDs, or weak string similarity
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-author-provenance.mjs
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-author-provenance.mjs --dry-run
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-author-provenance.mjs --limit=50
 */

import { MongoClient, ObjectId } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1); }

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);
const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit) : 0;

/**
 * Normalize a name for comparison: lowercase, strip dates, strip accents.
 */
function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip accents
    .replace(/,?\s*\d{4}\??\s*[-–]\s*\d{0,4}\??\s*$/, '') // trailing dates
    .replace(/,?\s*\d{4}\??\s*$/, '') // single year
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Score how well the raw author matches the entity.
 * Returns { score: number, method: string }
 */
function classifyMatch(rawAuthor, entity) {
  const rawNorm = normalizeName(rawAuthor);
  const canonNorm = normalizeName(entity.canonical_name);
  const aliases = (entity.aliases || []).map(normalizeName);

  // Check exact match against canonical or any alias
  if (rawNorm === canonNorm || aliases.includes(rawNorm)) {
    return { method: 'exact_name', score: 100 };
  }

  // Check if canonical or alias contains the raw name (or vice versa)
  const rawSurname = rawNorm.split(/[\s,]/)[0];
  const canonSurname = canonNorm.split(/[\s,]/)[0];

  if (rawNorm.includes(canonSurname) && canonNorm.includes(rawSurname)) {
    return { method: 'name_overlap', score: 70 };
  }

  // Check if any alias contains the raw surname
  if (aliases.some(a => a.includes(rawSurname) || rawSurname.includes(a.split(/[\s,]/)[0]))) {
    return { method: 'alias_surname', score: 50 };
  }

  // Surname-only match
  if (rawSurname === canonSurname) {
    return { method: 'surname_only', score: 30 };
  }

  // Very weak — linked but names don't obviously match
  return { method: 'weak_link', score: 10 };
}

/**
 * Determine confidence from score + authority ID availability.
 */
function determineConfidence(score, entity) {
  const hasViaf = !!entity.viaf_id;
  const hasWikidata = !!entity.wikidata_id;
  const hasDates = !!entity.wikidata_birth_date;

  if (score >= 70 && hasViaf) return 'high';
  if (score >= 70 && hasWikidata && hasDates) return 'high';
  if (score >= 50 && (hasViaf || hasWikidata)) return 'medium';
  if (score >= 70) return 'medium'; // good name match but no authority
  if (hasViaf || hasWikidata) return 'medium'; // authority but weak name
  return 'low';
}

async function main() {
  const client = await MongoClient.connect(MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Author Link Provenance Backfill ===\n');
  if (DRY_RUN) console.log('[DRY RUN]\n');

  // Step 1: Find all books with author_entity_id
  const query = {
    author_entity_id: { $exists: true, $ne: null },
    hidden: { $ne: true },
  };

  const totalLinked = await db.collection('books').countDocuments(query);
  console.log(`Books with author_entity_id: ${totalLinked}`);

  // Check how many already have provenance
  const alreadyProv = await db.collection('books').countDocuments({
    ...query,
    'field_provenance.author_entity_id': { $exists: true },
  });
  console.log(`Already have provenance: ${alreadyProv}`);
  console.log(`Need backfill: ${totalLinked - alreadyProv}\n`);

  const pipeline = [
    { $match: { ...query, 'field_provenance.author_entity_id': { $exists: false } } },
    { $project: { id: 1, author: 1, author_entity_id: 1, field_provenance: 1, title: 1 } },
    { $sort: { _id: 1 } },
  ];
  if (LIMIT) pipeline.push({ $limit: LIMIT });

  const books = await db.collection('books').aggregate(pipeline).toArray();
  console.log(`Processing: ${books.length}\n`);

  // Cache entities to avoid re-fetching
  const entityCache = new Map();

  async function getEntity(entityId) {
    const key = entityId.toString();
    if (entityCache.has(key)) return entityCache.get(key);

    // Try as ObjectId first, then as string _id
    let entity = await db.collection('entities').findOne({ _id: new ObjectId(key) });
    if (!entity) {
      entity = await db.collection('entities').findOne({ _id: key });
    }
    entityCache.set(key, entity);
    return entity;
  }

  const stats = { high: 0, medium: 0, low: 0, orphaned: 0, fixed_type: 0 };
  const lowConfidence = [];

  for (let i = 0; i < books.length; i++) {
    const book = books[i];
    const entity = await getEntity(book.author_entity_id);

    if (!entity) {
      console.log(`  [${i+1}] ORPHAN: "${book.author}" → entity ${book.author_entity_id} NOT FOUND`);
      stats.orphaned++;
      continue;
    }

    const { method, score } = classifyMatch(book.author, entity);
    const confidence = determineConfidence(score, entity);
    stats[confidence]++;

    const now = new Date();
    const authorProv = {
      source: 'viaf_authority',
      match_method: method,
      match_score: score,
      confidence,
      viaf_id: entity.viaf_id || null,
      wikidata_id: entity.wikidata_id || null,
      canonical_name: entity.canonical_name,
      date: now.toISOString(),
      backfill: true, // flag that this was retroactively classified, not recorded at match time
    };

    // Also fix the string→ObjectId type issue
    const entityOid = new ObjectId(book.author_entity_id.toString());
    const needsTypeFix = typeof book.author_entity_id === 'string';
    if (needsTypeFix) stats.fixed_type++;

    if (!DRY_RUN) {
      // Use dot-notation $set to avoid overwriting other provenance fields
      const update = {
        $set: {
          'field_provenance.author_entity_id': authorProv,
        },
      };
      if (needsTypeFix) {
        update.$set.author_entity_id = entityOid;
      }
      await db.collection('books').updateOne({ _id: book._id }, update);
    }

    if (confidence === 'low') {
      lowConfidence.push({
        author: book.author,
        canonical: entity.canonical_name,
        method,
        score,
        viaf: !!entity.viaf_id,
        title: book.title,
      });
    }

    if (confidence !== 'high' || i % 100 === 0) {
      const sym = confidence === 'high' ? '+' : confidence === 'medium' ? '~' : '!';
      console.log(`  [${i+1}] ${sym} ${confidence.toUpperCase()} (${method}, ${score}): "${book.author}" → ${entity.canonical_name}`);
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  High confidence:   ${stats.high}`);
  console.log(`  Medium confidence: ${stats.medium}`);
  console.log(`  Low confidence:    ${stats.low}`);
  console.log(`  Orphaned links:    ${stats.orphaned}`);
  console.log(`  ObjectId type fix: ${stats.fixed_type}`);

  if (lowConfidence.length > 0) {
    console.log(`\n=== LOW CONFIDENCE LINKS (need review) ===`);
    for (const lc of lowConfidence.slice(0, 30)) {
      console.log(`  "${lc.author}" → ${lc.canonical} [${lc.method}, score=${lc.score}, viaf=${lc.viaf}]`);
      console.log(`    Book: ${lc.title}`);
    }
    if (lowConfidence.length > 30) {
      console.log(`  ... and ${lowConfidence.length - 30} more`);
    }
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
