#!/usr/bin/env node
/**
 * Backfill bph_works.sl_book_id (and sl_book_slug) from MongoDB.
 *
 * Why: the BPH catalogue UI uses `digitized=sl` to filter to BPH works that
 * have an SL book. The API query is `WHERE sl_book_id IS NOT NULL`, but that
 * column was never populated — the digitised set lives in MongoDB
 * (image_source.provider='bph' with dublin_core.dc_identifier == UBN).
 * Without this backfill, "Show digitised & translated" in the list view is
 * empty for every search.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   SUPABASE_SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY ~/vibecodingevents/.env.local | cut -d= -f2)
 *   node scripts/backfill-bph-sl-book-ids.mjs --dry-run
 *   node scripts/backfill-bph-sl-book-ids.mjs
 *
 * Idempotent: runs PATCH … WHERE ubn = UBN. Re-running just refreshes slug
 * values for any books that were renamed since the last run.
 *
 * Scope:
 *   - Only books where image_source.provider='bph' AND dublin_core.dc_identifier
 *     is a plain numeric string (the BPH catalogue UBN format).
 *   - Books imported via IIIF where dc_identifier is `["IIIF:https://…"]` are
 *     not linkable to a UBN by this script (104 books at last count). They
 *     need a separate IIIF-URL → UBN resolution step, out of scope here.
 */

import { MongoClient } from 'mongodb';

const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const MONGODB_URI = process.env.MONGODB_URI;
const DRY_RUN = process.argv.includes('--dry-run');
const PARALLEL = 10;

if (!SUPABASE_KEY) {
  console.error('SUPABASE_SERVICE_KEY env var required (use Supabase service-role key)');
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
  Prefer: 'return=minimal',
};

function extractUbn(dcIdentifier) {
  // UBN format observed in BPH catalogue: short numeric string (4-6 digits).
  if (typeof dcIdentifier === 'string' && /^\d+$/.test(dcIdentifier)) return dcIdentifier;
  if (Array.isArray(dcIdentifier)) {
    for (const v of dcIdentifier) {
      if (typeof v === 'string' && /^\d+$/.test(v)) return v;
    }
  }
  return null;
}

async function main() {
  const client = new MongoClient(MONGODB_URI, {
    socketTimeoutMS: 120_000,
    serverSelectionTimeoutMS: 30_000,
  });
  await client.connect();
  const db = client.db('bookstore');

  console.log('Loading BPH books with dc_identifier from MongoDB…');
  // `bph_catalog_link: false` opts a book out of the catalog link, matching
  // the cron at src/app/api/cron/sync-bph-sl-book-ids/route.ts.
  const docs = await db
    .collection('books')
    .find(
      {
        'image_source.provider': 'bph',
        'dublin_core.dc_identifier': { $exists: true, $ne: '' },
        bph_catalog_link: { $ne: false },
      },
      { projection: { id: 1, slug: 1, 'dublin_core.dc_identifier': 1 } }
    )
    .toArray();

  const linkable = [];
  let skippedNoUbn = 0;
  for (const d of docs) {
    const ubn = extractUbn(d.dublin_core?.dc_identifier);
    if (!ubn) {
      skippedNoUbn++;
      continue;
    }
    linkable.push({ ubn, id: d.id, slug: d.slug || d.id });
  }
  console.log(`  ${docs.length} BPH books in MongoDB`);
  console.log(`  ${linkable.length} linkable via numeric UBN`);
  console.log(`  ${skippedNoUbn} skipped (non-UBN dc_identifier — typically IIIF-import books)`);
  console.log('');

  if (DRY_RUN) {
    console.log('DRY RUN — first 5 updates that would be issued:');
    for (const x of linkable.slice(0, 5)) {
      console.log(`  ubn=${x.ubn} → sl_book_id=${x.id} sl_book_slug=${x.slug}`);
    }
    await client.close();
    return;
  }

  let updated = 0;
  let notFound = 0;
  let failed = 0;
  const errors = [];

  for (let i = 0; i < linkable.length; i += PARALLEL) {
    const chunk = linkable.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(
      chunk.map(async (row) => {
        const url = `${SUPABASE_URL}/rest/v1/bph_works?ubn=eq.${encodeURIComponent(row.ubn)}`;
        const res = await fetch(url, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=representation' },
          body: JSON.stringify({ sl_book_id: row.id, sl_book_slug: row.slug }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${await res.text()}`);
        }
        const body = await res.json();
        return Array.isArray(body) ? body.length : 0;
      })
    );

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled') {
        if (r.value > 0) updated++;
        else notFound++;
      } else {
        failed++;
        if (errors.length < 10) errors.push(`ubn=${chunk[j].ubn}: ${r.reason.message}`);
      }
    }

    if ((i + PARALLEL) % 200 === 0 || i + PARALLEL >= linkable.length) {
      process.stdout.write(
        `\r  progress: ${Math.min(i + PARALLEL, linkable.length)} / ${linkable.length}  (updated=${updated} not-in-bph_works=${notFound} failed=${failed})`
      );
    }
  }
  console.log('\n');
  console.log(`Done. updated=${updated}, not-in-bph_works=${notFound}, failed=${failed}`);
  if (errors.length > 0) {
    console.log('\nFirst errors:');
    for (const e of errors) console.log('  ' + e);
  }

  await client.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
