#!/usr/bin/env node
/**
 * Cross-reference artworks with Wikidata to get verified identifiers.
 *
 * For each artwork, looks up the artist on Wikidata and retrieves:
 *   - Getty ULAN ID (P245) — verified, replaces AI-inferred
 *   - RKDartists ID (P650) — Netherlands Institute for Art History
 *   - VIAF ID (P214) — Virtual International Authority File
 *   - Birth/death dates (P569/P570) — verified
 *   - Movement (P135) — verified art-historical movement
 *   - Wikidata Q-number itself — universal linked data key
 *
 * Caches artist lookups so we only query Wikidata once per artist.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/wikidata-artwork-crossref.mjs [--dry-run] [--limit=100]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const DELAY_MS = 200;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) wikidata-crossref';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Cache: artist name → Wikidata result (avoids re-querying for 1000 Goltzius artworks)
const artistCache = new Map();

async function wikidataSearch(query) {
  const params = new URLSearchParams({
    action: 'wbsearchentities', search: query, language: 'en',
    type: 'item', limit: '5', format: 'json',
  });
  const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Wikidata search HTTP ${res.status}`);
  return (await res.json()).search || [];
}

async function wikidataGetEntity(qid) {
  const params = new URLSearchParams({
    action: 'wbgetentities', ids: qid, props: 'claims|labels|descriptions',
    languages: 'en', format: 'json',
  });
  const res = await fetch(`https://www.wikidata.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Wikidata entity HTTP ${res.status}`);
  const data = await res.json();
  return data.entities?.[qid] || null;
}

function getClaimValue(entity, property) {
  const claims = entity?.claims?.[property];
  if (!claims?.length) return null;
  const val = claims[0].mainsnak?.datavalue?.value;
  if (typeof val === 'string') return val;
  if (val?.id) return val.id;
  if (val?.time) return val.time;
  return null;
}

function getClaimValues(entity, property) {
  const claims = entity?.claims?.[property];
  if (!claims?.length) return [];
  return claims.map(c => {
    const val = c.mainsnak?.datavalue?.value;
    if (typeof val === 'string') return val;
    if (val?.id) return val.id;
    if (val?.time) return val.time;
    return null;
  }).filter(Boolean);
}

function cleanArtistName(raw) {
  if (!raw) return null;
  let name = raw;
  // Strip dates in parens: "Rops, Félicien (1833-1898)" → "Rops, Félicien"
  name = name.replace(/\s*\(\d{4}[-–]\d{4}\)\s*/g, ' ').trim();
  name = name.replace(/\s*\(ca?\.\s*\d{4}[-–](?:ca?\.\s*)?\d{4}\)\s*/g, ' ').trim();
  name = name.replace(/\s*\(\d{4}[-–]\)\s*/g, ' ').trim();
  // Strip roles: ". Graveur", ". Peintre", etc.
  name = name.replace(/\.\s*(Graveur|Peintre|Dessinateur|Sculpteur|Éditeur|Imprimeur|Architecte)\b.*/i, '').trim();
  // Take first name before newlines or semicolons (multi-artist)
  name = name.split(/\n|;/)[0].trim();
  // "Last, First" → "First Last" for better Wikidata matching
  if (/^[^,]+,\s+[^,]+$/.test(name)) {
    const [last, first] = name.split(',').map(s => s.trim());
    name = `${first} ${last}`;
  }
  // Strip trailing punctuation
  name = name.replace(/[.,;:]+$/, '').trim();
  return name.length >= 2 ? name : null;
}

