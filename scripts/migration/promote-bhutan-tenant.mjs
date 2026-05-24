#!/usr/bin/env node

/**
 * Promote Bhutan from "books got tagged with tenant_id: 'bhutan' but no
 * subdomain or tenants row exists" → a real subdomain tenant.
 *
 * What this does:
 *   1. Insert a `tenants` row for `bhutan` (with kind: 'subdomain').
 *      Skip if it already exists. Use the BPH row as a schema template.
 *   2. Unhide all books with `tenant_id: 'bhutan'` and `hidden: true`.
 *      Status stays at 'draft' — matches the dominant pattern for Bhutan
 *      books (913 already draft + visible).
 *   3. Report on bhutan.sourcelibrary.org DNS status (Derek-action gate).
 *
 * Background: 1,325 Bhutanese Buddhist manuscript books were imported from
 * the British Library EAP project in late April 2026 and tagged with
 * tenant_id:'bhutan'. The import was followed by a /embed/bhutan/ scaffold
 * but no tenants row, no subdomain, and 408 books were left hidden. See
 * .claude/docs/tenant-architecture-audit-2026-05-23.md.
 *
 * Dry-run by default. Pass --apply to write.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/migration/promote-bhutan-tenant.mjs
 *   node scripts/migration/promote-bhutan-tenant.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { randomUUID } from 'crypto';

const BHUTAN_TENANT_DOC = {
  slug: 'bhutan',
  name: 'Bhutan Buddhist Manuscripts',
  status: 'active',
  kind: 'subdomain',
  settings: {
    publicBrowsing: true,
    allowSignup: false,
  },
  pipeline: {
    pausedPhases: [],
    geminiQuota: 10,
  },
  // Provenance — these books came from the British Library EAP project.
  provider: {
    name: 'British Library Endangered Archives Programme',
    projectId: 'EAP105',
    manifestHost: 'eap.bl.uk',
  },
  notes: 'Promoted 2026-05-24 from in-limbo tag-only state to real subdomain tenant. DNS for bhutan.sourcelibrary.org must be added in Vercel separately.',
};

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  if (!uri) {
    console.error('Set MONGODB_URI before running.');
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('bookstore');

  // Step 1 — insert tenants row if absent
  const existing = await db.collection('tenants').findOne({ slug: 'bhutan' });
  if (existing) {
    console.log(`Tenants row for 'bhutan' already exists (_id=${existing._id}, id=${existing.id}). Skipping insert.`);
  } else {
    console.log(`Will insert tenants row for 'bhutan':`);
    const insertDoc = {
      ...BHUTAN_TENANT_DOC,
      id: randomUUID(),
      createdAt: new Date(),
      kindUpdatedAt: new Date(),
    };
    console.log(JSON.stringify(insertDoc, null, 2));
    if (apply) {
      const res = await db.collection('tenants').insertOne(insertDoc);
      console.log(`  Inserted _id=${res.insertedId}`);
    }
  }

  // Step 2 — unhide bhutan books
  const hiddenCount = await db.collection('books').countDocuments({
    tenant_id: 'bhutan',
    hidden: true,
  });
  console.log(`\nBhutan books currently hidden: ${hiddenCount}`);
  if (apply && hiddenCount > 0) {
    const res = await db.collection('books').updateMany(
      { tenant_id: 'bhutan', hidden: true },
      { $set: { hidden: false, updated_at: new Date() } },
    );
    console.log(`  Unhid ${res.modifiedCount} books.`);
  }

  const visibleCount = await db.collection('books').countDocuments({
    tenant_id: 'bhutan',
    hidden: { $ne: true },
  });
  console.log(`Bhutan books visible (after this run): ${visibleCount + (apply ? 0 : hiddenCount)}`);

  // Step 3 — DNS reminder
  console.log('\n--- DNS REQUIRED (Derek action) ---');
  console.log('Add bhutan.sourcelibrary.org as a domain in Vercel project:');
  console.log('  vercel domains add bhutan.sourcelibrary.org');
  console.log('Then verify the proxy mapping in src/proxy.ts:185 already routes it.');

  if (!apply) console.log('\nDRY RUN — pass --apply to write.');
  await client.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
