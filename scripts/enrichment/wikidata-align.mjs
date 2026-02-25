#!/usr/bin/env node

/**
 * Wikidata Alignment Script
 *
 * Aligns entities in the `entities` collection with Wikidata QIDs.
 *
 * Two passes:
 * 1. Wikipedia → Wikidata (high confidence): Batch-resolve entities that already
 *    have `wikipedia_url` via the Wikipedia API pageprops endpoint.
 * 2. Fuzzy search (lower confidence): Search Wikidata for entities without
 *    `wikipedia_url`, accepting only exact name matches with type validation.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/wikidata-align.mjs
 *
 * Options:
 *   --mode=MODE        wikipedia | search | all (default: all)
 *   --dry-run          Show what would be done without writing
 *   --limit=N          Max entities to process (default: unlimited)
 *   --fetch-props      Also fetch birth/death dates (people) and coordinates (places) from Wikidata
 *   --type=TYPE        Filter by entity type: person, place, concept
 *   --offset=N         Skip first N entities
 */

import { MongoClient } from 'mongodb';

// --- Config ---
const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const MODE = args.mode || 'all';
const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit) : Infinity;
const FETCH_PROPS = args['fetch-props'] === 'true';
const TYPE_FILTER = args.type || null;
const OFFSET = parseInt(args.offset || '0');

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Missing MONGODB_URI');
  process.exit(1);
}

// --- Helpers ---
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch with User-Agent header and basic error handling.
 */
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
 * Extract Wikipedia article title from a Wikipedia URL.
 * Handles both /wiki/Title and /wiki/Title#section formats.
 */
function extractWikiTitle(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('wikipedia.org')) return null;
    const path = parsed.pathname;
    const match = path.match(/^\/wiki\/(.+)/);
    if (!match) return null;
    return decodeURIComponent(match[1].replace(/_/g, ' '));
  } catch {
    return null;
  }
}

// --- Pass 1: Wikipedia → Wikidata ---

/**
 * Batch resolve Wikipedia article titles to Wikidata QIDs.
 * Wikipedia API supports up to 50 titles per request.
 */
async function resolveWikipediaToWikidata(titles) {
  const encoded = titles.map(t => encodeURIComponent(t.replace(/ /g, '_'))).join('|');
  const url = `https://en.wikipedia.org/w/api.php?action=query&titles=${encoded}&redirects=1&prop=pageprops&ppprop=wikibase_item&format=json&formatversion=2`;
  const data = await apiFetch(url);

  // Build redirect map: original title → final title
  const redirectMap = new Map();
  for (const r of data.query?.redirects || []) {
    redirectMap.set(r.from, r.to);
  }
  // Also handle normalizations (e.g. underscore → space)
  const normalMap = new Map();
  for (const n of data.query?.normalized || []) {
    normalMap.set(n.from, n.to);
  }

  const results = new Map();
  for (const page of data.query?.pages || []) {
    if (page.pageprops?.wikibase_item) {
      results.set(page.title, page.pageprops.wikibase_item);
    }
  }

  // Map original titles through redirects to find their QIDs
  const titleResults = new Map();
  for (const origTitle of titles) {
    // Follow normalization → redirect → page title chain
    let resolved = origTitle;
    if (normalMap.has(resolved.replace(/ /g, '_'))) {
      resolved = normalMap.get(resolved.replace(/ /g, '_'));
    }
    if (redirectMap.has(resolved)) {
      resolved = redirectMap.get(resolved);
    }
    if (results.has(resolved)) {
      titleResults.set(origTitle, results.get(resolved));
    }
  }

  return titleResults;
}

