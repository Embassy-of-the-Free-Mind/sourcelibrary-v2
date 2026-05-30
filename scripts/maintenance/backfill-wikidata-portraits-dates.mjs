/**
 * Backfill Wikidata enrichment on author/artist `entities`:
 *   - portrait_url : re-resolve P18 to a CSP-safe upload.wikimedia.org URL
 *                    (the old code cached commons.wikimedia.org/w/thumb.php
 *                    URLs, which the site CSP img-src blocks in browsers)
 *   - wikidata_birth_date / wikidata_death_date : P569 / P570
 *
 * Targets any entity with a wikidata_id that is missing a date OR whose
 * portrait_url points at the blocked commons.wikimedia.org domain. The page
 * render path (src/lib/wikidata-enrichment.ts) self-heals these lazily too —
 * this script just does it eagerly so cached/CDN pages get fixed dates.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; \
 *   node scripts/maintenance/backfill-wikidata-portraits-dates.mjs [--limit N] [--dry]
 */
import { MongoClient } from 'mongodb';

const DRY = process.argv.includes('--dry');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

const UA = 'sourcelibrary-entity-enrichment/1.0 (https://sourcelibrary.org)';

function normaliseTime(time) {
  if (!time) return null;
  const m = time.match(/^\+?(-?\d{1,4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function resolvePortrait(filename) {
  const url =
    `https://commons.wikimedia.org/w/api.php?action=query&format=json` +
    `&titles=${encodeURIComponent(`File:${filename}`)}` +
    `&prop=imageinfo&iiprop=url&iiurlwidth=300`;
  const data = await fetchJson(url);
  const page = Object.values(data?.query?.pages || {})[0];
  const info = page?.imageinfo?.[0];
  const resolved = info?.thumburl || info?.url || null;
  return resolved && resolved.includes('upload.wikimedia.org') ? resolved : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const uri = process.env.MONGODB_URI || process.env.MONGODB_ATLAS_URI;
const client = new MongoClient(uri);
await client.connect();
const entities = client.db('bookstore').collection('entities');

const query = {
  type: 'person',
  wikidata_id: { $exists: true, $ne: null },
  $or: [
    { wikidata_birth_date: { $exists: false } },
    { wikidata_birth_date: null },
    { portrait_url: /commons\.wikimedia\.org/ },
  ],
};

const total = await entities.countDocuments(query);
console.log(`${total} entities need enrichment${DRY ? ' (dry run)' : ''}; processing up to ${LIMIT === Infinity ? 'all' : LIMIT}`);

const cursor = entities.find(query, {
  projection: { wikidata_id: 1, portrait_url: 1, wikidata_birth_date: 1, wikidata_death_date: 1 },
});

let processed = 0, portraitsFixed = 0, datesFixed = 0, errors = 0;
for await (const ent of cursor) {
  if (processed >= LIMIT) break;
  processed++;
  try {
    const data = await fetchJson(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${ent.wikidata_id}&props=claims&format=json`,
    );
    const claims = data?.entities?.[ent.wikidata_id]?.claims;
    if (!claims) continue;

    const set = {};

    const portraitBad = !ent.portrait_url || ent.portrait_url.includes('commons.wikimedia.org');
    if (portraitBad) {
      const filename = claims?.P18?.[0]?.mainsnak?.datavalue?.value;
      if (filename) {
        const url = await resolvePortrait(filename);
        if (url && url !== ent.portrait_url) { set.portrait_url = url; portraitsFixed++; }
      }
    }

    const birth = normaliseTime(claims?.P569?.[0]?.mainsnak?.datavalue?.value?.time);
    const death = normaliseTime(claims?.P570?.[0]?.mainsnak?.datavalue?.value?.time);
    if (birth && birth !== ent.wikidata_birth_date) { set.wikidata_birth_date = birth; datesFixed++; }
    if (death && death !== ent.wikidata_death_date) set.wikidata_death_date = death;

    if (Object.keys(set).length > 0 && !DRY) {
      await entities.updateOne({ _id: ent._id }, { $set: set });
    }
    if (processed % 100 === 0) {
      console.log(`  ${processed}/${Math.min(total, LIMIT)} — portraits:${portraitsFixed} dates:${datesFixed} errors:${errors}`);
    }
    await sleep(120); // be polite to Wikidata/Commons
  } catch (err) {
    errors++;
    if (errors <= 10) console.warn(`  ! ${ent.wikidata_id}: ${err.message}`);
  }
}

console.log(`Done. processed:${processed} portraitsFixed:${portraitsFixed} datesFixed:${datesFixed} errors:${errors}`);
await client.close();
