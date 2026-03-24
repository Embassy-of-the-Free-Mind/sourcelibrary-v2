#!/usr/bin/env node

/**
 * Author Normalization via VIAF + Wikidata
 *
 * Links book authors to authority records. For each distinct book.author:
 *   1. Query VIAF AutoSuggest for best personal name match
 *   2. Use the VIAF ID to find the Wikidata entity (P214 reverse lookup)
 *   3. Fetch Wikidata aliases, labels, birth/death dates, LCNAF ID
 *   4. Upsert into entities collection with authority IDs
 *   5. Set author_entity_id on all matching books
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/viaf-author-linking.mjs
 *
 * Options:
 *   --limit=N        Max authors to process (default: unlimited)
 *   --dry-run        Show matches without writing
 *   --min-books=N    Skip authors with fewer than N books (default: 1)
 *   --offset=N       Skip first N authors
 *   --skip-viaf      Skip VIAF, go straight to Wikidata search (for names VIAF misses)
 */

import { MongoClient } from 'mongodb';

// --- Config ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const LIMIT = args.limit ? parseInt(args.limit) : Infinity;
const DRY_RUN = args['dry-run'] === 'true';
const MIN_BOOKS = parseInt(args['min-books'] || '1');
const OFFSET = parseInt(args.offset || '0');
const SKIP_VIAF = args['skip-viaf'] === 'true';

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';
const DELAY_MS = 400; // polite rate limit

const ANON_PATTERNS = /^(unknown|anonymous|various|\[s\.n\.\]|anon\.?|none|n\/a)$/i;

// --- API helpers ---

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function apiFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

/**
 * VIAF AutoSuggest — returns array of {term, viafid, nametype, lc, score, ...}
 */
async function viafAutoSuggest(query) {
  try {
    const data = await apiFetch(
      `https://viaf.org/viaf/AutoSuggest?query=${encodeURIComponent(query)}`
    );
    return (data?.result || []).filter(r => r.nametype === 'personal');
  } catch {
    return [];
  }
}

/**
 * Find Wikidata entity by VIAF ID (P214 reverse lookup).
 */
async function wikidataByViaf(viafId) {
  const sparqlUrl = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(
    `SELECT ?item WHERE { ?item wdt:P214 "${viafId}" } LIMIT 1`
  )}`;
  try {
    const data = await apiFetch(sparqlUrl);
    const bindings = data?.results?.bindings || [];
    if (bindings.length === 0) return null;
    const uri = bindings[0].item.value; // http://www.wikidata.org/entity/Q192374
    return uri.split('/').pop();
  } catch {
    return null;
  }
}

/**
 * Search Wikidata directly by name.
 */
async function wikidataSearch(name) {
  const data = await apiFetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json`
  );
  // Filter to human entities by checking description for person-like indicators
  const results = data?.search || [];
  return results.filter(r => {
    const desc = (r.description || '').toLowerCase();
    return desc.includes('philosopher') || desc.includes('writer') || desc.includes('author')
      || desc.includes('priest') || desc.includes('alchemist') || desc.includes('physician')
      || desc.includes('mathematician') || desc.includes('theologian') || desc.includes('poet')
      || desc.includes('scientist') || desc.includes('painter') || desc.includes('artist')
      || desc.includes('humanist') || desc.includes('mystic') || desc.includes('scholar')
      || desc.includes('monk') || desc.includes('rabbi') || desc.includes('astrologer')
      || desc.includes('historian') || desc.includes('translator') || desc.includes('engraver')
      || /\(\d{4}/.test(desc) || /\d{2}(th|st|nd|rd).century/.test(desc)
      || desc.includes('century') || /\d{3,4}\s*[–-]\s*\d{3,4}/.test(desc);
  });
}

/**
 * Fetch full Wikidata entity: labels, aliases, birth/death, VIAF, LCNAF.
 */