async function passWikipedia(db) {
  console.log('\n=== Pass 1: Wikipedia URL → Wikidata QID ===\n');

  const filter = {
    wikipedia_url: { $exists: true, $ne: '' },
    wikidata_id: { $exists: false },
  };
  if (TYPE_FILTER) filter.type = TYPE_FILTER;

  const entities = await db.collection('entities')
    .find(filter)
    .sort({ book_count: -1 })
    .skip(OFFSET)
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .toArray();

  console.log(`Found ${entities.length} entities with Wikipedia URLs but no Wikidata ID`);
  if (entities.length === 0) return { resolved: 0, failed: 0 };

  // Group by Wikipedia title
  const titleToEntities = new Map();
  for (const e of entities) {
    const title = extractWikiTitle(e.wikipedia_url);
    if (!title) {
      console.log(`  [skip] ${e.name}: invalid Wikipedia URL: ${e.wikipedia_url}`);
      continue;
    }
    if (!titleToEntities.has(title)) {
      titleToEntities.set(title, []);
    }
    titleToEntities.get(title).push(e);
  }

  const allTitles = [...titleToEntities.keys()];
  console.log(`Extracted ${allTitles.length} unique Wikipedia titles`);

  let resolved = 0;
  let failed = 0;

  // Process in batches of 50 (Wikipedia API limit)
  for (let i = 0; i < allTitles.length; i += 50) {
    const batch = allTitles.slice(i, i + 50);
    console.log(`\nBatch ${Math.floor(i / 50) + 1}: resolving ${batch.length} titles...`);

    try {
      const results = await resolveWikipediaToWikidata(batch);

      for (const title of batch) {
        const qid = results.get(title);
        const matchedEntities = titleToEntities.get(title) || [];

        if (qid) {
          for (const e of matchedEntities) {
            console.log(`  [ok] ${e.name} → ${qid}`);
            if (!DRY_RUN) {
              const updateFields = { wikidata_id: qid, updated_at: new Date() };

              // Optionally fetch properties from Wikidata
              if (FETCH_PROPS) {
                const props = await fetchWikidataProps(qid, e.type);
                Object.assign(updateFields, props);
                if (Object.keys(props).length > 0) {
                  console.log(`    props: ${JSON.stringify(props)}`);
                }
                await sleep(200);
              }

              await db.collection('entities').updateOne(
                { _id: e._id },
                { $set: updateFields }
              );
            }
            resolved++;
          }
        } else {
          for (const e of matchedEntities) {
            console.log(`  [miss] ${e.name}: no Wikidata QID found for "${title}"`);
            failed++;
          }
        }
      }

      await sleep(200); // Rate limit: 200ms between batch calls
    } catch (err) {
      console.error(`  [error] Batch failed: ${err.message}`);
      failed += batch.length;
    }
  }

  return { resolved, failed };
}

// --- Pass 2: Fuzzy Wikidata Search ---

/**
 * Wikidata entity type validation via P31 (instance of) claims.
 * Returns true if the entity type matches expectations.
 */
const VALID_P31_BY_TYPE = {
  person: new Set([
    'Q5',         // human
    'Q15632617',  // fictional human
  ]),
  place: new Set([
    'Q515',       // city
    'Q486972',    // human settlement
    'Q6256',      // country
    'Q82794',     // geographic region
    'Q3957',      // town
    'Q532',       // village
    'Q35657',     // state/province
    'Q23397',     // lake
    'Q8502',      // mountain
    'Q4022',      // river
    'Q23442',     // island
  ]),
};

async function searchWikidata(name, type) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&type=item&limit=5&format=json`;
  const data = await apiFetch(url);

  if (!data.search?.length) return null;

  // Look for exact name match (case-insensitive)
  const nameLower = name.toLowerCase();
  for (const result of data.search) {
    const labelMatch = result.label?.toLowerCase() === nameLower;
    const aliasMatch = result.aliases?.some(a => a.toLowerCase() === nameLower);

    if (labelMatch || aliasMatch) {
      // Validate type if we have P31 expectations
      if (VALID_P31_BY_TYPE[type]) {
        const isValid = await validateEntityType(result.id, type);
        if (isValid) {
          return { qid: result.id, confidence: 'high', label: result.label };
        } else {
          // Type mismatch — store as suggestion
          return { qid: result.id, confidence: 'suggested', label: result.label };
        }
      }
      // For concepts, accept any exact match
      return { qid: result.id, confidence: 'high', label: result.label };
    }
  }

  return null;
}

async function validateEntityType(qid, entityType) {
  const validP31s = VALID_P31_BY_TYPE[entityType];
  if (!validP31s) return true; // No validation for this type

  try {
    const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P31&format=json`;
    const data = await apiFetch(url);

    const claims = data.claims?.P31 || [];
    for (const claim of claims) {
      const targetId = claim.mainsnak?.datavalue?.value?.id;
      if (targetId && validP31s.has(targetId)) {
        return true;
      }
    }
    return false;
  } catch {
    return false; // On error, don't validate
  }
}

async function passSearch(db) {
  console.log('\n=== Pass 2: Wikidata Search ===\n');

  const filter = {
    wikidata_id: { $exists: false },
    wikidata_id_suggested: { $exists: false },
  };
  if (TYPE_FILTER) filter.type = TYPE_FILTER;

  const entities = await db.collection('entities')
    .find(filter)
    .sort({ book_count: -1 })
    .skip(OFFSET)
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .toArray();

  console.log(`Found ${entities.length} entities without Wikidata alignment`);
  if (entities.length === 0) return { resolved: 0, suggested: 0, missed: 0 };

  let resolved = 0;
  let suggested = 0;
  let missed = 0;

  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    const progress = `[${i + 1}/${entities.length}]`;

    try {
      const result = await searchWikidata(e.name, e.type);

      if (result && result.confidence === 'high') {
        console.log(`  ${progress} [ok] ${e.name} → ${result.qid} (${result.label})`);
        if (!DRY_RUN) {
          const updateFields = { wikidata_id: result.qid, updated_at: new Date() };

          if (FETCH_PROPS) {
            const props = await fetchWikidataProps(result.qid, e.type);
            Object.assign(updateFields, props);
            if (Object.keys(props).length > 0) {
              console.log(`    props: ${JSON.stringify(props)}`);
            }
            await sleep(200);
          }

          await db.collection('entities').updateOne(
            { _id: e._id },
            { $set: updateFields }
          );
        }
        resolved++;
      } else if (result && result.confidence === 'suggested') {
        console.log(`  ${progress} [suggest] ${e.name} → ${result.qid} (${result.label}) [type mismatch]`);
        if (!DRY_RUN) {
          await db.collection('entities').updateOne(
            { _id: e._id },
            { $set: { wikidata_id_suggested: result.qid, updated_at: new Date() } }
          );
        }
        suggested++;
      } else {
        console.log(`  ${progress} [miss] ${e.name}`);
        missed++;
      }
    } catch (err) {
      console.error(`  ${progress} [error] ${e.name}: ${err.message}`);
      missed++;
    }

    await sleep(500); // Rate limit: 500ms between individual searches
  }

  return { resolved, suggested, missed };
}

