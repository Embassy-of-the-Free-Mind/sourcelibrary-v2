#!/usr/bin/env node
/**
 * Backfill author birth/death locations from the CANONICAL `authors` thesaurus.
 *
 * WHY THIS EXISTS
 * ---------------
 * The /explore/map location pipeline (backfill-author-locations.mjs) reads the
 * LEGACY `entities` collection via `books.author_entity_id`, and gets there by
 * name-matching author strings to Wikidata — which occasionally grabs the wrong
 * same-name person (see lesson_author_grounding_wrong_famous_person).
 *
 * The canonical `authors` thesaurus already did that identity work safely:
 * ~3,325 authors carry a *grounded* `wikidata_id` (VIAF/Wikidata-anchored,
 * incl. the PR #2630 wrong-famous-person fixes). This script leans on those
 * vetted QIDs instead of re-guessing:
 *   1. Read authors with a wikidata_id but no birth_place.
 *   2. Batch-query Wikidata P19/P20 for birth/death place coordinates.
 *   3. Write birth_place/death_place onto the authors doc (the thesaurus had 0).
 *   4. With --write-books, push author_birth/author_death locations to books
 *      via `books.author_id`, skipping any book that already has an author dot
 *      (so it never double-writes alongside the entities path).
 *
 * No name-matching happens here — identity is taken as given from the
 * thesaurus — so there is no wrong-person risk beyond whatever is already in
 * the thesaurus.
 *
 * Reversible:
 *   db.books.updateMany({}, { $pull: { locations: { source: 'wikidata-thesaurus' } } })
 *   db.authors.updateMany({}, { $unset: { birth_place: '', death_place: '' } })
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/enrichment/backfill-thesaurus-author-locations.mjs [--dry-run] [--write-books] [--limit N]
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const WRITE_BOOKS = process.argv.includes('--write-books');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 0;

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

/** Batch-query Wikidata SPARQL for birth/death places of multiple QIDs. */
async function fetchAuthorLocations(wikidataIds) {
  const values = wikidataIds.map(id => `wd:${id}`).join(' ');
  const sparql = `
    SELECT ?item ?birthPlaceLabel ?birthLat ?birthLon ?birthPlaceCountryLabel
           ?deathPlaceLabel ?deathLat ?deathLon ?deathPlaceCountryLabel WHERE {
      VALUES ?item { ${values} }
      OPTIONAL {
        ?item wdt:P19 ?birthPlace .
        ?birthPlace wdt:P625 ?birthCoord .
        ?birthPlace wdt:P17 ?birthPlaceCountry .
        BIND(geof:latitude(?birthCoord) AS ?birthLat)
        BIND(geof:longitude(?birthCoord) AS ?birthLon)
      }
      OPTIONAL {
        ?item wdt:P20 ?deathPlace .
        ?deathPlace wdt:P625 ?deathCoord .
        ?deathPlace wdt:P17 ?deathPlaceCountry .
        BIND(geof:latitude(?deathCoord) AS ?deathLat)
        BIND(geof:longitude(?deathCoord) AS ?deathLon)
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
  `;
  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { 'User-Agent': USER_AGENT } },
    );
    if (!res.ok) {
      console.error(`  SPARQL error: ${res.status} ${res.statusText}`);
      return new Map();
    }
    const data = await res.json();
    const byEntity = new Map();
    for (const row of data.results?.bindings || []) {
      const id = row.item?.value?.split('/').pop();
      if (!id) continue;
      if (!byEntity.has(id)) byEntity.set(id, { birth: null, death: null });
      const entry = byEntity.get(id);
      if (row.birthLat && row.birthLon && !entry.birth) {
        entry.birth = {
          city: row.birthPlaceLabel?.value || null,
          lat: parseFloat(row.birthLat.value),
          lng: parseFloat(row.birthLon.value),
          country: row.birthPlaceCountryLabel?.value || null,
        };
      }
      if (row.deathLat && row.deathLon && !entry.death) {
        entry.death = {
          city: row.deathPlaceLabel?.value || null,
          lat: parseFloat(row.deathLat.value),
          lng: parseFloat(row.deathLon.value),
          country: row.deathPlaceCountryLabel?.value || null,
        };
      }
    }
    return byEntity;
  } catch (err) {
    console.error(`  SPARQL fetch error: ${err.message}`);
    return new Map();
  }
}

