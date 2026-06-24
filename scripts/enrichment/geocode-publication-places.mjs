#!/usr/bin/env node
/**
 * Geocode place_of_publication strings to lat/lng coordinates.
 *
 * 1. Collect all distinct place strings from place_of_publication AND place_published
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
const FIX_OVERRIDES = process.argv.includes('--fix-overrides');

/**
 * Manual overrides for cities where Wikidata disambiguation fails.
 * Wikidata often returns small US/Canadian towns instead of the historical cities.
 */
const MANUAL_OVERRIDES = {
  'Calcutta':     { city: 'Calcutta', lat: 22.5726, lng: 88.3639, country: 'India', wikidata_id: 'Q1348' },
  'Bombay':       { city: 'Bombay', lat: 19.0760, lng: 72.8777, country: 'India', wikidata_id: 'Q1156' },
  'Cambridge':    { city: 'Cambridge', lat: 52.2053, lng: 0.1218, country: 'United Kingdom', wikidata_id: 'Q350' },
  'Breslau':      { city: 'Breslau', lat: 51.1079, lng: 17.0385, country: 'Poland', wikidata_id: 'Q1799' },
  'Cracow':       { city: 'Cracow', lat: 50.0647, lng: 19.9450, country: 'Poland', wikidata_id: 'Q31487' },
  'Krakow':       { city: 'Krakow', lat: 50.0647, lng: 19.9450, country: 'Poland', wikidata_id: 'Q31487' },
  'Louvain':      { city: 'Louvain', lat: 50.8798, lng: 4.7005, country: 'Belgium', wikidata_id: 'Q118958' },
  'Palmyra':      { city: 'Palmyra', lat: 34.5520, lng: 38.2668, country: 'Syria', wikidata_id: 'Q39454' },
  'New York':     { city: 'New York', lat: 40.7128, lng: -74.0060, country: 'United States', wikidata_id: 'Q60' },
  // Cambridge, Massachusetts is actually correct for modern academic publishers
  'Cambridge, Massachusetts': { city: 'Cambridge, MA', lat: 42.3736, lng: -71.1097, country: 'United States', wikidata_id: 'Q49111' },
  'Rheims':       { city: 'Rheims', lat: 49.2583, lng: 3.5752, country: 'France', wikidata_id: 'Q41876' },
  'Königsberg':   { city: 'Königsberg', lat: 54.7104, lng: 20.4522, country: 'Russia', wikidata_id: 'Q1773' },
  'Girard':       null, // Small US town, not a historical publishing center — skip
};

/**
 * Old-spelling / variant → modern label that Wikidata's English label index
 * knows. Only for forms that fail to resolve as written (verified empirically).
 */
const ARCHAIC_NORMALIZE = {
  leyden: 'Leiden', leiden: 'Leiden',
  haerlem: 'Haarlem',
  neuremberg: 'Nuremberg', nuremberg: 'Nuremberg', nurnberg: 'Nuremberg', nürnberg: 'Nuremberg',
  wittemberg: 'Wittenberg',
  francfort: 'Frankfurt', franckfurt: 'Frankfurt', franckfort: 'Frankfurt',
  coln: 'Cologne', colln: 'Cologne', cölln: 'Cologne', cöln: 'Cologne', keulen: 'Cologne',
  edimbourg: 'Edinburgh', edimburgh: 'Edinburgh',
  liegnitz: 'Legnica', brieg: 'Brzeg', breslau: 'Wrocław', wroclaw: 'Wrocław',
  wittemberga: 'Wittenberg', argentorati: 'Strasbourg', argentina: 'Strasbourg',
  lugduni: 'Lyon', lutetiae: 'Paris', basileae: 'Basel', venetiis: 'Venice',
  köln: 'Cologne', munchen: 'Munich', münchen: 'Munich',
  strassbourg: 'Strasbourg', strassburg: 'Strasbourg',
  stpetersburg: 'Saint Petersburg', sintpetersburg: 'Saint Petersburg', leningrad: 'Saint Petersburg',
  pressburg: 'Bratislava', dantzig: 'Gdańsk', gdansk: 'Gdańsk',
  parijs: 'Paris', londen: 'London', weenen: 'Vienna', wien: 'Vienna',
  freyberg: 'Freiberg', buedingen: 'Büdingen', antwerpen: 'Antwerp',
};

/** Placeless / non-geographic imprint markers — return null (no dot). */
const PLACELESS = [
  /^n\.?\s*p\.?$/i, /^s\.?\s*l\.?$/i, /^z\.?\s*p\.?$/i, /^s\.?\s*n\.?$/i,
  /^sans lieu$/i, /^unknown$/i, /^onbekend$/i, /^that year$/i, /^by\b/i, /^\?+$/,
];

/**
 * Normalize a raw imprint string to a single geocodable city, or null to skip.
 * Handles bracketed editorial places, false imprints (real city in brackets,
 * fictitious city quoted), Dutch/Latin prepositions, multi-city lists, and
 * archaic spellings. See scope notes — recovers ~250 books the naive cleaner
 * left unmapped.
 */
