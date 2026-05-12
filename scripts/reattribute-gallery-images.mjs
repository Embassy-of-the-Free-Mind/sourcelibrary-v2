#!/usr/bin/env node
/**
 * Re-attribute gallery_images whose cached book_id / page_number no longer
 * match their referenced page doc. Used after a foreign-folder pair repair
 * (#1713) — when pages move from host → partner, their gallery_image
 * children need book_id + page_number updated.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/reattribute-gallery-images.mjs --book <hostId>          # scan one book's gallery images
 *   node scripts/reattribute-gallery-images.mjs --book <hostId> --apply  # apply
 *   node scripts/reattribute-gallery-images.mjs --all-affected --apply   # all 21 books
 */

import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ALL_AFFECTED = args.includes('--all-affected');
const SINGLE_BOOK = (() => {
  const idx = args.indexOf('--book');
  return idx !== -1 ? args[idx + 1] : null;
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(1);
}

async function lookupPage(db, pageId) {
  // Try _id (ObjectId) first, then id (string). Some gallery_images store either.
  let p = await db.collection('pages').findOne({ _id: pageId }, { projection: { _id: 1, id: 1, book_id: 1, page_number: 1 } });
  if (!p) p = await db.collection('pages').findOne({ id: pageId }, { projection: { _id: 1, id: 1, book_id: 1, page_number: 1 } });
  return p;
}

async function reattributeForBook(db, hostBookId) {
  const images = await db.collection('gallery_images').find(
    { book_id: hostBookId },
    { projection: { _id: 1, id: 1, book_id: 1, page_id: 1, page_number: 1, image_url: 1, description: 1 } }
  ).toArray();
  console.log(`\n=== ${hostBookId} — ${images.length} gallery_images ===`);
  let moved = 0, stale = 0, ok = 0, orphan = 0;
  for (const g of images) {
    const page = await lookupPage(db, g.page_id);
    if (!page) {
      orphan++;
      console.log(`  ORPHAN ga.id=${g.id} page_id=${g.page_id} (no matching page doc)`);
      continue;
    }
    if (page.book_id === g.book_id && page.page_number === g.page_number) {
      ok++;
      continue;
    }
    if (page.book_id !== g.book_id) moved++;
    else stale++;
    console.log(`  ${page.book_id !== g.book_id ? 'MOVED' : 'STALE'} ga.id=${g.id} | was (book=${g.book_id?.slice(-6)} pg=${g.page_number}) → now (book=${page.book_id?.slice(-6)} pg=${page.page_number})`);
    console.log(`    desc: ${(g.description || '').slice(0, 80)}`);
    if (APPLY) {
      await db.collection('gallery_images').updateOne(
        { _id: g._id },
        { $set: { book_id: page.book_id, page_number: page.page_number, updated_at: new Date() } }
      );
    }
  }
  console.log(`  Summary: ok=${ok}, moved=${moved}, stale=${stale}, orphan=${orphan}`);
  return { ok, moved, stale, orphan };
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 300000 });
  await client.connect();
  const db = client.db('bookstore');

  let bookIds = [];
  if (ALL_AFFECTED) {
    const auditPath = resolve(REPO_ROOT, '.claude/docs/bph-foreign-folder-pages-2026-05-12.json');
    const audit = JSON.parse(readFileSync(auditPath, 'utf8'));
    bookIds = audit.map(o => o.id);
  } else if (SINGLE_BOOK) {
    bookIds = [SINGLE_BOOK];
  } else {
    console.error('Pass --book <id> or --all-affected');
    process.exit(1);
  }

  console.log(`Mode: ${APPLY ? 'APPLY' : 'dry-run'}`);
  console.log(`Books to scan: ${bookIds.length}`);

  let totalMoved = 0, totalStale = 0, totalOk = 0, totalOrphan = 0;
  for (const id of bookIds) {
    const { ok, moved, stale, orphan } = await reattributeForBook(db, id);
    totalOk += ok; totalMoved += moved; totalStale += stale; totalOrphan += orphan;
  }
  console.log(`\n=== TOTAL ===`);
  console.log(`  ok=${totalOk}, moved=${totalMoved}, stale=${totalStale}, orphan=${totalOrphan}`);

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