async function main() {
  console.log(`Thesaurus Author Locations — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${WRITE_BOOKS ? ' + WRITE BOOKS' : ''}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Step 1: canonical authors with a grounded wikidata_id but no birth_place yet
  const query = { wikidata_id: { $exists: true, $ne: null }, birth_place: { $exists: false } };
  const total = await db.collection('authors').countDocuments(query);
  console.log(`${total} thesaurus authors with wikidata_id and no birth_place`);

  const cursor = db.collection('authors').find(query, { projection: { _id: 1, wikidata_id: 1, display_name: 1, name: 1 } });
  if (LIMIT > 0) cursor.limit(LIMIT);
  const authors = await cursor.toArray();
  console.log(`Processing ${authors.length}\n`);

  // Step 2: batch Wikidata (50 at a time), write birth_place/death_place to authors
  let enriched = 0, noData = 0;
  for (let i = 0; i < authors.length; i += 50) {
    const batch = authors.slice(i, i + 50);
    if (i > 0 && i % 500 === 0) console.log(`  ${i}/${authors.length}...`);
    const results = await fetchAuthorLocations(batch.map(a => a.wikidata_id));

    for (const author of batch) {
      const data = results.get(author.wikidata_id);
      if (!data || (!data.birth && !data.death)) { noData++; continue; }
      const update = {};
      if (data.birth) update.birth_place = data.birth;
      if (data.death) update.death_place = data.death;
      if (DRY_RUN) {
        const nm = author.display_name || author.name || author._id;
        const b = data.birth ? `born ${data.birth.city}` : '';
        const d = data.death ? `died ${data.death.city}` : '';
        console.log(`  ${nm} [${author.wikidata_id}] — ${[b, d].filter(Boolean).join(' | ')}`);
      } else {
        await db.collection('authors').updateOne({ _id: author._id }, { $set: update });
      }
      enriched++;
    }
    if (i + 50 < authors.length) await new Promise(r => setTimeout(r, 1500));
  }
  console.log(`\nAuthors enriched: ${enriched}, No place in Wikidata: ${noData}`);

  // Step 3: push author locations to books via author_id (skip books that already have an author dot)
  if (WRITE_BOOKS && !DRY_RUN) {
    console.log('\nWriting author locations to books via author_id...');
    const located = await db.collection('authors')
      .find({ birth_place: { $exists: true } }, { projection: { _id: 1, birth_place: 1, death_place: 1 } })
      .toArray();
    console.log(`${located.length} thesaurus authors now have a place`);

    let booksUpdated = 0;
    for (const author of located) {
      const locations = [];
      if (author.birth_place?.lat) locations.push({
        type: 'author_birth', city: author.birth_place.city, country: author.birth_place.country,
        lat: author.birth_place.lat, lng: author.birth_place.lng,
        source: 'wikidata-thesaurus', confidence: 'high',
      });
      if (author.death_place?.lat) locations.push({
        type: 'author_death', city: author.death_place.city, country: author.death_place.country,
        lat: author.death_place.lat, lng: author.death_place.lng,
        source: 'wikidata-thesaurus', confidence: 'high',
      });
      if (!locations.length) continue;

      const result = await db.collection('books').updateMany(
        { author_id: author._id, visible: true, 'locations.type': { $nin: ['author_birth', 'author_death'] } },
        { $push: { locations: { $each: locations } } },
      );
      booksUpdated += result.modifiedCount;
    }
    console.log(`Updated ${booksUpdated} books with author locations`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Done.');
  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