async function wikidataEntity(qid) {
  const data = await apiFetch(
    `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|aliases|claims|descriptions&languages=en|la|de|fr|it|nl|es|pt|el|ar|he|zh|ja&format=json`
  );
  const entity = data?.entities?.[qid];
  if (!entity) return null;

  // Labels from all languages
  const labels = Object.values(entity.labels || {}).map(l => l.value);

  // Aliases from all languages
  const aliases = [];
  for (const items of Object.values(entity.aliases || {})) {
    for (const item of items) {
      aliases.push(item.value);
    }
  }

  // Merge and deduplicate
  const allNames = [...new Set([...labels, ...aliases])].filter(n => n.length > 1 && n.length < 200);

  // Birth/death dates (P569, P570)
  const birthClaim = entity.claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time;
  const deathClaim = entity.claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time;
  const birthYear = birthClaim ? parseInt(birthClaim.replace(/^\+/, '').split('-')[0]) : null;
  const deathYear = deathClaim ? parseInt(deathClaim.replace(/^\+/, '').split('-')[0]) : null;

  // Authority IDs
  const viafId = entity.claims?.P214?.[0]?.mainsnak?.datavalue?.value || null;
  const lcnafId = entity.claims?.P244?.[0]?.mainsnak?.datavalue?.value || null;
  const gndId = entity.claims?.P227?.[0]?.mainsnak?.datavalue?.value || null;

  // Description
  const description = entity.descriptions?.en?.value || null;

  // Canonical name: English label
  const canonicalName = entity.labels?.en?.value || labels[0] || null;

  return {
    qid,
    canonicalName,
    description,
    allNames,
    birthYear,
    deathYear,
    viafId,
    lcnafId,
    gndId,
    birthDate: birthClaim ? birthClaim.replace(/^\+/, '').split('T')[0] : null,
    deathDate: deathClaim ? deathClaim.replace(/^\+/, '').split('T')[0] : null,
  };
}

/**
 * Score how well a VIAF result matches our author name.
 */
function scoreViafMatch(result, authorName) {
  let score = 0;
  const resultName = (result.term || '').toLowerCase();
  const query = authorName.toLowerCase();

  // Exact match
  if (resultName === query) score += 100;
  // Name contained
  else if (resultName.includes(query) || query.includes(resultName.split(',')[0]?.trim())) score += 30;
  // First word matches (surname match)
  else if (resultName.split(/[\s,]/)[0] === query.split(/[\s,]/)[0]) score += 20;

  // Boost well-sourced records
  const sourceCount = parseInt(result.score || '0');
  if (sourceCount > 100) score += 15;
  else if (sourceCount > 10) score += 5;

  return score;
}

/**
 * Clean name: strip trailing dates, commas, periods.
 */
