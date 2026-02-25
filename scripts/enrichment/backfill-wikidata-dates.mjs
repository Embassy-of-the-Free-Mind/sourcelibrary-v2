#!/usr/bin/env node

/**
 * Backfill birth/death dates from Wikidata for person entities.
 *
 * Fixes the P569|P570 bug in wikidata-align.mjs where the pipe-separated
 * property query silently failed. Now fetches each property individually.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/enrichment/backfill-wikidata-dates.mjs
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
  const dateStr = time.replace(/^[+-]/, '').replace(/T.*$/, '');
  const parts = dateStr.split('-');
  if (precision >= 11) return dateStr;
  if (precision === 10) return `${parts[0]}-${parts[1]}`;
  return parts[0];
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const entities = db.collection('entities');

  // Find person entities with QID but no birth/death dates
  const query = {
    type: 'person',
    wikidata_id: { $exists: true },
    $and: [
      { $or: [{ wikidata_birth_date: { $exists: false } }, { wikidata_birth_date: null }] },
      { $or: [{ wikidata_death_date: { $exists: false } }, { wikidata_death_date: null }] },
    ],
  };

  const toProcess = await entities.find(query)
    .sort({ book_count: -1 })
    .limit(LIMIT === Infinity ? 0 : LIMIT)
    .project({ name: 1, wikidata_id: 1, book_count: 1 })
    .toArray();

  console.log(`Found ${toProcess.length} person entities with QID but no dates`);
  if (DRY_RUN) console.log('(dry run)');

  let updated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const e = toProcess[i];
    const progress = `[${i + 1}/${toProcess.length}]`;

    try {
      const props = {};

      // Birth date (P569)
      const birthData = await apiFetch(
        `https://www.wikidata.org/w/api.php?action=wbgetclaims&entity=${e.wikidata_id}&property=P569&format=json`
      );
      const birthClaim = birthData.claims?.P569?.[0];
      if (birthClaim?.mainsnak?.datavalue?.value?.time) {
        props.wikidata_birth_date = formatWikidataDate(
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
        props.wikidata_death_date = formatWikidataDate(
          deathClaim.mainsnak.datavalue.value.time,
          deathClaim.mainsnak.datavalue.value.precision
        );
      }

      if (Object.keys(props).length > 0) {
        if (!DRY_RUN) {
          await entities.updateOne({ _id: e._id }, { $set: { ...props, updated_at: new Date() } });
        }
        console.log(`  ${progress} ${e.name}: ${JSON.stringify(props)}`);
        updated++;
      } else {
        if (i < 20 || i % 50 === 0) console.log(`  ${progress} ${e.name}: no dates on Wikidata`);
        skipped++;
      }

      await sleep(200); // Rate limit
    } catch (err) {
      console.error(`  ${progress} ${e.name}: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n=== Done ===`);
  console.log(`Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);

  await client.close();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
