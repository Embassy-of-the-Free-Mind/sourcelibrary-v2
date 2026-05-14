#!/usr/bin/env node
/**
 * Repair one foreign-folder pair from issue #1713.
 *
 * The host book has pages from two R2 folders — its own (correct) plus the
 * partner's (mis-attached). The partner book may be live-but-empty or in
 * deleted_books.
 *
 * What this does:
 *   1. Snapshot host + partner + all pages → .claude/docs/snapshots/
 *   2. If partner is in deleted_books, restore it to books.
 *   3. Reassign book_id on partner-folder pages (host → partner).
 *   4. Renumber pages 1..N on BOTH books, sorted by R2-file ObjectID
 *      timestamp (encodes original upload order).
 *   5. Recompute pages_count, pages_ocr, pages_translated on both books.
 *   6. Reset cover_page + cover URL fields so the cover audit script
 *      can pick a clean cover next run.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/repair-foreign-folder-pair.mjs --host <hostId> --partner <partnerId> --dry-run
 *   node scripts/repair-foreign-folder-pair.mjs --host <hostId> --partner <partnerId>
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const HOST = args[args.indexOf('--host') + 1];
const PARTNER = args[args.indexOf('--partner') + 1];

if (!HOST || !PARTNER || !/^[0-9a-f]{24}$/.test(HOST) || !/^[0-9a-f]{24}$/.test(PARTNER)) {
  console.error('Usage: --host <24-hex> --partner <24-hex> [--dry-run]');
  process.exit(1);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

function extractFileObjectId(url) {
  // archived_photo URLs look like:
  //   https://images.sourcelibrary.org/uploads/{folder}/{ObjectId}.jpg
  //   https://images.sourcelibrary.org/cropped/{folder}/{ObjectId}.jpg
  // The ObjectId at the end encodes the upload timestamp.
  if (!url) return null;
  const m = url.match(/\/([0-9a-f]{24})(?:\.[a-z0-9]+)?$/i);
  return m?.[1] || null;
}

function sortKey(p) {
  // Sort by the timestamp encoded in the R2 file's ObjectId, then by the
  // page doc's own _id for stability when file IDs are equal.
  const fileId = extractFileObjectId(p.archived_photo) ||
                 extractFileObjectId(p.cropped_photo) ||
                 extractFileObjectId(p.photo);
  return fileId || String(p._id);
}

function pageFolder(p, hostId, partnerId) {
  const u = p.archived_photo || '';
  if (u.includes(hostId)) return 'host';
  if (u.includes(partnerId)) return 'partner';
  return 'other';
}

async function main() {
  const client = new MongoClient(MONGODB_URI, {
    serverSelectionTimeoutMS: 30_000,
    socketTimeoutMS: 300_000,
  });
  await client.connect();
  const db = client.db('bookstore');

  // 1. Snapshot
  const hostBook = await db.collection('books').findOne({ id: HOST });
  if (!hostBook) {
    console.error(`Host book ${HOST} not found in books.`);
    await client.close();
    process.exit(1);
  }
  const partnerLive = await db.collection('books').findOne({ id: PARTNER });
  const partnerDeleted = await db.collection('deleted_books').findOne({ id: PARTNER });
  const pages = await db.collection('pages').find({ book_id: HOST }).toArray();
  // Also include any pages already attached to the partner (should be 0 but worth recording)
  const partnerPages = await db.collection('pages').find({ book_id: PARTNER }).toArray();

  const snapshotPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `pair-${HOST}-${PARTNER}.json`);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, JSON.stringify({
    pair: { host: HOST, partner: PARTNER },
    snapshot_date: new Date().toISOString(),
    host_book: hostBook,
    partner_live: partnerLive,
    partner_deleted: partnerDeleted,
    host_pages: pages,
    partner_pages: partnerPages,
  }, null, 2));
  console.log(`Snapshot: ${snapshotPath}`);

  // 2. Split pages by folder
  const hostPages = [];
  const partnerSidePages = [];
  const otherPages = [];
  for (const p of pages) {
    const folder = pageFolder(p, HOST, PARTNER);
    if (folder === 'host') hostPages.push(p);
    else if (folder === 'partner') partnerSidePages.push(p);
    else otherPages.push(p);
  }
  console.log(`Pages on host: ${pages.length}`);
  console.log(`  host folder:    ${hostPages.length}`);
  console.log(`  partner folder: ${partnerSidePages.length}`);
  console.log(`  other:          ${otherPages.length}`);
  if (otherPages.length) {
    console.log('  WARNING: some pages have an archived_photo that matches neither host nor partner — leaving them on host.');
  }
  if (partnerPages.length) {
    console.log(`Pages already on partner: ${partnerPages.length} — will be merged with partner-side pages from host.`);
  }

  // Combine the partner-side host pages with any pages already on partner, then sort
  const newPartnerPages = [...partnerSidePages, ...partnerPages]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
  const newHostPages = [...hostPages, ...otherPages]
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

  console.log(`\nAfter split (sorted by upload order):`);
  console.log(`  host (${HOST}): ${newHostPages.length} pages`);
  console.log(`  partner (${PARTNER}): ${newPartnerPages.length} pages`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN — first 5 of each side ---');
    console.log('Host pages:');
    for (const p of newHostPages.slice(0, 5)) {
      console.log(`  pg ${p.page_number} → 1..N (next), type=${p.page_type}, url=...${(p.archived_photo || '').slice(-50)}`);
    }
    console.log('Partner pages:');
    for (const p of newPartnerPages.slice(0, 5)) {
      console.log(`  pg ${p.page_number} → 1..N (next), type=${p.page_type}, url=...${(p.archived_photo || '').slice(-50)}`);
    }
  }

  // 3. Apply (or describe) writes
  if (!DRY_RUN) {
    // 3a. Restore partner book if it was deleted, and make sure both partner
    // and host are visible/un-hidden on bph.sourcelibrary.org. Restored
    // partners get patched with BPH provider + tenant + a stable slug.
    const bphTenant = await db.collection('tenants').findOne({ slug: 'bph' });
    if (!partnerLive && partnerDeleted) {
      const restored = { ...partnerDeleted };
      delete restored._id;
      delete restored.deleted_at;
      restored.restored_at = new Date();
      restored.restored_by = 'fix-foreign-folder-pair-1713';
      restored.updated_at = new Date();
      // BPH-ify the restored partner. The deletion script (Feb 23) wiped
      // tenant info and changed provider to 'efm', so we reset both.
      restored.visible = true;
      restored.hidden = false;
      restored.tenantId = bphTenant?.id || restored.tenantId;
      restored.image_source = {
        ...(restored.image_source || {}),
        provider: 'bph',
        provider_name: 'Bibliotheca Philosophica Hermetica',
        contributing_library: 'Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)',
      };
      // Use the UBN from Dublin Core as source_id; fall back to the dc_identifier.
      const ubn = restored.dublin_core?.dc_identifier || restored.dublin_core?.dc_source?.match(/UBN:\s*(\d+)/)?.[1];
      if (ubn) restored.image_source.source_id = String(ubn);
      // Generate a stable slug if missing — title + author + a partner-id tail.
      if (!restored.slug) {
        const slugify = (s) => (s || '').toString().toLowerCase()
          .normalize('NFKD').replace(/[̀-ͯ]/g, '')
          .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
        const titlePart = slugify(restored.english_title || restored.title);
        const authorPart = slugify((restored.author || '').replace(/[\[\]]/g, '').split(',')[0]);
        const tail = PARTNER.slice(-6);
        restored.slug = `${titlePart}-${authorPart}-${tail}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
      }
      await db.collection('books').insertOne(restored);
      await db.collection('deleted_books').deleteOne({ _id: partnerDeleted._id });
      console.log(`✓ Restored partner book ${PARTNER} (slug=${restored.slug}, source_id=${restored.image_source.source_id || 'none'}).`);
    } else if (partnerLive) {
      // Live partner: unhide so users on bph.sourcelibrary.org can see it.
      await db.collection('books').updateOne(
        { id: PARTNER },
        { $set: { visible: true, hidden: false, updated_at: new Date() } }
      );
      console.log(`✓ Partner book ${PARTNER} already live — unhid it.`);
    } else {
      console.error(`✗ Partner ${PARTNER} not found anywhere (live or deleted). Aborting.`);
      await client.close();
      process.exit(1);
    }

    // 3b. Reassign + renumber partner-side pages.
    // Clear display_photo (it was derived from pages/{wrongBookId}/{wrongPaddedNum}.jpg
    // and collides across the pair). Then set thumbnail_blob and thumbnail to
    // cropped_photo where it exists — cropped_photo has a unique file ObjectId
    // and is the correctly cropped half for split-spread pages. Without this,
    // BookOverview's `getThumbUrl` falls through to archived_photo (the full
    // uncropped spread), which makes left/right halves of a spread look identical
    // in the grid.
    let i = 0;
    for (const p of newPartnerPages) {
      i++;
      const update = {
        book_id: PARTNER,
        page_number: i,
        updated_at: new Date(),
        display_photo: null,
        image_thumb: null,
      };
      if (p.cropped_photo) {
        update.thumbnail_blob = p.cropped_photo;
        update.thumbnail = p.cropped_photo;
      } else {
        update.thumbnail_blob = null;
        update.thumbnail = null;
      }
      await db.collection('pages').updateOne({ _id: p._id }, { $set: update });
    }
    console.log(`✓ Renumbered ${i} pages onto partner ${PARTNER}.`);

    // 3c. Renumber host pages — their page_numbers collide with the partner-side
    // numbers, so re-number all 1..N. Same thumb-URL handling as partner side.
    let j = 0;
    for (const p of newHostPages) {
      j++;
      const update = {
        page_number: j,
        updated_at: new Date(),
        display_photo: null,
        image_thumb: null,
      };
      if (p.cropped_photo) {
        update.thumbnail_blob = p.cropped_photo;
        update.thumbnail = p.cropped_photo;
      } else {
        update.thumbnail_blob = null;
        update.thumbnail = null;
      }
      await db.collection('pages').updateOne({ _id: p._id }, { $set: update });
    }
    console.log(`✓ Renumbered ${j} pages on host ${HOST}.`);

    // 3c.5. Re-attribute gallery_images whose page_id now resolves to the
    // partner. Their cached book_id / page_number need to follow the page.
    const galleryImages = await db.collection('gallery_images').find(
      { book_id: HOST },
      { projection: { _id: 1, id: 1, book_id: 1, page_id: 1, page_number: 1, description: 1 } }
    ).toArray();
    let gaMoved = 0;
    for (const g of galleryImages) {
      let page = await db.collection('pages').findOne({ _id: g.page_id }, { projection: { book_id: 1, page_number: 1 } });
      if (!page) page = await db.collection('pages').findOne({ id: g.page_id }, { projection: { book_id: 1, page_number: 1 } });
      if (!page) continue;
      if (page.book_id !== g.book_id || page.page_number !== g.page_number) {
        await db.collection('gallery_images').updateOne(
          { _id: g._id },
          { $set: { book_id: page.book_id, page_number: page.page_number, updated_at: new Date() } }
        );
        if (page.book_id !== g.book_id) gaMoved++;
      }
    }
    console.log(`✓ Re-attributed ${gaMoved} gallery_images (of ${galleryImages.length} on host) to follow their pages.`);

    // 3d. Recompute counters on both books
    for (const [bookId, name, expected] of [[HOST, 'host', newHostPages.length], [PARTNER, 'partner', newPartnerPages.length]]) {
      const total = await db.collection('pages').countDocuments({ book_id: bookId });
      const ocrDone = await db.collection('pages').countDocuments({ book_id: bookId, 'ocr.data': { $exists: true, $ne: null } });
      const translated = await db.collection('pages').countDocuments({ book_id: bookId, 'translation.data': { $exists: true, $ne: null } });
      await db.collection('books').updateOne(
        { id: bookId },
        { $set: {
            pages_count: total,
            pages_ocr: ocrDone,
            pages_translated: translated,
            // Reset cover so the cover-quality audit re-picks it from clean pages.
            image_display: null,
            image_thumb: null,
            thumbnail: null,
            thumbnail_blob: null,
            cover_page: null,
            thumbnail_source: 'cleared-by-1713-repair',
            updated_at: new Date(),
          } }
      );
      console.log(`✓ ${name} ${bookId}: pages_count=${total} ocr=${ocrDone} translated=${translated}`);
    }
  }

  await client.close();
  console.log(DRY_RUN ? '\n(--dry-run) no writes applied.' : '\nDone.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