function cleanName(raw) {
  return raw
    .replace(/,?\s*\d{4}\??\s*-\s*\d{0,4}\??\s*$/, '')
    .replace(/,?\s*\d{4}\??\s*$/, '')
    .replace(/\.$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// --- Main ---

async function main() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  console.log('=== Author Normalization (VIAF + Wikidata) ===\n');

  // Step 1: Get distinct authors with book counts
  console.log('Step 1: Loading distinct authors...');
  const authorGroups = await db.collection('books').aggregate([
    { $match: { hidden: { $ne: true } } },
    { $group: {
      _id: '$author',
      count: { $sum: 1 },
      book_ids: { $push: '$id' },
    }},
    { $match: { count: { $gte: MIN_BOOKS } } },
    { $sort: { count: -1 } },
  ]).toArray();

  // Filter out anonymous + empty + multi-author with semicolons
  let authors = authorGroups.filter(a =>
    a._id && a._id.trim().length > 1 && !ANON_PATTERNS.test(a._id.trim())
  );

  console.log(`  ${authorGroups.length} author strings (>= ${MIN_BOOKS} books)`);
  console.log(`  ${authors.length} after filtering`);

  // Check which are already linked
  const alreadyLinked = await db.collection('books').distinct('author', {
    author_entity_id: { $exists: true, $ne: null },
    hidden: { $ne: true },
  });
  const alreadyLinkedSet = new Set(alreadyLinked);
  const unlinked = authors.filter(a => !alreadyLinkedSet.has(a._id));
  console.log(`  ${alreadyLinkedSet.size} already linked, ${unlinked.length} remaining`);

  const slice = unlinked.slice(OFFSET, OFFSET + LIMIT);
  console.log(`  Processing ${slice.length} (offset ${OFFSET})\n`);

  // Step 2-4: Match each author
  let matched = 0;
  let skipped = 0;
  let failed = 0;
  const results = [];

  for (let i = 0; i < slice.length; i++) {
    const authorGroup = slice[i];
    const authorName = authorGroup._id;
    const bookCount = authorGroup.count;

    // Skip CJK names — Wikidata coverage is poor, we'd need a different approach
    if (/[\u4e00-\u9fff\u3040-\u30ff\u3400-\u4dbf]/.test(authorName)) {
      console.log(`  [${i+1}/${slice.length}] SKIP CJK: ${authorName} (${bookCount} books)`);
      skipped++;
      continue;
    }

    // Skip clearly not personal names
    if (/^\[/.test(authorName) || authorName.length > 100) {
      console.log(`  [${i+1}/${slice.length}] SKIP: ${authorName}`);
      skipped++;
      continue;
    }

    // Multi-author: split on semicolons, process first author only
    const primaryAuthor = authorName.includes(';')
      ? authorName.split(';')[0].trim()
      : authorName;

    try {
      let qid = null;
      let viafResult = null;

      // Strategy A: VIAF AutoSuggest → Wikidata via VIAF ID
      if (!SKIP_VIAF) {
        const suggestions = await viafAutoSuggest(primaryAuthor);
        if (suggestions.length > 0) {
          // Score and pick best
          const scored = suggestions
            .map(s => ({ ...s, matchScore: scoreViafMatch(s, primaryAuthor) }))
            .sort((a, b) => b.matchScore - a.matchScore);

          if (scored[0].matchScore >= 20) {
            viafResult = scored[0];
            await sleep(DELAY_MS);
            qid = await wikidataByViaf(viafResult.viafid);
          }
        }
        await sleep(DELAY_MS);
      }

      // Strategy B: Direct Wikidata search (fallback or if VIAF skipped)
      if (!qid) {
        const wdResults = await wikidataSearch(primaryAuthor);
        if (wdResults.length > 0) {
          // Pick the best match — prefer exact label match
          const exact = wdResults.find(r =>
            r.label.toLowerCase() === primaryAuthor.toLowerCase()
            || r.label.toLowerCase() === cleanName(primaryAuthor).toLowerCase()
          );
          qid = exact ? exact.id : wdResults[0].id;
        }
        await sleep(DELAY_MS);
      }

      if (!qid) {
        console.log(`  [${i+1}/${slice.length}] NO MATCH: ${authorName} (${bookCount} books)`);
        failed++;
        continue;
      }

      // Fetch full Wikidata entity
      const wd = await wikidataEntity(qid);
      if (!wd || !wd.canonicalName) {
        console.log(`  [${i+1}/${slice.length}] WD FETCH FAIL: ${authorName} → ${qid}`);
        failed++;
        await sleep(DELAY_MS);
        continue;
      }

      const result = {
        authorName,
        primaryAuthor,
        bookCount,
        bookIds: authorGroup.book_ids,
        qid: wd.qid,
        viafId: wd.viafId || viafResult?.viafid || null,
        lcnafId: wd.lcnafId || viafResult?.lc || null,
        gndId: wd.gndId,
        canonicalName: wd.canonicalName,
        description: wd.description,
        aliases: wd.allNames,
        birthYear: wd.birthYear,
        deathYear: wd.deathYear,
        birthDate: wd.birthDate,
        deathDate: wd.deathDate,
      };
      results.push(result);
      matched++;

      const dateStr = wd.birthYear ? ` (${wd.birthYear}–${wd.deathYear || '?'})` : '';
      console.log(`  [${i+1}/${slice.length}] MATCH: ${authorName} → ${wd.canonicalName}${dateStr} [${qid}] (${wd.allNames.length} names)`);

    } catch (err) {
      console.error(`  [${i+1}/${slice.length}] ERROR: ${authorName}: ${err.message}`);
      failed++;
    }

    await sleep(DELAY_MS);
  }

  console.log(`\n=== Results ===`);
  console.log(`  Matched: ${matched}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed:  ${failed}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No database writes. Sample results:');
    for (const r of results.slice(0, 15)) {
      const dateStr = r.birthYear ? ` (${r.birthYear}–${r.deathYear || '?'})` : '';
      console.log(`\n  "${r.authorName}" (${r.bookCount} books)`);
      console.log(`    → ${r.canonicalName}${dateStr}`);
      console.log(`    QID: ${r.qid}, VIAF: ${r.viafId || 'none'}, LCNAF: ${r.lcnafId || 'none'}`);
      console.log(`    Names: ${r.aliases.slice(0, 6).join(', ')}${r.aliases.length > 6 ? ` (+${r.aliases.length - 6})` : ''}`);
    }
    await client.close();
    return;
  }

  // Step 5: Write to database
  console.log('\nStep 5: Writing to database...');

  let entitiesCreated = 0;
  let entitiesUpdated = 0;
  let booksLinked = 0;

  for (const r of results) {
    // Find existing entity: by wikidata_id, viaf_id, or name match
    const orClauses = [
      { type: 'person', wikidata_id: r.qid },
    ];
    if (r.viafId) orClauses.push({ type: 'person', viaf_id: r.viafId });
    orClauses.push({ type: 'person', name: r.canonicalName });
    orClauses.push({ type: 'person', name: r.authorName });

    const existingEntity = await db.collection('entities').findOne({ $or: orClauses });

    let entityId;
    if (existingEntity) {
      // Merge: keep existing data, add new authority IDs and aliases
      const existingAliases = existingEntity.aliases || [];
      const mergedAliases = [...new Set([...existingAliases, ...r.aliases])];

      const updateFields = {
        canonical_name: r.canonicalName,
        aliases: mergedAliases,
        updated_at: new Date(),
      };
      // Only set if not already present (don't overwrite manual data)
      if (!existingEntity.wikidata_id) updateFields.wikidata_id = r.qid;
      if (!existingEntity.viaf_id && r.viafId) updateFields.viaf_id = r.viafId;
      if (!existingEntity.lcnaf_id && r.lcnafId) updateFields.lcnaf_id = r.lcnafId;
      if (!existingEntity.gnd_id && r.gndId) updateFields.gnd_id = r.gndId;
      if (!existingEntity.wikidata_birth_date && r.birthDate) updateFields.wikidata_birth_date = r.birthDate;
      if (!existingEntity.wikidata_death_date && r.deathDate) updateFields.wikidata_death_date = r.deathDate;
      if (!existingEntity.description && r.description) updateFields.description = r.description;

      await db.collection('entities').updateOne(
        { _id: existingEntity._id },
        { $set: updateFields }
      );
      entityId = existingEntity._id;
      entitiesUpdated++;
    } else {
      // Create new entity
      const doc = {
        name: r.canonicalName,
        type: 'person',
        canonical_name: r.canonicalName,
        aliases: r.aliases,
        description: r.description,
        wikidata_id: r.qid,
        viaf_id: r.viafId || undefined,
        lcnaf_id: r.lcnafId || undefined,
        gnd_id: r.gndId || undefined,
        wikidata_birth_date: r.birthDate || undefined,
        wikidata_death_date: r.deathDate || undefined,
        books: [],
        total_mentions: 0,
        book_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      };
      // Clean undefined fields
      Object.keys(doc).forEach(k => doc[k] === undefined && delete doc[k]);
      const inserted = await db.collection('entities').insertOne(doc);
      entityId = inserted.insertedId;
      entitiesCreated++;
    }

    // Link books → entity
    const linkResult = await db.collection('books').updateMany(
      { id: { $in: r.bookIds } },
      { $set: { author_entity_id: entityId.toString() } }
    );
    booksLinked += linkResult.modifiedCount;
  }

  // Step 6: Cross-link — find books whose author matches any alias but isn't yet linked
  console.log('\nStep 6: Cross-linking alias matches...');
  let crossLinked = 0;

  for (const r of results) {
    const allNames = [r.canonicalName, r.authorName, ...r.aliases];
    // Build case-insensitive regexes
    const regexes = allNames
      .filter(n => n && n.length > 2)
      .slice(0, 50) // cap to avoid huge $in
      .map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));

    if (regexes.length === 0) continue;

    const unlinkedBooks = await db.collection('books').find({
      author: { $in: regexes },
      author_entity_id: { $exists: false },
      hidden: { $ne: true },
    }, { projection: { id: 1, author: 1 } }).toArray();

    if (unlinkedBooks.length > 0) {
      const entity = await db.collection('entities').findOne({
        $or: [
          { wikidata_id: r.qid },
          ...(r.viafId ? [{ viaf_id: r.viafId }] : []),
        ]
      });
      if (entity) {
        const ids = unlinkedBooks.map(b => b.id);
        await db.collection('books').updateMany(
          { id: { $in: ids } },
          { $set: { author_entity_id: entity._id.toString() } }
        );
        crossLinked += unlinkedBooks.length;
        if (unlinkedBooks.length > 0) {
          console.log(`  Cross-linked ${unlinkedBooks.length} books for ${r.canonicalName} (aliases: ${unlinkedBooks.map(b => b.author).filter((v, i, a) => a.indexOf(v) === i).join(', ')})`);
        }
      }
    }
  }

  console.log(`\n=== Database Writes ===`);
  console.log(`  Entities created: ${entitiesCreated}`);
  console.log(`  Entities updated: ${entitiesUpdated}`);
  console.log(`  Books linked (direct): ${booksLinked}`);
  console.log(`  Books linked (cross):  ${crossLinked}`);
  console.log(`  Total books linked:    ${booksLinked + crossLinked}`);

  await client.close();
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
