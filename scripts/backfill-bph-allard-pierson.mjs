#!/usr/bin/env node
/**
 * Backfill: create bph_works rows for the Allard Pierson IIIF batch.
 *
 * Why: 104 MongoDB books are BPH manuscripts that live physically/digitally
 * with the Allard Pierson (University of Amsterdam) collection. Their
 * dublin_core.dc_identifier is the IIIF manifest URL
 *   ["IIIF:https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_<n>/manifest/"]
 * not a numeric BPH UBN. They never appear in `bph_works`, so they vanish
 * from the catalogue's list view even though they show up in the cover
 * grid (which queries MongoDB directly).
 *
 * The partner asked: "include all the Allard Pierson BPH books in the
 * digitised BPH" — so they belong in the same catalogue as printed books.
 *
 * Strategy: synthesise a bph_works row per AP manuscript, keying on the
 * BPH-internal shelfmark (e.g. "PH441" — stored in MongoDB at
 * image_source.shelfmark). The shelfmark goes into `ubn` because it's the
 * stable BPH catalogue key for that manuscript; the Allard Pierson record
 * id (`11245_3_<n>`) is recorded in `field_provenance` so we can trace
 * back to the source. Sets sl_book_id / sl_book_slug at the same time
 * so the row participates in the existing "digitised" filter immediately.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/backfill-bph-allard-pierson.mjs --dry-run
 *   node scripts/backfill-bph-allard-pierson.mjs
 *
 * Idempotent: upserts on ubn, so re-running refreshes title/author/year/
 * sl_book_id values for any AP book whose MongoDB record has changed.
 *
 * Out of scope:
 *   - The 142 MongoDB books with no dc_identifier at all (need title/author
 *     fuzzy matching against bph_works).
 *   - The 51 duplicate-MongoDB-book collisions on shared numeric UBNs.
 *   Both are tracked separately.
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY env var required');
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error('MONGODB_URI env var required');
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  Authorization: `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'resolution=merge-duplicates,return=representation',
};

function extractApRecordId(dcIdentifier) {
  // "IIIF:https://uvaerfgoed.nl/viewer/api/v1/records/11245_3_39924/manifest/"
  const re = /uvaerfgoed\.nl\/viewer\/api\/v\d+\/records\/([^/]+)\/manifest/;
  const test = (v) => (typeof v === 'string' ? v.match(re)?.[1] : null);
  if (Array.isArray(dcIdentifier)) {
    for (const v of dcIdentifier) {
      const m = test(v);
      if (m) return m;
    }
  } else {
    const m = test(dcIdentifier);
    if (m) return m;
  }
  return null;
}

function normaliseShelfmark(s) {
  // PH-shelfmarks observed: "PH441", "PH410 A-C", "PH3335"
  if (typeof s !== 'string') return null;
  return s.trim() || null;
}

async function main() {
  const mongo = new MongoClient(MONGODB_URI);
  await mongo.connect();
  const db = mongo.db('bookstore');

  const tenant = await db.collection('tenants').findOne({ slug: 'bph' });
  if (!tenant?.id) {
    console.error('BPH tenant not found');
    process.exit(1);
  }

  const cursor = db.collection('books').find(
    {
      tenantId: tenant.id,
      visible: true,
      pages_count: { $gt: 0 },
      'image_source.provider': 'bph',
      'dublin_core.dc_identifier': { $regex: '^IIIF:https://uvaerfgoed\\.nl' },
    },
    {
      projection: {
        id: 1, slug: 1, title: 1, author: 1, year: 1, language: 1, pages_count: 1,
        'dublin_core.dc_identifier': 1,
        'image_source.shelfmark': 1,
        'image_source.iiif_manifest': 1,
        'image_source.source_url': 1,
        'image_source.contributing_library': 1,
        'image_source.digitized_by': 1,
      },
    },
  );
  const apBooks = await cursor.toArray();
  console.log(`Found ${apBooks.length} Allard Pierson MongoDB books.\n`);

  let prepared = 0;
  let skippedNoShelfmark = 0;
  let collisions = 0;
  const rows = [];
  const seenUbns = new Set();
  const seenSamples = [];

  for (const b of apBooks) {
    const ubn = normaliseShelfmark(b?.image_source?.shelfmark);
    if (!ubn) {
      skippedNoShelfmark++;
      continue;
    }
    if (seenUbns.has(ubn)) {
      collisions++;
      console.warn(`  ! duplicate PH-shelfmark "${ubn}" within MongoDB AP set (book ${b.id}) — skipping`);
      continue;
    }
    seenUbns.add(ubn);

    const apRecordId = extractApRecordId(b?.dublin_core?.dc_identifier);

    const row = {
      ubn,
      title: b.title || null,
      author: b.author || null,
      year: typeof b.year === 'number' ? b.year : null,
      language: b.language || null,
      shelf_mark: ubn,
      number_of_copies: 1,
      work_status: 'avail',
      present_location: 'Allard Pierson (University of Amsterdam)',
      sl_book_id: b.id,
      sl_book_slug: b.slug || b.id,
      file_count: typeof b.pages_count === 'number' ? b.pages_count : null,
      field_provenance: {
        source: { source: 'allard_pierson_iiif', evidence: 'mongodb-backfill' },
        title: { source: 'mongodb', evidence: `books.id=${b.id}` },
        author: { source: 'mongodb', evidence: `books.id=${b.id}` },
        year: { source: 'mongodb', evidence: `books.id=${b.id}` },
        shelf_mark: { source: 'mongodb_image_source_shelfmark', evidence: `books.id=${b.id}` },
        present_location: { source: 'allard_pierson_iiif' },
        sl_book_id: { source: 'mongodb', evidence: `books.id=${b.id}` },
        ap_record_id: apRecordId ? { source: 'iiif_manifest_url', evidence: apRecordId } : undefined,
      },
    };
    rows.push(row);
    prepared++;
    if (seenSamples.length < 3) seenSamples.push(row);
  }

  console.log(`Prepared rows: ${prepared}`);
  console.log(`Skipped (no PH-shelfmark in image_source.shelfmark): ${skippedNoShelfmark}`);
  console.log(`Collisions inside the MongoDB AP set: ${collisions}\n`);
  if (seenSamples.length > 0) {
    console.log('Sample row to insert:');
    console.log(JSON.stringify(seenSamples[0], null, 2));
    console.log('');
  }

  if (DRY_RUN) {
    console.log('--dry-run set — not writing to Supabase.');
    await mongo.close();
    return;
  }

  // Upsert in chunks of 100 so a single failure only loses one chunk.
  let upserted = 0;
  let failed = 0;
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await fetch(`${SUPABASE_URL}/rest/v1/bph_works?on_conflict=ubn`, {
      method: 'POST',
      headers,
      body: JSON.stringify(chunk),
    });
    if (!res.ok) {
      failed += chunk.length;
      console.error(`Chunk ${i}: HTTP ${res.status}: ${await res.text()}`);
      continue;
    }
    const body = await res.json();
    upserted += Array.isArray(body) ? body.length : chunk.length;
    console.log(`  Upserted ${i + chunk.length}/${rows.length}`);
  }

  console.log(`\nDone. Upserted=${upserted}  Failed=${failed}`);
  await mongo.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
