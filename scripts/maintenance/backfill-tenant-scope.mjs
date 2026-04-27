#!/usr/bin/env node

/**
 * Backfill tenant scope for existing production data.
 *
 * Modes:
 * 1. Per-tenant mode: --tenant <slug> [--provider <key>] [--alias <alias>...]
 *    - Backfill a single tenant with optional provider filter
 *    - Can add aliases to tenant document
 *
 * 2. Auto-all mode: --auto-all
 *    - Backfill all active tenants automatically
 *    - Resolves provider key from tenant slug → LIBRARY_PARTNERS match
 *    - Generates JSON report at scripts/maintenance/backfill-report.json
 *    - Backsup 6 collections: books, pages, collections, page_revisions, gallery_images
 *
 * Defaults to dry-run. Pass --apply to write changes.
 *
 * Usage examples:
 *
 * Per-tenant (single):
 * node scripts/maintenance/backfill-tenant-scope.mjs \
 *   --tenant bibliotheca-philosophica-hermetica \
 *   --provider bph \
 *   --alias bph
 *
 * Auto-all (batch):
 * node scripts/maintenance/backfill-tenant-scope.mjs --auto-all
 * node scripts/maintenance/backfill-tenant-scope.mjs --auto-all --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import 'dotenv/config';

const LIBRARY_PARTNERS_PROVIDER_MAP = {
  'bph': 'bph',  
  'internet-archive': 'internet_archive',
  'gallica': 'gallica',
  'bavarian-state-library': 'mdz',
  'bodleian': 'bodleian',
  'cambridge': 'cambridge',
  'e-rara': 'e-rara',
  'wellcome-collection': 'wellcome',
  'hab-wolfenbuettel': 'hab',
  'vatican-library': 'vatican',
  'google-books': 'google_books',
  'hathi-trust': 'hathi_trust',
  'europeana': 'europeana',
  'manchester': 'manchester',
  'allard-pierson': 'allard_pierson',
  'laurenziana': 'laurenziana',
  'leiden': 'leiden',
  'e-codices': 'e-codices',
  'chester-beatty': 'chester_beatty',
  'ndl-japan': 'ndl_japan',
  'kloss-collection': 'cmc_kloss',
  'library-of-congress': 'loc',
  'british-library': 'bl',
  'sbb-berlin': 'sbb',
  'austrian-national-library': 'onb',
  'yale-beinecke': 'yale_beinecke',
  'harvard-houghton': 'harvard',
  'penn-schoenberg': 'penn_colenda',
  'huntington': 'huntington',
  'getty': 'getty',
  'kyoto': 'kyoto_rmda',
  'default': 'default',
};

const MISSING_TENANT_OR = [
  { tenantId: { $exists: false } },
  { tenantId: null },
  { tenantId: '' },
];

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function backfillByBookIdChunks(collection, tenantBookIds, tenantId, apply) {
  const BOOK_CHUNK_SIZE = 500;
  let missingCount = 0;
  let updatedCount = 0;

  for (const bookIdsChunk of chunkArray(tenantBookIds, BOOK_CHUNK_SIZE)) {
    const filter = {
      book_id: { $in: bookIdsChunk },
      $or: MISSING_TENANT_OR,
    };

    const chunkMissing = await collection.countDocuments(filter);
    missingCount += chunkMissing;

    if (apply && chunkMissing > 0) {
      const r = await collection.updateMany(filter, { $set: { tenantId } });
      updatedCount += r.modifiedCount;
    }
  }

  return { missingCount, updatedCount };
}

async function countByBookIdChunks(collection, tenantBookIds, additionalFilter = {}) {
  const BOOK_CHUNK_SIZE = 500;
  let totalCount = 0;

  for (const bookIdsChunk of chunkArray(tenantBookIds, BOOK_CHUNK_SIZE)) {
    const filter = {
      book_id: { $in: bookIdsChunk },
      ...additionalFilter,
    };
    totalCount += await collection.countDocuments(filter);
  }

  return totalCount;
}

async function backfillGalleryByBookIdChunks(pages, galleryImages, tenantBookIds, tenantId, apply) {
  const BOOK_CHUNK_SIZE = 300;
  const PAGE_CHUNK_SIZE = 2000;
  let missingCount = 0;
  let updatedCount = 0;

  for (const bookIdsChunk of chunkArray(tenantBookIds, BOOK_CHUNK_SIZE)) {
    const pageIds = await pages.distinct('id', { book_id: { $in: bookIdsChunk } });
    if (pageIds.length === 0) continue;

    for (const pageIdsChunk of chunkArray(pageIds, PAGE_CHUNK_SIZE)) {
      const filter = {
        page_id: { $in: pageIdsChunk },
        $or: MISSING_TENANT_OR,
      };

      const chunkMissing = await galleryImages.countDocuments(filter);
      missingCount += chunkMissing;

      if (apply && chunkMissing > 0) {
        const r = await galleryImages.updateMany(filter, { $set: { tenantId } });
        updatedCount += r.modifiedCount;
      }
    }
  }

  return { missingCount, updatedCount };
}

function parseArgs(argv) {
  const args = {
    tenantSlug: '',
    provider: '',
    aliases: [],
    apply: false,
    autoAll: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
  };

  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    const next = argv[i + 1];

    if (a === '--tenant' && next) {
      args.tenantSlug = next.trim();
      i += 1;
    } else if (a === '--provider' && next) {
      args.provider = next.trim();
      i += 1;
    } else if (a === '--alias' && next) {
      args.aliases.push(next.trim());
      i += 1;
    } else if (a === '--mongo-uri' && next) {
      args.mongoUri = next.trim();
      i += 1;
    } else if (a === '--db' && next) {
      args.dbName = next.trim();
      i += 1;
    } else if (a === '--apply') {
      args.apply = true;
    } else if (a === '--auto-all') {
      args.autoAll = true;
    }
  }

  return args;
}

function assertInputs({ tenantSlug, autoAll, mongoUri, dbName }) {
  if (!mongoUri) {
    throw new Error('Missing Mongo URI. Set MONGODB_URI or pass --mongo-uri');
  }
  if (!dbName) {
    throw new Error('Missing DB name. Set DB_NAME or pass --db');
  }
  if (!tenantSlug && !autoAll) {
    throw new Error('Specify either --tenant <slug> or --auto-all');
  }
  if (tenantSlug && autoAll) {
    throw new Error('Cannot combine --tenant and --auto-all. Choose one mode.');
  }
}

// ── Per-tenant backfill (existing behavior + new collections) ──
async function backfillSingleTenant(db, tenantSlug, provider, aliases, apply) {
  const tenants = db.collection('tenants');
  const books = db.collection('books');
  const pages = db.collection('pages');
  const collections = db.collection('collections');
  const pageRevisions = db.collection('page_revisions');
  const galleryImages = db.collection('gallery_images');

  console.log('Backfill tenant scope');
  console.log(`Mode         : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Tenant slug  : ${tenantSlug}`);
  console.log(`Provider     : ${provider || '(none)'}`);
  console.log(`Aliases      : ${aliases.length > 0 ? aliases.join(', ') : '(none)'}`);
  console.log('---');

  const tenant = await tenants.findOne({ slug: tenantSlug, status: { $ne: 'deleted' } });
  if (!tenant) {
    throw new Error(`Tenant not found for slug="${tenantSlug}"`);
  }

  const tenantId = tenant.id;
  if (!tenantId) {
    throw new Error(`Tenant slug="${tenantSlug}" has no id field`);
  }

  // 1) Alias backfill (optional)
  const normalizedAliases = aliases
    .map(a => a.toLowerCase())
    .filter(a => a && a !== tenantSlug.toLowerCase());

  const aliasUpdate = normalizedAliases.length > 0
    ? {
        $addToSet: {
          aliases: { $each: normalizedAliases },
          slug_aliases: { $each: normalizedAliases },
        },
      }
    : null;

  if (aliasUpdate) {
    if (apply) {
      await tenants.updateOne({ _id: tenant._id }, aliasUpdate);
      console.log(`tenant aliases updated: +${normalizedAliases.join(', ')}`);
    } else {
      console.log(`tenant aliases planned: +${normalizedAliases.join(', ')}`);
    }
  }

  // 2) books.tenantId backfill
  const missingTenantBooksFilter = {
    ...(provider ? { 'image_source.provider': provider } : {}),
    $or: MISSING_TENANT_OR,
  };

  const missingTenantBooksCount = await books.countDocuments(missingTenantBooksFilter);
  console.log(`books missing tenantId: ${missingTenantBooksCount}`);

  if (apply && missingTenantBooksCount > 0) {
    const r = await books.updateMany(missingTenantBooksFilter, { $set: { tenantId } });
    console.log(`books updated         : ${r.modifiedCount}`);
  }

  // Resolve all tenant book IDs after backfill criteria
  const tenantBookFilter = {
    tenantId,
    ...(provider ? { 'image_source.provider': provider } : {}),
  };

  const tenantBookIds = await books.distinct('id', tenantBookFilter);
  console.log(`tenant books total    : ${tenantBookIds.length}`);

  // 3) pages.tenantId backfill for tenant books
  if (tenantBookIds.length > 0) {
    const pagesResult = await backfillByBookIdChunks(pages, tenantBookIds, tenantId, apply);
    const pagesMissingCount = pagesResult.missingCount;
    console.log(`pages missing tenantId: ${pagesMissingCount}`);

    if (apply && pagesMissingCount > 0) {
      console.log(`pages updated         : ${pagesResult.updatedCount}`);
    }

    // 4) page_revisions.tenantId backfill
    const revisionsResult = await backfillByBookIdChunks(pageRevisions, tenantBookIds, tenantId, apply);
    const revisionsMissingCount = revisionsResult.missingCount;

    console.log(`page_revisions missing tenantId: ${revisionsMissingCount}`);

    if (apply && revisionsMissingCount > 0) {
      console.log(`page_revisions updated: ${revisionsResult.updatedCount}`);
    }

    // 5) gallery_images.tenantId backfill
    const galleryResult = await backfillGalleryByBookIdChunks(
      pages,
      galleryImages,
      tenantBookIds,
      tenantId,
      apply
    );

    console.log(`gallery_images missing tenantId: ${galleryResult.missingCount}`);

    if (apply && galleryResult.missingCount > 0) {
      console.log(`gallery_images updated: ${galleryResult.updatedCount}`);
    }

    // 6) collections.tenantId based on slugs used by tenant books
    const tenantCollectionSlugs = await books.distinct('collections', {
      tenantId,
      collections: { $exists: true, $ne: [] },
    });

    const normalizedSlugs = tenantCollectionSlugs.filter(Boolean);
    console.log(`collections referenced: ${normalizedSlugs.length}`);

    if (normalizedSlugs.length > 0) {
      const collectionsFilter = {
        slug: { $in: normalizedSlugs },
        $or: MISSING_TENANT_OR,
      };

      const collectionsMissingCount = await collections.countDocuments(collectionsFilter);
      console.log(`collections missing tenantId: ${collectionsMissingCount}`);

      if (apply && collectionsMissingCount > 0) {
        const r = await collections.updateMany(collectionsFilter, { $set: { tenantId } });
        console.log(`collections updated         : ${r.modifiedCount}`);
      }
    }
  }
}

// ── Auto-all backfill (new behavior) ──
async function backfillAllTenants(db, apply) {
  const tenants = db.collection('tenants');
  const books = db.collection('books');
  const pages = db.collection('pages');
  const collections = db.collection('collections');
  const pageRevisions = db.collection('page_revisions');
  const galleryImages = db.collection('gallery_images');

  console.log('Backfill tenant scope (auto-all mode)');
  console.log(`Mode         : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log('---');

  // Get all active tenants
  const allTenants = await tenants
    .find({ status: { $ne: 'deleted' } })
    .toArray();

  console.log(`Found ${allTenants.length} active tenants\n`);

  const report = {
    timestamp: new Date().toISOString(),
    mode: 'auto-all',
    dryRun: !apply,
    totalTenants: allTenants.length,
    tenantsProcessed: 0,
    summary: {},
  };

  // Process each tenant
  for (const tenant of allTenants) {
    const tenantId = tenant.id;
    const slug = tenant.slug;

    // Resolve provider key from slug
    const providerKey = LIBRARY_PARTNERS_PROVIDER_MAP[slug];
    if (!providerKey) {
      console.log(`⚠  Tenant "${slug}": No provider key mapping found. Skipping.`);
      continue;
    }

    console.log(`Processing: ${slug} (provider: ${providerKey})`);

    // 2) books.tenantId backfill
    const missingTenantBooksFilter = {
      'image_source.provider': providerKey,
      $or: MISSING_TENANT_OR,
    };

    const booksCount = await books.countDocuments(missingTenantBooksFilter);
    if (apply && booksCount > 0) {
      await books.updateMany(missingTenantBooksFilter, { $set: { tenantId } });
    }

    // Resolve provider-scoped book IDs so dry-run reflects what WOULD be touched.
    const tenantBookIds = await books.distinct('id', {
      'image_source.provider': providerKey,
    });

    // 3) pages.tenantId backfill
    let pagesMissingCount = 0;
    let pagesTotalCount = 0;
    let revisionsCount = 0;
    let galleryCount = 0;
    let collectionsCount = 0;

    if (tenantBookIds.length > 0) {
      const pagesResult = await backfillByBookIdChunks(pages, tenantBookIds, tenantId, apply);
      pagesMissingCount = pagesResult.missingCount;
      pagesTotalCount = await countByBookIdChunks(pages, tenantBookIds);

      // 4) page_revisions.tenantId backfill
      const revisionsResult = await backfillByBookIdChunks(pageRevisions, tenantBookIds, tenantId, apply);
      revisionsCount = revisionsResult.missingCount;

      // 5) gallery_images.tenantId backfill
      const galleryResult = await backfillGalleryByBookIdChunks(
        pages,
        galleryImages,
        tenantBookIds,
        tenantId,
        apply
      );
      galleryCount = galleryResult.missingCount;

      // 6) collections.tenantId based on slugs used by tenant books
      const tenantCollectionSlugs = await books.distinct('collections', {
        'image_source.provider': providerKey,
        collections: { $exists: true, $ne: [] },
      });

      const normalizedSlugs = tenantCollectionSlugs.filter(Boolean);
      if (normalizedSlugs.length > 0) {
        const collectionsFilter = {
          slug: { $in: normalizedSlugs },
          $or: MISSING_TENANT_OR,
        };
        collectionsCount = await collections.countDocuments(collectionsFilter);
        if (apply && collectionsCount > 0) {
          await collections.updateMany(collectionsFilter, { $set: { tenantId } });
        }
      }
    }

    report.summary[slug] = {
      booksMatched: tenantBookIds.length,
      booksBackfilled: booksCount,
      pagesTotalScoped: pagesTotalCount,
      pagesBackfilled: pagesMissingCount,
      revisionsBackfilled: revisionsCount,
      galleryImagesBackfilled: galleryCount,
      collectionsBackfilled: collectionsCount,
    };

    report.tenantsProcessed += 1;
    console.log(`  ✓ books: ${tenantBookIds.length}, pages(total): ${pagesTotalCount}, pages(missing tenantId): ${pagesMissingCount}`);
  }

  // Save report to file
  const reportPath = resolve(process.cwd(), 'scripts/maintenance/backfill-report.json');
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nReport saved to: ${reportPath}`);

  console.log('---');
  console.log(apply ? 'Apply completed.' : 'Dry-run completed. Re-run with --apply to persist changes.');
}

async function main() {
  const args = parseArgs(process.argv);
  assertInputs(args);

  const {
    tenantSlug,
    provider,
    aliases,
    apply,
    autoAll,
    mongoUri,
    dbName,
  } = args;

  const client = new MongoClient(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
  });

  await client.connect();
  const db = client.db(dbName);

  try {
    if (autoAll) {
      await backfillAllTenants(db, apply);
    } else {
      await backfillSingleTenant(db, tenantSlug, provider, aliases, apply);
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
