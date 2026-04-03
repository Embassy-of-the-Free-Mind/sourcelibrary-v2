#!/usr/bin/env node
/**
 * Geocode place_of_publication strings to lat/lng coordinates.
 *
 * 1. Collect all distinct place_of_publication values
 * 2. Query Wikidata for coordinates (batch via SPARQL)
 * 3. Build city→coords lookup and cache in system_config
 * 4. Write locations[] array to books
 *
 * Usage:
 *   node scripts/enrichment/geocode-publication-places.mjs [--dry-run] [--rebuild-cache]
 *
 * GitHub issue: #724
 */

import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const REBUILD_CACHE = process.argv.includes('--rebuild-cache');

/** Query Wikidata SPARQL for city coordinates — prefer large cities */
async function geocodeViaWikidata(cityName) {
  // Prefer cities/towns (P31 = Q515 city, Q3957 town, Q1549591 big city) with largest population
  const sparql = `
    SELECT ?item ?itemLabel ?lat ?lon ?countryLabel ?pop WHERE {
      ?item rdfs:label "${cityName.replace(/"/g, '\\"')}"@en .
      ?item wdt:P625 ?coord .
      ?item wdt:P17 ?country .
      OPTIONAL { ?item wdt:P1082 ?pop }
      BIND(geof:latitude(?coord) AS ?lat)
      BIND(geof:longitude(?coord) AS ?lon)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en" }
    }
    ORDER BY DESC(?pop)
    LIMIT 1
  `;

  try {
    const res = await fetch(
      `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`,
      { headers: { 'User-Agent': 'SourceLibrary/1.0 (https://sourcelibrary.org)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const result = data.results?.bindings?.[0];
    if (!result) return null;

    return {
      lat: parseFloat(result.lat.value),
      lng: parseFloat(result.lon.value),
      country: result.countryLabel?.value || null,
      wikidata_id: result.item?.value?.split('/').pop() || null,
    };
  } catch {
    return null;
  }
}

/** Fallback: search Wikidata API for fuzzy matches */
async function geocodeViaSearch(cityName) {
  try {
    const searchRes = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(cityName)}&language=en&limit=3&format=json`
    );
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();

    for (const result of searchData.search || []) {
      // Get entity details with coordinates
      const entityRes = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${result.id}&props=claims&format=json`
      );
      if (!entityRes.ok) continue;
      const entityData = await entityRes.json();
      const claims = entityData.entities?.[result.id]?.claims;

      // Check P625 (coordinate location)
      const coordClaim = claims?.P625?.[0]?.mainsnak?.datavalue?.value;
      if (!coordClaim) continue;

      // Check P17 (country)
      const countryClaim = claims?.P17?.[0]?.mainsnak?.datavalue?.value?.id;

      let country = null;
      if (countryClaim) {
        const countryRes = await fetch(
          `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${countryClaim}&props=labels&languages=en&format=json`
        );
        if (countryRes.ok) {
          const countryData = await countryRes.json();
          country = countryData.entities?.[countryClaim]?.labels?.en?.value || null;
        }
      }

      return {
        lat: coordClaim.latitude,
        lng: coordClaim.longitude,
        country,
        wikidata_id: result.id,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function main() {
  console.log(`Geocode Publication Places — ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('─'.repeat(60));

  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  // Step 1: Load or build geocode cache
  let cache = {};
  if (!REBUILD_CACHE) {
    const existing = await db.collection('system_config').findOne({ _id: 'geocode_cache' });
    cache = existing?.cities || {};
    console.log(`Loaded ${Object.keys(cache).length} cached cities`);
  }

  // Step 2: Get all distinct place_of_publication values
  const places = await db.collection('books').distinct('place_of_publication', {
    visible: true,
    place_of_publication: { $exists: true, $ne: null, $ne: '' },
  });

  // Filter out non-place values
  const skipPatterns = [/^n\.p\.?$/i, /^s\.l\.?$/i, /^\?$/, /^unknown$/i, /^—$/];
  const validPlaces = places.filter(p => p && typeof p === 'string' && p.length > 1 && !skipPatterns.some(pat => pat.test(p)));

  console.log(`${validPlaces.length} distinct places (${Object.keys(cache).length} already cached)`);

  // Step 3: Geocode uncached places
  const uncached = validPlaces.filter(p => !cache[p]);
  console.log(`${uncached.length} to geocode\n`);

  for (let i = 0; i < uncached.length; i++) {
    const place = uncached[i];
    if (i > 0 && i % 10 === 0) console.log(`  ${i}/${uncached.length}...`);

    // Clean up place name: strip brackets, take first city from multi-city
    let primaryPlace = place
      .replace(/^\[+/, '').replace(/\]+$/, '')  // strip [brackets]
      .replace(/^\"+/, '').replace(/\"+$/, '')  // strip "quotes"
      .replace(/^`+/, '').replace(/'+$/, '')    // strip backticks
      .split('|')[0]                            // first city from multi-city
      .split(/\s+en\s+/i)[0]                   // Dutch "en" = "and"
      .split(/\s+and\s+/i)[0]                  // English "and"
      .split(',')[0]                            // before comma (strip state/country qualifier)
      .trim();
    // Skip if empty or looks like a pseudonym place
    if (!primaryPlace || primaryPlace.length < 2) { cache[place] = null; continue; }

    // Try SPARQL first (exact match), then search API (fuzzy)
    let result = await geocodeViaWikidata(primaryPlace);
    if (!result) result = await geocodeViaSearch(primaryPlace);

    if (result) {
      cache[place] = { city: primaryPlace, ...result };
      console.log(`  ✓ ${place} → ${result.lat.toFixed(2)}, ${result.lng.toFixed(2)} (${result.country || '?'})`);
    } else {
      cache[place] = null; // Mark as unresolvable
      console.log(`  ✗ ${place}`);
    }

    // Rate limit Wikidata
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 1000));
  }

  // Step 4: Save cache
  if (!DRY_RUN) {
    await db.collection('system_config').updateOne(
      { _id: 'geocode_cache' },
      { $set: { cities: cache, updated_at: new Date(), count: Object.keys(cache).length } },
      { upsert: true }
    );
    console.log(`\nCached ${Object.keys(cache).length} cities`);
  }

  // Step 5: Write locations to books
  const resolved = Object.entries(cache).filter(([_, v]) => v !== null);
  console.log(`\nWriting locations to books (${resolved.length} resolvable places)...`);

  let updated = 0;
  for (const [place, geo] of resolved) {
    const location = {
      type: 'publication',
      city: geo.city,
      country: geo.country,
      lat: geo.lat,
      lng: geo.lng,
      source: 'wikidata',
      confidence: 'high',
    };

    if (DRY_RUN) continue;

    // Add to locations array (don't duplicate)
    const result = await db.collection('books').updateMany(
      {
        visible: true,
        place_of_publication: place,
        'locations.type': { $ne: 'publication' }, // don't add if already has one
      },
      {
        $push: { locations: location },
      }
    );
    updated += result.modifiedCount;
  }

  console.log(`Updated ${updated} books with publication coordinates`);
  console.log('\n' + '─'.repeat(60));
  console.log('Done.');

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
