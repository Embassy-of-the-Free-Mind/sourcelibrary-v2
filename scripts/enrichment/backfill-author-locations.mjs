#!/usr/bin/env node
/**
 * Backfill author birth/death locations from Wikidata P19/P20.
 *
 * 1. Find person entities with wikidata_id but no birth_place/death_place
 * 2. Query Wikidata for P19 (birthplace) and P20 (deathplace) with coordinates
 * 3. Write birth_place/death_place to entities
 * 4. Add author_birth/author_death locations to books via author_entity_id
 *
 * Usage:
 *   node scripts/enrichment/backfill-author-locations.mjs [--dry-run] [--limit N] [--write-books]
 *
 * GitHub issue: #724
 */

import { MongoClient, ObjectId } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const WRITE_BOOKS = process.argv.includes('--write-books');
const LIMIT_ARG = process.argv.indexOf('--limit');
const LIMIT = LIMIT_ARG > -1 ? parseInt(process.argv[LIMIT_ARG + 1]) : 0;

/** Batch query Wikidata SPARQL for birth/death places of multiple entities */
async function fetchAuthorLocations(wikidataIds) {
  // Build VALUES clause for batch lookup
  const values = wikidataIds.map(id => `wd:${id}`).join(' ');
  const sparql = `
    SELECT ?item ?birthPlaceLabel ?birthLat ?birthLon ?birthPlaceCountryLabel
           ?deathPlaceLabel ?deathLat ?deathLon ?deathPlaceCountryLabel
           ?workPlaceLabel ?workLat ?workLon ?workPlaceCountryLabel WHERE {
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
      OPTIONAL {
        ?item wdt:P937 ?workPlace .
        ?workPlace wdt:P625 ?workCoord .
        ?workPlace wdt:P17 ?workPlaceCountry .
        BIND(geof:latitude(?workCoord) AS ?workLat)
        BIND(geof:longitude(?workCoord) AS ?workLon)
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
  `;

  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' } }
    );
    if (!res.ok) {
      console.error(`  SPARQL error: ${res.status} ${res.statusText}`);
      return new Map();
    }
    const data = await res.json();

    // Group results by entity
    const byEntity = new Map();
    for (const row of data.results?.bindings || []) {
      const id = row.item?.value?.split('/').pop();
      if (!id) continue;

      if (!byEntity.has(id)) byEntity.set(id, { birth: null, death: null, work: [] });
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
      if (row.workLat && row.workLon) {
        const workCity = row.workPlaceLabel?.value;
        if (workCity && !entry.work.some(w => w.city === workCity)) {
          entry.work.push({
            city: workCity,
            lat: parseFloat(row.workLat.value),
            lng: parseFloat(row.workLon.value),
            country: row.workPlaceCountryLabel?.value || null,
          });
        }
      }
    }
    return byEntity;
  } catch (err) {
    console.error(`  SPARQL fetch error: ${err.message}`);
    return new Map();
  }
}

async function main() {
  console.log(`Author Locations Backfill — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}${WRITE_BOOKS ? ' + WRITE BOOKS' : ''}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Step 1: Find entities with Wikidata IDs but no birth_place
  const query = {
    type: 'person',
    wikidata_id: { $exists: true, $ne: null },
    birth_place: { $exists: false },
  };
  const totalEligible = await db.collection('entities').countDocuments(query);
  console.log(`${totalEligible} entities with Wikidata ID and no birth_place`);

  const cursor = db.collection('entities').find(query, {
    projection: { name: 1, wikidata_id: 1 },
  });
  if (LIMIT > 0) cursor.limit(LIMIT);

  const entities = await cursor.toArray();
  console.log(`Processing ${entities.length} entities\n`);

  // Step 2: Batch query Wikidata (50 at a time to avoid query timeouts)
  let enriched = 0;
  let noData = 0;

  for (let i = 0; i < entities.length; i += 50) {
    const batch = entities.slice(i, i + 50);
    if (i > 0) console.log(`  ${i}/${entities.length}...`);

    const wikidataIds = batch.map(e => e.wikidata_id);
    const results = await fetchAuthorLocations(wikidataIds);

    for (const entity of batch) {
      const data = results.get(entity.wikidata_id);
      if (!data || (!data.birth && !data.death)) {
        noData++;
        continue;
      }

      const update = {};
      if (data.birth) {
        update.birth_place = data.birth;
      }
      if (data.death) {
        update.death_place = data.death;
      }
      if (data.work.length > 0) {
        update.work_places = data.work.slice(0, 5); // Cap at 5 work locations
      }

      if (DRY_RUN) {
        const b = data.birth ? `born: ${data.birth.city}` : '';
        const d = data.death ? `died: ${data.death.city}` : '';
        const w = data.work.length > 0 ? `worked: ${data.work.map(p => p.city).join(', ')}` : '';
        console.log(`  ${entity.name} — ${[b, d, w].filter(Boolean).join(' | ')}`);
      } else {
        await db.collection('entities').updateOne(
          { _id: entity._id },
          { $set: update }
        );
      }
      enriched++;
    }

    // Rate limit: 2s between batches
    if (i + 50 < entities.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\nEntities enriched: ${enriched}, No data: ${noData}`);

  // Step 3: Write author locations to books
  if (WRITE_BOOKS && !DRY_RUN) {
    console.log('\nWriting author locations to books...');
    let booksUpdated = 0;

    // Find entities that now have birth_place
    const enrichedEntities = await db.collection('entities').find(
      { type: 'person', birth_place: { $exists: true } },
      { projection: { _id: 1, name: 1, birth_place: 1, death_place: 1 } }
    ).toArray();

    console.log(`${enrichedEntities.length} entities with location data`);

    for (const entity of enrichedEntities) {
      const locations = [];

      if (entity.birth_place) {
        locations.push({
          type: 'author_birth',
          city: entity.birth_place.city,
          country: entity.birth_place.country,
          lat: entity.birth_place.lat,
          lng: entity.birth_place.lng,
          source: 'wikidata',
          confidence: 'high',
        });
      }
      if (entity.death_place) {
        locations.push({
          type: 'author_death',
          city: entity.death_place.city,
          country: entity.death_place.country,
          lat: entity.death_place.lat,
          lng: entity.death_place.lng,
          source: 'wikidata',
          confidence: 'high',
        });
      }

      if (locations.length === 0) continue;

      // Add to books that don't already have author locations
      const result = await db.collection('books').updateMany(
        {
          author_entity_id: entity._id.toString(),
          'locations.type': { $nin: ['author_birth', 'author_death'] },
        },
        {
          $push: { locations: { $each: locations } },
        }
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