async function lookupArtist(name) {
  if (!name || name === 'Unknown artist' || name === 'Unknown') return null;

  const cleaned = cleanArtistName(name);
  if (!cleaned) return null;

  // Check cache
  const cacheKey = cleaned.toLowerCase().trim();
  if (artistCache.has(cacheKey)) return artistCache.get(cacheKey);

  try {
    // Search Wikidata for the artist
    const results = await wikidataSearch(cleaned);
    await sleep(DELAY_MS);

    // Filter to likely artists (description mentions painter/printmaker/artist/sculptor)
    const artistTerms = /paint|print|artist|engrav|sculpt|draw|illustrat|architect|goldsmith|etcher|woodcut/i;
    const match = results.find(r => artistTerms.test(r.description || ''));
    if (!match) {
      artistCache.set(cacheKey, null);
      return null;
    }

    // Get full entity
    const entity = await wikidataGetEntity(match.id);
    await sleep(DELAY_MS);
    if (!entity) {
      artistCache.set(cacheKey, null);
      return null;
    }

    const result = {
      wikidata_id: match.id,
      wikidata_label: entity.labels?.en?.value || name,
      wikidata_description: entity.descriptions?.en?.value || null,
      ulan_id: getClaimValue(entity, 'P245'),           // Getty ULAN
      rkd_id: getClaimValue(entity, 'P650'),             // RKDartists
      viaf_id: getClaimValue(entity, 'P214'),            // VIAF
      loc_id: getClaimValue(entity, 'P244'),             // Library of Congress
      british_museum_id: getClaimValue(entity, 'P1711'), // British Museum
      birth_date: getClaimValue(entity, 'P569'),
      death_date: getClaimValue(entity, 'P570'),
      birth_place_qid: getClaimValue(entity, 'P19'),
      death_place_qid: getClaimValue(entity, 'P20'),
      movement_qids: getClaimValues(entity, 'P135'),
      occupation_qids: getClaimValues(entity, 'P106'),
    };

    artistCache.set(cacheKey, result);
    return result;
  } catch (e) {
    console.log(`  Wikidata error for "${name}": ${e.message?.substring(0, 50)}`);
    artistCache.set(cacheKey, null);
    return null;
  }
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find artworks without Wikidata cross-reference
  const query = {
    content_type: 'artwork',
    visible: true,
    'wikidata_artist': { $exists: false },
    author: { $nin: [null, '', 'Unknown artist', 'Unknown', 'Unknown author'] },
  };

  const total = await db.collection('books').countDocuments(query);
  const limit = LIMIT || total;

  console.log(`Wikidata cross-reference${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`${total} artworks with named artists, processing ${Math.min(limit, total)}`);
  console.log(`Artist cache will deduplicate lookups`);

  // Get unique artists first to estimate API calls
  const uniqueAuthors = await db.collection('books').distinct('author', query);
  console.log(`${uniqueAuthors.length} unique artists → ~${uniqueAuthors.length * 2} Wikidata API calls\n`);

  const cursor = db.collection('books').find(query, {
    projection: { title: 1, author: 1, 'enrichment.ulan_artist': 1 },
  }).limit(limit);

  let processed = 0, matched = 0, ulanCorrected = 0, skipped = 0;

  for await (const book of cursor) {
    processed++;
    const artistData = await lookupArtist(book.author);

    if (!artistData) {
      skipped++;
    } else {
      matched++;

      // Check if ULAN differs from AI-inferred
      const aiUlan = book.enrichment?.ulan_artist;
      if (aiUlan && artistData.ulan_id && String(aiUlan) !== String(artistData.ulan_id)) {
        ulanCorrected++;
        if (ulanCorrected <= 10) {
          console.log(`  ULAN correction: ${book.author} — AI:${aiUlan} → Wikidata:${artistData.ulan_id}`);
        }
      }

      if (!DRY_RUN) {
        const update = {
          wikidata_artist: {
            qid: artistData.wikidata_id,
            label: artistData.wikidata_label,
            description: artistData.wikidata_description,
            ulan_id: artistData.ulan_id,
            rkd_id: artistData.rkd_id,
            viaf_id: artistData.viaf_id,
            loc_id: artistData.loc_id,
            british_museum_id: artistData.british_museum_id,
            birth_date: artistData.birth_date,
            death_date: artistData.death_date,
            verified_at: new Date(),
          },
          'field_provenance.wikidata_artist': {
            source: 'wikidata',
            date: new Date(),
            confidence: 'high',
            script: 'wikidata-artwork-crossref.mjs',
          },
          updated_at: new Date(),
        };

        // If Wikidata has a verified ULAN and it differs from AI, correct it
        if (artistData.ulan_id) {
          update['enrichment.ulan_artist_verified'] = parseInt(artistData.ulan_id);
          update['field_provenance.ulan_artist'] = {
            source: 'wikidata',
            date: new Date(),
            confidence: 'high',
            note: aiUlan && String(aiUlan) !== String(artistData.ulan_id)
              ? `Corrected from AI-inferred ${aiUlan}`
              : 'Verified via Wikidata',
          };
        }

        await db.collection('books').updateOne({ _id: book._id }, { $set: update });
      }
    }

    if (processed % 500 === 0 || processed === Math.min(limit, total)) {
      console.log(`  ${processed}/${Math.min(limit, total)} — ${matched} matched, ${skipped} no match, ${ulanCorrected} ULAN corrected | ${artistCache.size} cached artists`);
    }
  }

  console.log(`\nDone. ${matched} matched, ${skipped} no match, ${ulanCorrected} ULAN IDs corrected.`);
  console.log(`${artistCache.size} unique artists looked up.`);
  await client.close();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