// --- Property Fetching ---

/**
 * Fetch structured properties from Wikidata for an entity.
 * People: birth date (P569), death date (P570)
 * Places: coordinates (P625)
 */
async function fetchWikidataProps(qid, entityType) {
  const props = {};

  try {
    if (entityType === 'person') {
      // wbgetclaims only accepts one property at a time — fetch birth and death separately
      const birthUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P569&format=json`;
      const birthData = await apiFetch(birthUrl);
      const birthClaim = birthData.claims?.P569?.[0];
      if (birthClaim?.mainsnak?.datavalue?.value?.time) {
        const time = birthClaim.mainsnak.datavalue.value.time;
        const precision = birthClaim.mainsnak.datavalue.value.precision;
        props.wikidata_birth_date = formatWikidataDate(time, precision);
      }

      const deathUrl = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P570&format=json`;
      const deathData = await apiFetch(deathUrl);
      const deathClaim = deathData.claims?.P570?.[0];
      if (deathClaim?.mainsnak?.datavalue?.value?.time) {
        const time = deathClaim.mainsnak.datavalue.value.time;
        const precision = deathClaim.mainsnak.datavalue.value.precision;
        props.wikidata_death_date = formatWikidataDate(time, precision);
      }
    } else if (entityType === 'place') {
      // Coordinates (P625)
      const url = `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${qid}&property=P625&format=json`;
      const data = await apiFetch(url);
      const coordClaim = data.claims?.P625?.[0];
      if (coordClaim?.mainsnak?.datavalue?.value) {
        const { latitude, longitude } = coordClaim.mainsnak.datavalue.value;
        props.wikidata_coordinates = {
          lat: Math.round(latitude * 10000) / 10000,
          lng: Math.round(longitude * 10000) / 10000,
        };
      }
    }
  } catch (err) {
    console.error(`    [props error] ${qid}: ${err.message}`);
  }

  return props;
}

/**
 * Format Wikidata time value to ISO date string.
 * Wikidata uses +YYYY-MM-DDT00:00:00Z format with precision levels.
 * Precision: 9=year, 10=month, 11=day
 */
function formatWikidataDate(time, precision) {
  // Remove leading + and trailing time component
  const dateStr = time.replace(/^[+-]/, '').replace(/T.*$/, '');
  const parts = dateStr.split('-');

  if (precision >= 11) return dateStr; // Full date YYYY-MM-DD
  if (precision === 10) return `${parts[0]}-${parts[1]}`; // Year-month
  if (precision === 9) return parts[0]; // Year only
  return parts[0]; // Fall back to year
}

// --- Main ---
async function main() {
  console.log('Wikidata Alignment Script');
  console.log('========================');
  console.log(`Mode: ${MODE}`);
  console.log(`Dry run: ${DRY_RUN}`);
  console.log(`Fetch props: ${FETCH_PROPS}`);
  if (TYPE_FILTER) console.log(`Type filter: ${TYPE_FILTER}`);
  if (LIMIT < Infinity) console.log(`Limit: ${LIMIT}`);
  if (OFFSET > 0) console.log(`Offset: ${OFFSET}`);

  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    const stats = { wikipedia: null, search: null };

    if (MODE === 'wikipedia' || MODE === 'all') {
      stats.wikipedia = await passWikipedia(db);
    }

    if (MODE === 'search' || MODE === 'all') {
      stats.search = await passSearch(db);
    }

    console.log('\n=== Summary ===');
    if (stats.wikipedia) {
      console.log(`Wikipedia pass: ${stats.wikipedia.resolved} resolved, ${stats.wikipedia.failed} failed`);
    }
    if (stats.search) {
      console.log(`Search pass: ${stats.search.resolved} resolved, ${stats.search.suggested} suggested, ${stats.search.missed} missed`);
    }
    if (DRY_RUN) {
      console.log('\n(dry run — no changes written)');
    }
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
