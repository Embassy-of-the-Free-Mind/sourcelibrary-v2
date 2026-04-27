#!/usr/bin/env node

/**
 * One-time migration script: production DB -> local multi-tenant test DB
 *
 * What it does:
 * - Migrates up to 10 documents per configured collection from PROD to LOCAL DB.
 * - Skips collections that are already present in your local DB seed.
 * - For tenant-scoped collections, forces tenantId assignment in a 60/40 split.
 * - Uses replaceOne({ _id }, ..., { upsert: true }) so reruns are idempotent.
 *
 * Run:
 *   node scripts/one-off/migrate-prod-to-local-multitenant.mjs
 */

import { MongoClient } from 'mongodb';

/*
 * ==========================================================
 * REQUIRED: Fill these values before running
 * ==========================================================
 */
const MONGO_CONNECTION_URL = '';
const PROD_DB_NAME = '';
const LOCAL_DB_NAME = '';

/*
 * Two tenant IDs to distribute tenant-scoped documents across
 * 60% -> TENANT_A_ID, 40% -> TENANT_B_ID
 */
const TENANT_A_ID = 'bce03f71-c18d-4460-b8ad-224c817f9aa0';
const TENANT_B_ID = '33f3fe82-ba7c-4b6b-b88a-d5cc14b17342';

/*
 * Collections already present locally (explicitly excluded)
 */
const EXCLUDED_COLLECTIONS = new Set([
  'tenants',
  'users',
  'memberships',
  'analytics_pageviews',
  'loading_metrics',
  'verification_tokens',
]);

/*
 * Collection migration plan
 * tenantScoped=true => inject tenantId using 60/40 split
 */
const COLLECTIONS_TO_MIGRATE = [
  { name: 'accounts', tenantScoped: false },

  { name: 'books', tenantScoped: true },
  { name: 'pages', tenantScoped: true },
  { name: 'collections', tenantScoped: true },

  { name: 'jobs', tenantScoped: true },
  { name: 'batch_jobs', tenantScoped: true },
  { name: 'analytics_events', tenantScoped: true },

  { name: 'likes', tenantScoped: true },
  { name: 'highlights', tenantScoped: true },
  { name: 'reading_history', tenantScoped: true },
  { name: 'comparisons', tenantScoped: true },

  { name: 'gallery_images', tenantScoped: true },
  { name: 'gallery_collections', tenantScoped: true },

  // Optional but useful for broader validation
  { name: 'discussions', tenantScoped: true },
  { name: 'discussion_replies', tenantScoped: true },
  { name: 'editions', tenantScoped: true },
  { name: 'purchases', tenantScoped: true },
  { name: 'api_keys', tenantScoped: true },
  { name: 'curator_sessions', tenantScoped: true },
  { name: 'deleted_books', tenantScoped: true },
  { name: 'gemini_usage', tenantScoped: true },
  { name: 'gemini_usage_daily', tenantScoped: true },
  { name: 'page_revisions', tenantScoped: true },
  { name: 'pipeline_snapshots', tenantScoped: true },
];

const DOCS_PER_COLLECTION = 10;

