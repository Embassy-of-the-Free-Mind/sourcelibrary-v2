#!/usr/bin/env node
/**
 * Backfill `tenantId` on `gallery_images` from each image's `book.tenantId`.
 *
 * Why: tenant gallery pages (`/[tenant]/gallery`) filter by `tenantId` to
 * honour invariant 2 in CLAUDE.md (every server query touching a tenant
 * page filters by tenant). New tenants get `tenantId` set on `books` and
 * `pages`, but the gallery_images collection was missed historically —
 * any tenant promoted before the pipeline learned to set it has zero
 * images visible in its gallery view, even though the book detail page
 * (which queries by `book_id` only) renders them fine.
 *
 * See `memory/lesson_tenant_promotion_backfill.md` for the broader pattern.
 *
 * Run after promoting a new tenant, or when the gallery is silently empty
 * on a tenant subdomain with otherwise visible books and images.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-gallery-tenant-id.mjs
 *   # or scope to one tenant:
 *   set -a; source .env.production.local; set +a; node scripts/maintenance/backfill-gallery-tenant-id.mjs --tenant bph
 */

import { MongoClient } from 'mongodb';

const CHUNK = 500;

async function main() {
  const args = process.argv.slice(2);
  const tenantArgIdx = args.indexOf('--tenant');
  const onlyTenant = tenantArgIdx >= 0 ? args[tenantArgIdx + 1] : null;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI missing — source .env.production.local first.');
    process.exit(1);
  }

  const c = new MongoClient(uri);
  await c.connect();
  const db = c.db('bookstore');

  const tenantQuery = onlyTenant ? { slug: onlyTenant } : {};
  const tenants = await db.collection('tenants').find(
    tenantQuery,
    { projection: { _id: 0, id: 1, slug: 1 } },
  ).toArray();

  if (tenants.length === 0) {
    console.error(`No tenants matched ${JSON.stringify(tenantQuery)}.`);
    process.exit(1);
  }

  let grand = 0;
  for (const t of tenants) {
    const books = (await db.collection('books').find(
      { tenantId: t.id },
      { projection: { id: 1 } },
    ).toArray()).map(b => b.id);

    if (books.length === 0) continue;

    let updated = 0;
    for (let i = 0; i < books.length; i += CHUNK) {
      const chunk = books.slice(i, i + CHUNK);
      const r = await db.collection('gallery_images').updateMany(
        { book_id: { $in: chunk }, $or: [{ tenantId: { $exists: false } }, { tenantId: null }] },
        { $set: { tenantId: t.id } },
      );
      updated += r.modifiedCount;
    }
    if (updated > 0) console.log(t.slug.padEnd(22), 'updated:', updated);
    grand += updated;
  }

  console.log('---');
  console.log('total updated:', grand);
  await c.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