function cleanPlaceName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();

  // 1. Prefer a bracketed editorial place: "Fake" [Real], [=Real], X [Real].
  const br = s.match(/\[\s*=?\s*([^\][?]+?)\s*\??\s*\]/);
  if (br && br[1].trim().length > 1) s = br[1].trim();
  else s = s.replace(/[[\]]/g, ' ');

  // 2. Dutch contraction t'/'t (before quote-stripping eats the apostrophe).
  s = s.replace(/^\s*'?t'\s*/i, ' ').replace(/^\s*'t\s+/i, ' ');

  // 3. Strip quotes, question marks, colons, semicolons.
  s = s.replace(/["'`?:;]/g, ' ');

  // 4. Strip leading place-prepositions (Dutch te/tot, Latin ad/apud, à/a/in/zu).
  s = s.replace(/^\s*(te|tot|in|ad|apud|à|a|zu|zur|au)\s+/i, ' ');

  // 5. "Oldname = Modernname" → modern; then multi-city lists → first city.
  s = s.split('=').pop().split('|')[0]
       .split(/\s+en\s+/i)[0].split(/\s+and\s+/i)[0].split(/\s+et\s+/i)[0]
       .split('/')[0].split('&')[0].split(',')[0]
       .split(/\s{2,}/)[0]           // double-space-separated multi-imprint
       .trim();

  if (!s || s.length < 2) return null;
  if (PLACELESS.some((p) => p.test(s))) return null;

  const key = s.toLowerCase().replace(/[^a-zà-ÿ]/g, '');
  return ARCHAIC_NORMALIZE[key] || s;
}

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

  // Step 2: Get all distinct place strings. Books record their imprint city in
  // EITHER `place_of_publication` OR the legacy `place_published` field; geocode
  // the union of both so neither set of books is silently left off the map.
  const [placesA, placesB] = await Promise.all([
    db.collection('books').distinct('place_of_publication', {
      visible: true, place_of_publication: { $exists: true, $ne: null, $ne: '' },
    }),
    db.collection('books').distinct('place_published', {
      visible: true, place_published: { $exists: true, $ne: null, $ne: '' },
    }),
  ]);
  const places = [...new Set([...placesA, ...placesB])];

  // Filter out non-place values
  const skipPatterns = [/^n\.p\.?$/i, /^s\.l\.?$/i, /^\?$/, /^unknown$/i, /^—$/];
  const validPlaces = places.filter(p => p && typeof p === 'string' && p.length > 1 && !skipPatterns.some(pat => pat.test(p)));

  console.log(`${validPlaces.length} distinct places (${Object.keys(cache).length} already cached)`);

  // Step 2b: Apply manual overrides to fix wrong entries in cache
  if (FIX_OVERRIDES) {
    let fixed = 0;
    for (const [place, geo] of Object.entries(cache)) {
      if (!geo) continue;
      // Check place string first (more specific), then city name
      const override = MANUAL_OVERRIDES[place] || MANUAL_OVERRIDES[geo.city];
      if (override === null) {
        // Explicitly null = remove this entry
        console.log(`  REMOVE: ${place} — ${geo.city}`);
        cache[place] = null;
        fixed++;
      } else if (override && (Math.abs(geo.lat - override.lat) > 1 || Math.abs(geo.lng - override.lng) > 1)) {
        console.log(`  FIX: ${place} — ${geo.city} (${geo.lat.toFixed(2)}, ${geo.lng.toFixed(2)} ${geo.country}) → (${override.lat.toFixed(2)}, ${override.lng.toFixed(2)} ${override.country})`);
        cache[place] = { city: override.city, ...override };
        fixed++;
      }
    }
    console.log(`Fixed ${fixed} override entries\n`);
  }

  // Step 3: Geocode uncached places
  const uncached = validPlaces.filter(p => !cache[p]);
  console.log(`${uncached.length} to geocode\n`);

  for (let i = 0; i < uncached.length; i++) {
    const place = uncached[i];
    if (i > 0 && i % 10 === 0) console.log(`  ${i}/${uncached.length}...`);

    // Normalize the raw imprint string to a single geocodable city (handles
    // brackets, false imprints, Dutch/Latin prepositions, archaic spellings).
    const primaryPlace = cleanPlaceName(place);
    if (!primaryPlace) { cache[place] = null; continue; }

    // Check manual overrides first, then SPARQL, then search API
    let result = null;
    if (primaryPlace in MANUAL_OVERRIDES) {
      const ov = MANUAL_OVERRIDES[primaryPlace];
      if (ov === null) { cache[place] = null; continue; }
      result = { ...ov };
    } else if (place in MANUAL_OVERRIDES) {
      const ov = MANUAL_OVERRIDES[place];
      if (ov === null) { cache[place] = null; continue; }
      result = { ...ov };
    } else {
      result = await geocodeViaWikidata(primaryPlace);
      if (!result) result = await geocodeViaSearch(primaryPlace);
    }

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

    // A book matches this place via either imprint field.
    const placeMatch = { $or: [{ place_of_publication: place }, { place_published: place }] };

    if (FIX_OVERRIDES) {
      // When fixing overrides: replace existing publication location
      const result = await db.collection('books').updateMany(
        { visible: true, ...placeMatch, 'locations.type': 'publication' },
        { $set: { 'locations.$[elem]': location } },
        { arrayFilters: [{ 'elem.type': 'publication' }] }
      );
      // Also add to books that don't have one yet
      const result2 = await db.collection('books').updateMany(
        { visible: true, ...placeMatch, 'locations.type': { $ne: 'publication' } },
        { $push: { locations: location } }
      );
      updated += result.modifiedCount + result2.modifiedCount;
    } else {
      // Normal mode: add to locations array (don't duplicate)
      const result = await db.collection('books').updateMany(
        {
          visible: true,
          ...placeMatch,
          'locations.type': { $ne: 'publication' }, // don't add if already has one
        },
        {
          $push: { locations: location },
        }
      );
      updated += result.modifiedCount;
    }
  }

  console.log(`Updated ${updated} books with publication coordinates`);
  console.log('\n' + '─'.repeat(60));
  console.log('Done.');

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
