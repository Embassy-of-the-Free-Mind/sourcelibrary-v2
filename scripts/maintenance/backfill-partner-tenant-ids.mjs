#!/usr/bin/env node

/**
 * Backfill tenantId for the three partner-subdomain tenants (bph / kloss / bhutan).
 *
 * Per CLAUDE.md the `tenants` collection has 34 rows, but only three are real
 * subdomain partners — the rest are legacy provider rows slated for removal
 * post-#2025. This script ignores those legacy rows and tags books for the
 * three real partners using the signals Mayank approved (2026-05-27):
 *
 *   bph     →  image_source.provider === 'bph'
 *   kloss   →  image_source.provider === 'cmc_kloss'
 *   bhutan  →  collections ∈ {bhutan, bhutan-buddhist-manuscripts}
 *              OR language ∈ {Tibetan, Dzongkha, bo, dz}
 *              OR image_source.provider === 'bdrc'
 *              OR held_by === 'bdrc'
 *
 * Bhutan OVERRIDES existing tenantId (e.g. books currently tagged
 * `internet-archive`) because the legacy provider tenants are being deleted.
 * BPH and Kloss only fill empty tenantId — they don't overwrite.
 *
 * Cascades the tag to pages, page_revisions and gallery_images so
 * tenant-scoped client APIs don't 404 (lesson: tenant-promotion-backfill).
 *
 * Non-partner books are left with tenantId unset.
 *
 * Defaults to dry-run. Pass --apply to write.
 *
 * Usage:
 *   node scripts/maintenance/backfill-partner-tenant-ids.mjs            # dry-run
 *   node scripts/maintenance/backfill-partner-tenant-ids.mjs --apply    # write
 *   node scripts/maintenance/backfill-partner-tenant-ids.mjs --only bph # one tenant
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

const TENANTS = {
  bph: {
    id: 'bce03f71-c18d-4460-b8ad-224c817f9aa0',
    bookFilter: { 'image_source.provider': 'bph' },
    overrideExisting: false,
  },
  kloss: {
    id: 'bf458cc2-37d5-4c44-9870-bfe95a50bcf0',
    bookFilter: { 'image_source.provider': 'cmc_kloss' },
    overrideExisting: false,
  },
  bhutan: {
    id: 'fd1907e5-5965-4bea-a978-77be3dff08a8',
    bookFilter: {
      $or: [
        { collections: { $in: ['bhutan', 'bhutan-buddhist-manuscripts'] } },
        { language: { $in: ['Tibetan', 'Dzongkha', 'bo', 'dz'] } },
        { 'image_source.provider': 'bdrc' },
        { held_by: 'bdrc' },
      ],
    },
    overrideExisting: true,
  },
};

const BOOK_CHUNK = 500;
const PAGE_CHUNK = 2000;

function parseArgs(argv) {
  const args = { apply: false, only: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--only' && argv[i + 1]) {
      args.only = argv[i + 1].trim();
      i += 1;
    }
  }
  return args;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function missingOrDifferent(tenantId) {
  return {
    $or: [
      { tenantId: { $exists: false } },
      { tenantId: null },
      { tenantId: '' },
      { tenantId: { $ne: tenantId } },
    ],
  };
}

function missingOnly() {
  return {
    $or: [
      { tenantId: { $exists: false } },
      { tenantId: null },
      { tenantId: '' },
    ],
  };
}

async function backfillOneTenant(db, name, cfg, apply) {
  console.log(`\n── ${name} (${cfg.id}) ──`);

  const books = db.collection('books');
  const pages = db.collection('pages');
  const pageRevisions = db.collection('page_revisions');
  const galleryImages = db.collection('gallery_images');

  const writeGate = cfg.overrideExisting ? missingOrDifferent(cfg.id) : missingOnly();

  const booksToUpdateFilter = { $and: [cfg.bookFilter, writeGate] };
  const booksToUpdate = await books.countDocuments(booksToUpdateFilter);

  const allMatchedBookIds = await books.distinct('id', cfg.bookFilter);
  const totalMatched = allMatchedBookIds.length;

  console.log(`  books matching rule         : ${totalMatched}`);
  console.log(`  books needing tenantId write: ${booksToUpdate}` +
    (cfg.overrideExisting ? ' (includes override of foreign tenantId)' : ''));

  if (apply && booksToUpdate > 0) {
    const r = await books.updateMany(booksToUpdateFilter, { $set: { tenantId: cfg.id } });
    console.log(`  books updated               : ${r.modifiedCount}`);
  }

  if (totalMatched === 0) return;

  let pagesNeed = 0; let pagesUpdated = 0;
  let revsNeed = 0; let revsUpdated = 0;
  let galleryNeed = 0; let galleryUpdated = 0;

  for (const bookIds of chunk(allMatchedBookIds, BOOK_CHUNK)) {
    const pageFilter = { book_id: { $in: bookIds }, ...writeGate };
    pagesNeed += await pages.countDocuments(pageFilter);
    if (apply) {
      const r = await pages.updateMany(pageFilter, { $set: { tenantId: cfg.id } });
      pagesUpdated += r.modifiedCount;
    }

    const revFilter = { book_id: { $in: bookIds }, ...writeGate };
    revsNeed += await pageRevisions.countDocuments(revFilter);
    if (apply) {
      const r = await pageRevisions.updateMany(revFilter, { $set: { tenantId: cfg.id } });
      revsUpdated += r.modifiedCount;
    }

    const pageIds = await pages.distinct('id', { book_id: { $in: bookIds } });
    for (const pids of chunk(pageIds, PAGE_CHUNK)) {
      const gFilter = { page_id: { $in: pids }, ...writeGate };
      galleryNeed += await galleryImages.countDocuments(gFilter);
      if (apply) {
        const r = await galleryImages.updateMany(gFilter, { $set: { tenantId: cfg.id } });
        galleryUpdated += r.modifiedCount;
      }
    }
  }

  console.log(`  pages needing write         : ${pagesNeed}`);
  if (apply) console.log(`  pages updated               : ${pagesUpdated}`);
  console.log(`  page_revisions needing write: ${revsNeed}`);
  if (apply) console.log(`  page_revisions updated      : ${revsUpdated}`);
  console.log(`  gallery_images needing write: ${galleryNeed}`);
  if (apply) console.log(`  gallery_images updated      : ${galleryUpdated}`);
}

async function main() {
  const { apply, only } = parseArgs(process.argv);
  const mongoUri = process.env.MONGODB_URI || process.env.MONGODB_URL;
  const dbName = process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore';
  if (!mongoUri) throw new Error('MONGODB_URI not set');

  if (only && !TENANTS[only]) {
    throw new Error(`--only must be one of: ${Object.keys(TENANTS).join(', ')}`);
  }

  console.log('Partner tenant backfill');
  console.log(`Mode  : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`Scope : ${only || 'all three (bph, kloss, bhutan)'}`);

  const client = new MongoClient(mongoUri, { maxPoolSize: 10, serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(dbName);

  try {
    const targets = only ? [only] : ['bph', 'kloss', 'bhutan'];
    for (const name of targets) {
      await backfillOneTenant(db, name, TENANTS[name], apply);
    }
  } finally {
    await client.close();
  }

  console.log(`\n${apply ? 'Apply completed.' : 'Dry-run completed. Re-run with --apply to write.'}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
