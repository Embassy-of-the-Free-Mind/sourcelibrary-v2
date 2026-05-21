#!/usr/bin/env node

/**
 * Tag source-provider rows in the `tenants` collection with `kind: 'source'`.
 *
 * Context: 30+ rows in `tenants` (internet-archive, gallica, bodleian, …) were
 * created to support `/libraries/{slug}` and per-source views. They are not
 * real partitions — their books are part of the global catalog and they have
 * no admin users. This script tags them so the proxy can stop resolving them
 * as tenants (see issue #1905).
 *
 * Real tenants (bph, kloss-collection) and the route-scaffolding row (default)
 * are NOT modified — they remain without a `kind` field.
 *
 * Defaults to dry-run. Pass --apply to write changes.
 *
 * Usage:
 *   node scripts/maintenance/tag-source-provider-tenants.mjs \
 *     --mongo-uri "$MONGODB_URI" --db bookstore
 *
 *   # Apply mode:
 *   node scripts/maintenance/tag-source-provider-tenants.mjs --apply
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

// The 29 source-provider slugs to demote. Sourced from
// scripts/maintenance/create-all-provider-tenants.mjs (LIBRARY_PARTNERS),
// excluding kloss-collection (real tenant) and adding nothing else.
const SOURCE_PROVIDER_SLUGS = [
  'internet-archive',
  'gallica',
  'bavarian-state-library',
  'bodleian',
  'cambridge',
  'e-rara',
  'wellcome-collection',
  'hab-wolfenbuettel',
  'vatican-library',
  'google-books',
  'hathi-trust',
  'europeana',
  'manchester',
  'allard-pierson',
  'laurenziana',
  'leiden',
  'e-codices',
  'chester-beatty',
  'ndl-japan',
  'library-of-congress',
  'british-library',
  'sbb-berlin',
  'austrian-national-library',
  'yale-beinecke',
  'harvard-houghton',
  'penn-schoenberg',
  'huntington',
  'getty',
  'kyoto',
];

// Belt + suspenders: these must NEVER be tagged as 'source'.
const PROTECTED_SLUGS = new Set(['bph', 'kloss-collection', 'default']);

function parseArgs(argv) {
  const args = {
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
    apply: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--mongo-uri' && next) { args.mongoUri = next.trim(); i += 1; }
    else if (a === '--db' && next) { args.dbName = next.trim(); i += 1; }
    else if (a === '--apply') { args.apply = true; }
  }
  return args;
}

function assertInputs({ mongoUri, dbName }) {
  if (!mongoUri) throw new Error('Missing Mongo URI. Set MONGODB_URI or pass --mongo-uri');
  if (!dbName) throw new Error('Missing DB name. Set DB_NAME or pass --db');
}

async function main() {
  const args = parseArgs(process.argv);
  assertInputs(args);
  const { mongoUri, dbName, apply } = args;

  // Sanity: don't allow accidental tagging of a real tenant.
  for (const slug of SOURCE_PROVIDER_SLUGS) {
    if (PROTECTED_SLUGS.has(slug)) {
      throw new Error(`Refusing to run: ${slug} is in PROTECTED_SLUGS but appears in SOURCE_PROVIDER_SLUGS.`);
    }
  }

  const client = new MongoClient(mongoUri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 15000,
  });

  console.log('Tag source-provider tenants');
  console.log(`Mode         : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`DB           : ${dbName}`);
  console.log(`Candidates   : ${SOURCE_PROVIDER_SLUGS.length}`);
  console.log('---');

  await client.connect();
  const db = client.db(dbName);
  const tenants = db.collection('tenants');

  const existing = await tenants
    .find(
      { slug: { $in: SOURCE_PROVIDER_SLUGS }, status: { $ne: 'deleted' } },
      { projection: { slug: 1, name: 1, kind: 1, status: 1 } }
    )
    .toArray();

  const existingSlugs = new Set(existing.map((r) => r.slug));
  const missing = SOURCE_PROVIDER_SLUGS.filter((s) => !existingSlugs.has(s));

  console.log(`Found in DB  : ${existing.length}`);
  console.log(`Missing      : ${missing.length}`);
  if (missing.length > 0) {
    console.log(`             : ${missing.join(', ')}`);
  }
  console.log('---');

  const alreadyTagged = existing.filter((r) => r.kind === 'source');
  const toTag = existing.filter((r) => r.kind !== 'source');

  console.log(`Already tagged kind='source' : ${alreadyTagged.length}`);
  console.log(`Will tag                     : ${toTag.length}`);
  console.log('');
  for (const row of toTag) {
    console.log(`  - ${row.slug.padEnd(28)} (${row.name})  current kind=${row.kind ?? '<unset>'}`);
  }

  // Audit: which real-tenant rows are present?
  const protectedRows = await tenants
    .find(
      { slug: { $in: [...PROTECTED_SLUGS] }, status: { $ne: 'deleted' } },
      { projection: { slug: 1, name: 1, kind: 1 } }
    )
    .toArray();
  console.log('');
  console.log('Protected rows (will NOT be modified):');
  for (const row of protectedRows) {
    console.log(`  - ${row.slug.padEnd(28)} (${row.name})  current kind=${row.kind ?? '<unset>'}`);
  }

  if (toTag.length === 0) {
    console.log('\nNo changes needed.');
    await client.close();
    return;
  }

  if (!apply) {
    console.log('\n---');
    console.log('Dry-run completed. Re-run with --apply to persist changes.');
    await client.close();
    return;
  }

  console.log('\n---');
  console.log('Applying changes...');
  const slugsToTag = toTag.map((r) => r.slug);
  const result = await tenants.updateMany(
    {
      slug: { $in: slugsToTag, $nin: [...PROTECTED_SLUGS] },
    },
    { $set: { kind: 'source' } }
  );
  console.log(`Matched      : ${result.matchedCount}`);
  console.log(`Modified     : ${result.modifiedCount}`);

  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
