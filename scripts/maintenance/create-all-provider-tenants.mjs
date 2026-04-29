#!/usr/bin/env node

/**
 * Create all library partner tenants in bulk.
 * 
 * Uses BPH tenant as a template for settings/pipeline configuration.
 * Skips BPH itself (already exists).
 * Creates 30 library partner tenants + 1 default tenant = 31 total.
 * 
 * Defaults to dry-run. Pass --apply to write changes.
 * 
 * Usage:
 * node scripts/maintenance/create-all-provider-tenants.mjs \
 *   --mongo-uri "$MONGODB_URI" --db bookstore
 * 
 * Apply mode:
 * node scripts/maintenance/create-all-provider-tenants.mjs \
 *   --mongo-uri "$MONGODB_URI" --db bookstore --apply
 */

import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';
import 'dotenv/config';

const LIBRARY_PARTNERS = {
  'internet-archive': { name: 'Internet Archive', providerKey: 'internet_archive' },
  'gallica': { name: 'Gallica (BnF)', providerKey: 'gallica' },
  'bavarian-state-library': { name: 'Bavarian State Library (MDZ)', providerKey: 'mdz' },
  'bodleian': { name: 'Bodleian Library', providerKey: 'bodleian' },
  'cambridge': { name: 'Cambridge Digital Library', providerKey: 'cambridge' },
  'e-rara': { name: 'e-rara', providerKey: 'e-rara' },
  'wellcome-collection': { name: 'Wellcome Collection', providerKey: 'wellcome' },
  'hab-wolfenbuettel': { name: 'Herzog August Bibliothek', providerKey: 'hab' },
  'vatican-library': { name: 'Vatican Apostolic Library', providerKey: 'vatican' },
  'google-books': { name: 'Google Books', providerKey: 'google_books' },
  'hathi-trust': { name: 'HathiTrust Digital Library', providerKey: 'hathi_trust' },
  'europeana': { name: 'Europeana', providerKey: 'europeana' },
  'manchester': { name: 'John Rylands Library', providerKey: 'manchester' },
  'allard-pierson': { name: 'Allard Pierson', providerKey: 'allard_pierson' },
  'laurenziana': { name: 'Biblioteca Medicea Laurenziana', providerKey: 'laurenziana' },
  'leiden': { name: 'Leiden University Library', providerKey: 'leiden' },
  'e-codices': { name: 'e-codices', providerKey: 'e-codices' },
  'chester-beatty': { name: 'Chester Beatty Library', providerKey: 'chester_beatty' },
  'ndl-japan': { name: 'National Diet Library of Japan', providerKey: 'ndl_japan' },
  'kloss-collection': { name: 'Kloss Collection (CMC)', providerKey: 'cmc_kloss' },
  'library-of-congress': { name: 'Library of Congress', providerKey: 'loc' },
  'british-library': { name: 'British Library', providerKey: 'bl' },
  'sbb-berlin': { name: 'Staatsbibliothek zu Berlin', providerKey: 'sbb' },
  'austrian-national-library': { name: 'Austrian National Library', providerKey: 'onb' },
  'yale-beinecke': { name: 'Yale Beinecke Library', providerKey: 'yale_beinecke' },
  'harvard-houghton': { name: 'Harvard Houghton Library', providerKey: 'harvard' },
  'penn-schoenberg': { name: 'Penn Schoenberg Collection', providerKey: 'penn_colenda' },
  'huntington': { name: 'Huntington Library', providerKey: 'huntington' },
  'getty': { name: 'Getty Research Institute', providerKey: 'getty' },
  'kyoto': { name: 'Kyoto University RMDA', providerKey: 'kyoto_rmda' },
};

function parseArgs(argv) {
  const args = {
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
    apply: false,
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === '--mongo-uri' && next) {
      args.mongoUri = next.trim();
      i += 1;
    } else if (a === '--db' && next) {
      args.dbName = next.trim();
      i += 1;
    } else if (a === '--apply') {
      args.apply = true;
    }
  }

  return args;
}

function assertInputs({ mongoUri, dbName }) {
  if (!mongoUri) {
    throw new Error('Missing Mongo URI. Set MONGODB_URI or pass --mongo-uri');
  }
  if (!dbName) {
    throw new Error('Missing DB name. Set DB_NAME or pass --db');
  }
}

async function main() {
  const args = parseArgs(process.argv);
  assertInputs(args);

  const { mongoUri, dbName, apply } = args;

  const client = new MongoClient(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });

  console.log('Create all provider tenants');
  console.log(`Mode         : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`DB           : ${dbName}`);
  console.log('---');

  await client.connect();
  const db = client.db(dbName);
  const tenants = db.collection('tenants');

  // 1. Fetch BPH template
  const bphTemplate = await tenants.findOne({ slug: 'bph', status: { $ne: 'deleted' } });
  if (!bphTemplate) {
    throw new Error('BPH template tenant not found in database');
  }

  console.log(`BPH template found (id: ${bphTemplate.id})`);

  // 2. Build list of tenants to create (skip BPH)
  const partnersToCreate = Object.entries(LIBRARY_PARTNERS)
    .filter(([slug]) => slug !== 'bibliotheca-philosophica-hermetica')
    .map(([slug, { name, providerKey }]) => ({
      slug,
      name,
      providerKey,
    }));

  // 3. Add default tenant
  partnersToCreate.push({
    slug: 'default',
    name: 'Default Library',
    providerKey: 'default',
  });

  console.log(`\nTenants to create: ${partnersToCreate.length}`);
  for (let i = 0; i < partnersToCreate.length; i += 1) {
    const { slug, name } = partnersToCreate[i];
    console.log(`  ${i + 1}. ${slug} (${name})`);
  }

  // 4. Check for duplicates
  console.log('\nChecking for duplicates...');
  const existingSlugs = await tenants
    .find({ slug: { $in: partnersToCreate.map(p => p.slug) }, status: { $ne: 'deleted' } })
    .project({ slug: 1 })
    .toArray();

  if (existingSlugs.length > 0) {
    const dupeList = existingSlugs.map(d => d.slug).join(', ');
    throw new Error(`Duplicate tenants found: ${dupeList}. Remove them manually before re-running.`);
  }

  console.log('No duplicates found.');

  // 5. Generate tenant documents
  const now = new Date();
  const createdBy = '69df460e23b7505b9f03aa75';
  const tenantDocs = partnersToCreate.map(({ slug, name }) => ({
    id: randomUUID(),
    slug,
    name,
    status: 'active',
    createdAt: now,
    createdBy,
    settings: {
      publicBrowsing: bphTemplate.settings?.publicBrowsing ?? true,
      allowSignup: bphTemplate.settings?.allowSignup ?? false,
    },
    pipeline: {
      pausedPhases: bphTemplate.pipeline?.pausedPhases ?? [],
      geminiQuota: bphTemplate.pipeline?.geminiQuota ?? 10,
    },
    aliases: [],
  }));

  // 6. Insert or dry-run
  if (apply) {
    console.log('\n---');
    console.log('Applying changes...');
    const result = await tenants.insertMany(tenantDocs);
    console.log(`✓ Inserted ${result.insertedCount} tenants`);
    console.log(`✓ Tenant IDs: ${Object.values(result.insertedIds).join(', ')}`);
  } else {
    console.log('\n---');
    console.log('Dry-run completed. Re-run with --apply to persist changes.');
  }

  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