function validateConfig() {
  const missing = [];
  if (!MONGO_CONNECTION_URL) missing.push('MONGO_CONNECTION_URL');
  if (!PROD_DB_NAME) missing.push('PROD_DB_NAME');
  if (!LOCAL_DB_NAME) missing.push('LOCAL_DB_NAME');

  if (missing.length > 0) {
    throw new Error(`Missing required config values: ${missing.join(', ')}`);
  }

  if (!TENANT_A_ID || !TENANT_B_ID) {
    throw new Error('TENANT_A_ID and TENANT_B_ID are required.');
  }
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function applyTenantSplit(docs) {
  const cloned = docs.map((d) => ({ ...d }));
  shuffleInPlace(cloned);

  // For n=10 => 6/4 exactly. For other n, this is best-effort 60/40.
  const tenantACount = Math.floor(cloned.length * 0.6);

  return cloned.map((doc, idx) => ({
    ...doc,
    tenantId: idx < tenantACount ? TENANT_A_ID : TENANT_B_ID,
  }));
}

async function collectionExists(db, name) {
  const collections = await db.listCollections({ name }, { nameOnly: true }).toArray();
  return collections.length > 0;
}

async function migrateCollection({ prodDb, localDb, name, tenantScoped }) {
  if (EXCLUDED_COLLECTIONS.has(name)) {
    return {
      collection: name,
      status: 'skipped-excluded',
      fetched: 0,
      written: 0,
      tenantA: 0,
      tenantB: 0,
      note: 'Excluded: already present in local DB',
    };
  }

  const existsInProd = await collectionExists(prodDb, name);
  if (!existsInProd) {
    return {
      collection: name,
      status: 'skipped-missing-in-prod',
      fetched: 0,
      written: 0,
      tenantA: 0,
      tenantB: 0,
      note: 'Collection not found in PROD DB',
    };
  }

  const source = prodDb.collection(name);
  const target = localDb.collection(name);

  // Pull random sample for better test coverage
  const fetchedDocs = await source.aggregate([{ $sample: { size: DOCS_PER_COLLECTION } }]).toArray();

  if (fetchedDocs.length === 0) {
    return {
      collection: name,
      status: 'skipped-empty',
      fetched: 0,
      written: 0,
      tenantA: 0,
      tenantB: 0,
      note: 'No docs available in PROD collection',
    };
  }

  const docsToWrite = tenantScoped ? applyTenantSplit(fetchedDocs) : fetchedDocs;

  let tenantA = 0;
  let tenantB = 0;
  if (tenantScoped) {
    for (const doc of docsToWrite) {
      if (doc.tenantId === TENANT_A_ID) tenantA += 1;
      if (doc.tenantId === TENANT_B_ID) tenantB += 1;
    }
  }

  let written = 0;
  for (const doc of docsToWrite) {
    if (!doc._id) {
      // Defensive fallback: insert if _id missing
      await target.insertOne(doc);
      written += 1;
      continue;
    }

    await target.replaceOne({ _id: doc._id }, doc, { upsert: true });
    written += 1;
  }

  return {
    collection: name,
    status: 'migrated',
    fetched: fetchedDocs.length,
    written,
    tenantA,
    tenantB,
    note: tenantScoped ? 'tenantId reassigned (60/40)' : 'copied as-is',
  };
}

async function main() {
  validateConfig();

  const client = new MongoClient(MONGO_CONNECTION_URL, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });

  try {
    await client.connect();

    const prodDb = client.db(PROD_DB_NAME);
    const localDb = client.db(LOCAL_DB_NAME);

    console.log('Starting one-time migration...');
    console.log(`PROD DB  : ${PROD_DB_NAME}`);
    console.log(`LOCAL DB : ${LOCAL_DB_NAME}`);
    console.log(`Tenant A : ${TENANT_A_ID}`);
    console.log(`Tenant B : ${TENANT_B_ID}`);
    console.log(`Docs/collection target: ${DOCS_PER_COLLECTION}`);
    console.log('---');

    const results = [];

    for (const collectionConfig of COLLECTIONS_TO_MIGRATE) {
      const result = await migrateCollection({
        prodDb,
        localDb,
        name: collectionConfig.name,
        tenantScoped: collectionConfig.tenantScoped,
      });

      results.push(result);

      const ratioSuffix = collectionConfig.tenantScoped
        ? ` | tenant split ${result.tenantA}/${result.tenantB}`
        : '';

      console.log(
        `[${result.status}] ${result.collection} -> fetched=${result.fetched}, written=${result.written}${ratioSuffix}`
      );
    }

    console.log('--- Summary ---');

    let totalFetched = 0;
    let totalWritten = 0;
    for (const r of results) {
      totalFetched += r.fetched;
      totalWritten += r.written;
    }

    const migratedCount = results.filter((r) => r.status === 'migrated').length;
    const skippedCount = results.length - migratedCount;

    console.log(`Collections processed : ${results.length}`);
    console.log(`Collections migrated  : ${migratedCount}`);
    console.log(`Collections skipped   : ${skippedCount}`);
    console.log(`Total docs fetched    : ${totalFetched}`);
    console.log(`Total docs written    : ${totalWritten}`);

    console.log('\nDone.');
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
