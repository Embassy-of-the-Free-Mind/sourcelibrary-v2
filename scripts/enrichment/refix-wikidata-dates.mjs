#!/usr/bin/env node

/**
 * Re-fetch birth/death dates from Wikidata for all entities that have dates.
 *
 * The original wikidata-align.mjs and backfill-wikidata-dates.mjs had a bug
 * where BCE dates lost their negative sign (e.g., -0384 became 0384).
 * This script re-fetches P569/P570 for every entity with dates and writes
 * the corrected values (with proper - prefix for BCE).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/refix-wikidata-dates.mjs
 *
 * Options:
 *   --dry-run       Show what would be done without writing
 *   --limit=N       Max entities to process
 */

import { MongoClient } from 'mongodb';

const args = Object.fromEntries(
  process.argv.slice(2).map(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const DRY_RUN = args['dry-run'] === 'true';
const LIMIT = args.limit ? parseInt(args.limit) : Infinity;
const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function apiFetch(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

function formatWikidataDate(time, precision) {
  const isBCE = time.startsWith('-');
  const dateStr = time.replace(/^[+-]/, '').replace(/T.*$/, '');
  const parts = dateStr.split('-');
  const prefix = isBCE ? '-' : '';
  if (precision >= 11) return prefix + dateStr;
  if (precision === 10) return `${prefix}${parts[0]}-${parts[1]}`;
  return prefix + parts[0];
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const entities = db.collection('entities');

  // Find all entities with a Wikidata ID and at least one date
  const query = {
    wikidata_id: { $exists: true, $ne: null },
    $or: [
      { wikidata_birth_date: { $exists: true, $ne: null } },
      { wikidata_death_date: { $exists: true, $ne: null } },
    ],
  };

  const toProcess = await entities.find(query)
    .sort({ book_count: -1 })
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .project({ name: 1, wikidata_id: 1, wikidata_birth_date: 1, wikidata_death_date: 1, book_count: 1 })
    .toArray();

  console.log(`Found ${toProcess.length} entities with dates to re-check`);
  if (DRY_RUN) console.log('(dry run)');

  let updated = 0, unchanged = 0, cleared = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const e = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      const updates = {};
      let newBirth = null;
      let newDeath = null;

      // Birth date (P569)
      const birthData = await apiFetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${e.wikidata_id}&property=P569&format=json`
      );
      const birthClaim = birthData.claims?.P569?.[0];
      if (birthClaim?.mainsnak?.datavalue?.value?.time) {
        newBirth = formatWikidataDate(
          birthClaim.mainsnak.datavalue.value.time,
          birthClaim.mainsnak.datavalue.value.precision
        );
      }

      await sleep(100);

      // Death date (P570)
      const deathData = await apiFetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${e.wikidata_id}&property=P570&format=json`
      );
      const deathClaim = deathData.claims?.P570?.[0];
      if (deathClaim?.mainsnak?.datavalue?.value?.time) {
        newDeath = formatWikidataDate(
          deathClaim.mainsnak.datavalue.value.time,
          deathClaim.mainsnak.datavalue.value.precision
        );
      }

      // Check what changed
      const oldBirth = e.wikidata_birth_date || null;
      const oldDeath = e.wikidata_death_date || null;

      if (newBirth !== oldBirth) updates.wikidata_birth_date = newBirth;
      if (newDeath !== oldDeath) updates.wikidata_death_date = newDeath;

      if (Object.keys(updates).length > 0) {
        const setFields = {};
        const unsetFields = {};

        for (const [k, v] of Object.entries(updates)) {
          if (v === null) unsetFields[k] = '';
          else setFields[k] = v;
        }
        setFields.updated_at = new Date();

        const op = {};
        if (Object.keys(setFields).length > 0) op.$set = setFields;
        if (Object.keys(unsetFields).length > 0) op.$unset = unsetFields;

        if (!DRY_RUN) {
          await entities.updateOne({ _id: e._id }, op);
        }

        const changes = Object.entries(updates)
          .map(([k, v]) => {
            const field = k.replace('wikidata_', '');
            const old = k === 'wikidata_birth_date' ? oldBirth : oldDeath;
            return `${field}: ${old} → ${v}`;
          })
          .join(', ');

        console.log(`  ${progress} ${e.name}: ${changes}`);
        updated++;
      } else {
        unchanged++;
        if (i < 10 || i % 100 === 0) {
          console.log(`  ${progress} ${e.name}: unchanged (${oldBirth || '-'}/${oldDeath || '-'})`);
        }
      }

      await sleep(200); // Rate limit
    } catch (err) {
      console.error(`  ${progress} ${e.name}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Updated: ${updated}, Unchanged: ${unchanged}, Cleared: ${cleared}, Errors: ${errors}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
