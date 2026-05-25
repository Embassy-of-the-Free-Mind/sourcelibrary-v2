#!/usr/bin/env node

/**
 * Add a `kind` field to every doc in the `tenants` collection.
 *
 * Background: the `tenants` collection conflates three different things
 * under one name (see .claude/docs/tenant-architecture-audit-2026-05-23.md):
 *   - subdomain  → real partner-facing tenants with their own subdomain
 *                  (BPH today; Kloss + Bhutan once DNS lands)
 *   - provider   → source libraries whose books we re-host (Gallica, Bodleian,
 *                  Wellcome, etc.) — NOT meant to be visited as tenant URLs
 *   - default    → main-library catch-all
 *   - meta       → cross-tenant aggregate rows (currently just "all")
 *
 * Without a `kind` field, code that wants "real subdomain tenants only"
 * (e.g. proxy.ts URL-based resolution) can't distinguish a real tenant from
 * a provider entry, and `/gallica` accidentally becomes a tenant route.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/add-tenant-kind-field.mjs
 *   node scripts/migration/add-tenant-kind-field.mjs --apply
 */

import { MongoClient } from 'mongodb';

const SUBDOMAIN_SLUGS = new Set([
  'bph',
  'kloss-collection',
  'bhutan', // promoted 2026-05-24
]);

const META_SLUGS = new Set(['all']);
const DEFAULT_SLUGS = new Set(['default']);

function classify(slug) {
  if (SUBDOMAIN_SLUGS.has(slug)) return 'subdomain';
  if (DEFAULT_SLUGS.has(slug)) return 'default';
  if (META_SLUGS.has(slug)) return 'meta';
  return 'provider';
}

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Set MONGODB_URI before running. Hint: set -a; source .env.production.local; set +a');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');
  const tenants = db.collection('tenants');

  const docs = await tenants.find({}).project({ slug: 1, kind: 1 }).toArray();
  console.log(`Found ${docs.length} tenant docs.\n`);

  const summary = { subdomain: 0, provider: 0, default: 0, meta: 0, unchanged: 0, skipped: 0 };
  const ops = [];

  for (const doc of docs) {
    const slug = doc.slug;
    if (!slug) {
      console.warn(`  SKIP no slug: _id=${doc._id}`);
      summary.skipped++;
      continue;
    }
    const expectedKind = classify(slug);
    const current = doc.kind;
    if (current === expectedKind) {
      summary.unchanged++;
      continue;
    }
    summary[expectedKind]++;
    console.log(`  ${slug.padEnd(28)} ${current || '(none)'} → ${expectedKind}`);
    ops.push({
      updateOne: {
        filter: { _id: doc._id },
        update: { $set: { kind: expectedKind, kindUpdatedAt: new Date() } },
      },
    });
  }

  console.log('\nSummary:');
  for (const [k, v] of Object.entries(summary)) console.log(`  ${k}: ${v}`);
  console.log(`\n${ops.length} docs need updates.`);

  if (!apply) {
    console.log('\nDRY RUN — pass --apply to write changes.');
  } else if (ops.length > 0) {
    const res = await tenants.bulkWrite(ops);
    console.log(`\nWrote: ${res.modifiedCount} modified.`);
  }

  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
