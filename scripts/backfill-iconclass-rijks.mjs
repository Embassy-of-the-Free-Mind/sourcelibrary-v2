#!/usr/bin/env node
/**
 * Backfill Iconclass codes for Rijksmuseum artworks from Linked Art data.
 * FREE — no AI calls, just fetching structured data from Rijksmuseum's API.
 *
 * The Rijksmuseum stores Iconclass codes in VisualItem.represents_instance_of_type.
 * We extract them and write to enrichment.iconclass.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-iconclass-rijks.mjs [--dry-run] [--limit 50]
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '2000');
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org)';
const DELAY_MS = 200;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/ld+json' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.json();
      if (res.status === 429 || res.status === 503) {
        await sleep((attempt + 1) * 5000);
        continue;
      }
      return null;
    } catch {
      await sleep(2000);
    }
  }
  return null;
}

function extractIconclassCodes(visualItem) {
  const codes = [];
  const reps = Array.isArray(visualItem.represents_instance_of_type)
    ? visualItem.represents_instance_of_type
    : [];
  for (const rep of reps) {
    const equivs = Array.isArray(rep.equivalent) ? rep.equivalent : [];
    for (const eq of equivs) {
      const id = typeof eq === 'string' ? eq : eq?.id;
      if (id && id.includes('iconclass.org/')) {
        const code = id.split('iconclass.org/')[1];
        if (code) codes.push(decodeURIComponent(code));
      }
    }
  }
  return codes;
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  // Find Rijksmuseum artworks without iconclass codes
  const artworks = await db.collection('books')
    .find({
      'image_source.provider': 'rijksmuseum',
      $or: [
        { 'enrichment.iconclass': { $exists: false } },
        { 'enrichment.iconclass': { $size: 0 } },
      ],
    }, {
      projection: {
        _id: 1, id: 1, slug: 1, title: 1, author: 1,
        'image_source.identifier': 1, 'image_source.source_url': 1,
        'linked_art.rijksmuseum_id': 1,
      },
    })
    .limit(LIMIT)
    .toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}Processing ${artworks.length} Rijksmuseum artworks\n`);

  let success = 0, noVisualItem = 0, noCodes = 0, errors = 0;

  for (let i = 0; i < artworks.length; i++) {
    const art = artworks[i];
    const label = `[${i + 1}/${artworks.length}] ${art.author} — ${(art.title || '').substring(0, 50)}`;

    try {
      // Reconstruct the Rijksmuseum object URL
      // linked_art.rijksmuseum_id is the full URL, or we derive from identifier
      let objectUrl = art.linked_art?.rijksmuseum_id;
      if (!objectUrl) {
        // identifier is like "rijks-RP-P-OB-123", extract the object number
        const identifier = art.image_source?.identifier || '';
        const objNum = identifier.replace('rijks-', '');
        if (!objNum) {
          console.log(`${label} — SKIP: no identifier`);
          errors++;
          continue;
        }
        // We need the numeric ID from the source_url or linked_art
        // Try source_url which should be the web URL
        objectUrl = art.image_source?.source_url;
      }

      if (!objectUrl) {
        console.log(`${label} — SKIP: no object URL`);
        errors++;
        continue;
      }

      // If objectUrl is a web URL, convert to API URL
      // https://www.rijksmuseum.nl/en/collection/RP-P-1234 -> need numeric ID
      // Best approach: fetch the object and follow shows -> visual item
      let apiUrl = objectUrl;
      if (!apiUrl.includes('id.rijksmuseum.nl')) {
        // Try to construct from the search
        console.log(`${label} — SKIP: non-API URL: ${objectUrl}`);
        noVisualItem++;
        continue;
      }

      // Fetch the object to get the visual item URL
      await sleep(DELAY_MS);
      const obj = await fetchJson(apiUrl);
      if (!obj) {
        console.log(`${label} — SKIP: couldn't fetch object`);
        errors++;
        continue;
      }

      const shows = Array.isArray(obj.shows) ? obj.shows : [obj.shows].filter(Boolean);
      const visualItemUrl = shows[0]?.id;
      if (!visualItemUrl) {
        noVisualItem++;
        continue;
      }

      // Fetch visual item
      await sleep(DELAY_MS);
      const vi = await fetchJson(visualItemUrl);
      if (!vi) {
        errors++;
        continue;
      }

      const codes = extractIconclassCodes(vi);
      if (codes.length === 0) {
        noCodes++;
        continue;
      }

      console.log(`${label} — ${codes.join(', ')}`);
      success++;

      if (!DRY_RUN) {
        await db.collection('books').updateOne(
          { _id: art._id },
          {
            $set: {
              'enrichment.iconclass': codes,
              'enrichment.iconclass_source': 'rijksmuseum',
              updated_at: new Date(),
            },
          }
        );
      }
    } catch (err) {
      console.log(`${label} — ERROR: ${err.message}`);
      errors++;
      if (err.message?.includes('429')) {
        console.log('  Rate limited — waiting 30s...');
        await sleep(30000);
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`Success: ${success}`);
  console.log(`No visual item: ${noVisualItem}`);
  console.log(`No Iconclass codes: ${noCodes}`);
  console.log(`Errors: ${errors}`);
  console.log(`Total: ${artworks.length}`);

  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
