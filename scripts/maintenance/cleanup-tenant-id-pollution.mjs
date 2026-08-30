#!/usr/bin/env node

/**
 * Two-part cleanup driven by the "only 3 subdomain tenants are real" invariant
 * (CLAUDE.md → "Source Library is the destination"):
 *
 *   1. `tenantId` (camelCase, UUID) — unset on every doc whose tenantId is NOT
 *      one of the 3 subdomain UUIDs (bph / kloss-collection / bhutan).
 *      backfill-tenant-scope.mjs --auto-all (now deleted) tagged ~6,717 IA books
 *      plus ~4,300 other provider-scanned books with provider-tenant UUIDs,
 *      which is meaningless: providers aren't subdomain partners.
 *
 *   2. `tenant_id` (snake_case, slug like 'default'/'bhutan') — unset everywhere
 *      it appears. Pre-UUID legacy field; superseded by the camelCase UUID after
 *      PR #2071. Still written by ~20 import routes, so the cleanup is paired
 *      with a code change that removes those writes.
 *
 * Strategy: cascade via book_id from books that need cleanup. None of the
 * downstream collections has a `tenantId` index, so a direct `$nin` query
 * would full-scan 6.5M pages. Instead we:
 *   1. Resolve the list of affected book IDs (small — ~11K books).
 *   2. Walk pages/page_revisions/gallery_images via the existing `book_id`
 *      index in chunks. Cheap and predictable.
 *   3. collections is small (~350 docs), so we query it directly.
 *
 * Dry-run by default; pass --apply to write.
 */

import { MongoClient } from 'mongodb';
import 'dotenv/config';

const SUBDOMAIN_TENANT_IDS = [
  'bce03f71-c18d-4460-b8ad-224c817f9aa0', // bph
  'bf458cc2-37d5-4c44-9870-bfe95a50bcf0', // kloss-collection
  'fd1907e5-5965-4bea-a978-77be3dff08a8', // bhutan
];

const BOOK_CHUNK_SIZE = 500;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function parseArgs(argv) {
  const args = {
    apply: false,
    mongoUri: process.env.MONGODB_URI || process.env.MONGODB_URL || '',
    dbName: process.env.DB_NAME || process.env.MONGODB_DB || 'bookstore',
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

async function cascadeUnsetTenantId({ db, bookIds, apply, label }) {
  const pages = db.collection('pages');
  const pageRevisions = db.collection('page_revisions');
  const galleryImages = db.collection('gallery_images');

  let pagesMatched = 0;
  let pagesUnset = 0;
  let revisionsMatched = 0;
  let revisionsUnset = 0;
  let galleryMatched = 0;
  let galleryUnset = 0;

  for (const ids of chunk(bookIds, BOOK_CHUNK_SIZE)) {
    // pages
    const pagesQ = { book_id: { $in: ids }, tenantId: { $exists: true } };
    pagesMatched += await pages.countDocuments(pagesQ);
    if (apply) {
      const r = await pages.updateMany(pagesQ, { $unset: { tenantId: '' } });
      pagesUnset += r.modifiedCount;
    }

    // page_revisions
    const revQ = { book_id: { $in: ids }, tenantId: { $exists: true } };
    revisionsMatched += await pageRevisions.countDocuments(revQ);
    if (apply) {
      const r = await pageRevisions.updateMany(revQ, { $unset: { tenantId: '' } });
      revisionsUnset += r.modifiedCount;
    }

    // gallery_images — joined via book_id directly (denormalised)
    const galleryQ = { book_id: { $in: ids }, tenantId: { $exists: true } };
    galleryMatched += await galleryImages.countDocuments(galleryQ);
    if (apply) {
      const r = await galleryImages.updateMany(galleryQ, { $unset: { tenantId: '' } });
      galleryUnset += r.modifiedCount;
    }
  }

  console.log(`  [${label}] pages matched=${pagesMatched}${apply ? ` unset=${pagesUnset}` : ''}`);
  console.log(`  [${label}] page_revisions matched=${revisionsMatched}${apply ? ` unset=${revisionsUnset}` : ''}`);
  console.log(`  [${label}] gallery_images matched=${galleryMatched}${apply ? ` unset=${galleryUnset}` : ''}`);
}

async function cascadeUnsetSnakeTenantId({ db, bookIds, apply, label }) {
  const pages = db.collection('pages');
  const pageRevisions = db.collection('page_revisions');
  const galleryImages = db.collection('gallery_images');

  let pagesMatched = 0;
  let pagesUnset = 0;
  let revisionsMatched = 0;
  let revisionsUnset = 0;
  let galleryMatched = 0;
  let galleryUnset = 0;
  let literalMatched = 0;
  let literalUnset = 0;

  for (const ids of chunk(bookIds, BOOK_CHUNK_SIZE)) {
    const pq = { book_id: { $in: ids }, tenant_id: { $exists: true } };
    pagesMatched += await pages.countDocuments(pq);
    if (apply) {
      const r = await pages.updateMany(pq, { $unset: { tenant_id: '' } });
      pagesUnset += r.modifiedCount;
    }

    // camelCase tenantId holding the literal string 'default' — a small bug
    // cohort (the UUID field fed a slug). Part 1 can't reach these: it
    // cascades from books with a bad tenantId, and books are clean.
    const dq = { book_id: { $in: ids }, tenantId: 'default' };
    literalMatched += await pages.countDocuments(dq);
    if (apply) {
      const r = await pages.updateMany(dq, { $unset: { tenantId: '' } });
      literalUnset += r.modifiedCount;
    }

    const rq = { book_id: { $in: ids }, tenant_id: { $exists: true } };
    revisionsMatched += await pageRevisions.countDocuments(rq);
    if (apply) {
      const r = await pageRevisions.updateMany(rq, { $unset: { tenant_id: '' } });
      revisionsUnset += r.modifiedCount;
    }

    const gq = { book_id: { $in: ids }, tenant_id: { $exists: true } };
    galleryMatched += await galleryImages.countDocuments(gq);
    if (apply) {
      const r = await galleryImages.updateMany(gq, { $unset: { tenant_id: '' } });
      galleryUnset += r.modifiedCount;
    }
  }

  console.log(`  [${label}] pages matched=${pagesMatched}${apply ? ` unset=${pagesUnset}` : ''}`);
  console.log(`  [${label}] pages tenantId='default' matched=${literalMatched}${apply ? ` unset=${literalUnset}` : ''}`);
  console.log(`  [${label}] page_revisions matched=${revisionsMatched}${apply ? ` unset=${revisionsUnset}` : ''}`);
  console.log(`  [${label}] gallery_images matched=${galleryMatched}${apply ? ` unset=${galleryUnset}` : ''}`);
}

async function main() {
  const { apply, mongoUri, dbName } = parseArgs(process.argv);
  if (!mongoUri) throw new Error('Missing Mongo URI. Set MONGODB_URI or pass --mongo-uri');

  // Generous timeouts: Part 2's snake-case walk through 46K books does ~6.4M
  // updates and a single long socket can stay open for an hour-plus.
  const client = new MongoClient(mongoUri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 7_200_000, // 2h
    connectTimeoutMS: 60_000,
    retryWrites: true,
  });
  await client.connect();
  const db = client.db(dbName);

  console.log('Cleanup tenant_id pollution');
  console.log(`Mode  : ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`DB    : ${dbName}`);
  console.log(`Keep  : ${SUBDOMAIN_TENANT_IDS.join(', ')}`);
  console.log('---');

  const books = db.collection('books');
  const collections = db.collection('collections');
  const requests = db.collection('requests');

  // ── Part 1: non-subdomain tenantId (cascade) ──
  console.log('\n── Part 1: unset non-subdomain tenantId ──');
  const polluterFilter = { tenantId: { $exists: true, $nin: SUBDOMAIN_TENANT_IDS } };

  const polluterBooksCount = await books.countDocuments(polluterFilter);
  const polluterBookIds = await books.distinct('id', polluterFilter);
  console.log(`  books with non-subdomain tenantId : ${polluterBooksCount}`);

  if (apply && polluterBooksCount > 0) {
    const r = await books.updateMany(polluterFilter, { $unset: { tenantId: '' } });
    console.log(`  books unset                       : ${r.modifiedCount}`);
  }

  if (polluterBookIds.length > 0) {
    await cascadeUnsetTenantId({ db, bookIds: polluterBookIds, apply, label: 'p1' });
  }

  // collections (small) — direct query
  const collsMatched = await collections.countDocuments(polluterFilter);
  console.log(`  collections matched               : ${collsMatched}`);
  if (apply && collsMatched > 0) {
    const r = await collections.updateMany(polluterFilter, { $unset: { tenantId: '' } });
    console.log(`  collections unset                 : ${r.modifiedCount}`);
  }

  // ── Part 2: snake-case tenant_id everywhere ──
  console.log('\n── Part 2: unset snake-case tenant_id ──');
  const snakeFilter = { tenant_id: { $exists: true } };

  // books — direct query (small collection by Mongo standards)
  const booksSnakeCount = await books.countDocuments(snakeFilter);
  console.log(`  books snake tenant_id             : ${booksSnakeCount}`);
  if (apply && booksSnakeCount > 0) {
    const r = await books.updateMany(snakeFilter, { $unset: { tenant_id: '' } });
    console.log(`  books unset                       : ${r.modifiedCount}`);
  }

  // For pages/page_revisions/gallery_images, cascade via every book id —
  // ~46K books across the whole library. Direct `$exists` over 6.5M pages
  // doesn't use any index; book_id-keyed lookups do.
  const allBookIds = await books.distinct('id', {});
  console.log(`  walking ${allBookIds.length} books for downstream snake_id cleanup...`);
  await cascadeUnsetSnakeTenantId({ db, bookIds: allBookIds, apply, label: 'p2' });

  // collections (small) — direct query
  const collsSnake = await collections.countDocuments(snakeFilter);
  console.log(`  collections snake tenant_id       : ${collsSnake}`);
  if (apply && collsSnake > 0) {
    const r = await collections.updateMany(snakeFilter, { $unset: { tenant_id: '' } });
    console.log(`  collections unset                 : ${r.modifiedCount}`);
  }

  // requests (tiny)
  const requestsSnake = await requests.countDocuments(snakeFilter);
  console.log(`  requests snake tenant_id          : ${requestsSnake}`);
  if (apply && requestsSnake > 0) {
    const r = await requests.updateMany(snakeFilter, { $unset: { tenant_id: '' } });
    console.log(`  requests unset                    : ${r.modifiedCount}`);
  }

  // ── Verification ──
  if (apply) {
    console.log('\n── Verification ──');
    const residualBooks = await books.countDocuments(polluterFilter);
    const residualColls = await collections.countDocuments(polluterFilter);
    const residualSnakeBooks = await books.countDocuments(snakeFilter);
    const residualSnakeColls = await collections.countDocuments(snakeFilter);
    const residualSnakeReqs = await requests.countDocuments(snakeFilter);
    console.log(`  books with non-subdomain tenantId : ${residualBooks}`);
    console.log(`  collections with non-subdomain tenantId : ${residualColls}`);
    console.log(`  books with snake tenant_id        : ${residualSnakeBooks}`);
    console.log(`  collections with snake tenant_id  : ${residualSnakeColls}`);
    console.log(`  requests with snake tenant_id     : ${residualSnakeReqs}`);
  }

  console.log('\n---');
  console.log(apply ? 'Apply completed.' : 'Dry-run completed. Re-run with --apply to persist changes.');
  await client.close();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
