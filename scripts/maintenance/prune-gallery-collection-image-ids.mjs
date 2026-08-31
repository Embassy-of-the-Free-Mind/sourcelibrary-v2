#!/usr/bin/env node
/**
 * Prune dangling image_ids from gallery_collections — and rebuild thematic
 * collections that the pruning leaves empty. (#4486)
 *
 * Why these exist
 *   gallery_collections.image_ids are pointers into gallery_images. When a
 *   book is re-imported its pages are re-minted, cleanup-orphan-gallery-images
 *   deletes the stale gallery_images rows — and nothing prunes the collection
 *   pointers. The read routes silently drop unresolvable ids, so a collection
 *   with 200 stored ids can deliver 0 items while the LIST endpoint still
 *   reports imageCount: 200 (that is how musical-scores broke for an external
 *   API consumer, 2026-08-31). Measured that day: 180 of 266 collections
 *   carried at least one dangling id (4,395 of 38,646 total); 13 thematic
 *   collections were fully dead.
 *
 * What it does
 *   1. For every gallery_collections doc, resolve image_ids against
 *      gallery_images and drop the danglers (order preserved). After the
 *      prune, image_ids.length is honest again, so the list route needs no
 *      code change.
 *   2. If cover_image_id dangles, promote the first surviving id.
 *   3. THEMATIC collections (they carry book_collection_slug) that end below
 *      --reseed-floor are rebuilt from the current gallery_images of their
 *      book collection — same query as the admin seed route's thematic mode.
 *      Visual/featured collections are never auto-reseeded (their membership
 *      is curated; flag them in the report instead).
 *   4. Full pre-image backup of every modified doc to scripts/output/
 *      (untracked), keyed by slug — restore by writing image_ids back.
 *
 * DRY-RUN by default; exits 2 when danglers were found (for cron alerting).
 *   node --env-file=.env.production.local scripts/maintenance/prune-gallery-collection-image-ids.mjs
 *   node --env-file=.env.production.local scripts/maintenance/prune-gallery-collection-image-ids.mjs --apply
 */
import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const APPLY = process.argv.includes('--apply');
const floorArg = process.argv.find((a) => a.startsWith('--reseed-floor='));
const RESEED_FLOOR = floorArg ? parseInt(floorArg.split('=')[1], 10) : 4;

// Mirrors the thematic seed in src/app/api/admin/seed-collections/route.ts —
// that route is the source of truth; keep the two in sync.
const THEMATIC_EXCLUDED_TYPES = ['decorative', 'symbol', 'printer_device', 'printer_mark', 'ornament', 'border'];
const THEMATIC_MIN_QUALITY = 0.7;
const THEMATIC_LIMIT = 500;

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set'); process.exit(1); }
const client = new MongoClient(uri);
await client.connect();
const db = client.db('bookstore');

/** Port of deduplicateByWorkId from the seed route (see note above). */
function baseTitle(title) {
  return (title || '')
    .replace(/,?\s*(?:Vol(?:ume)?|Tome?|Part|Bd|Band|Livre)\.?\s*[\dIVXLCDM]+/gi, '')
    .replace(/\s*\((?:Vol(?:ume)?|Tome?)\.?\s*[\dIVXLCDM]+\)/gi, '')
    .replace(/\s*[·]\s*卷[^\s)]*/, '')
    .replace(/\s*\([一二三四五六七八九十百千零]+\)\s*$/, '')
    .replace(/\s*[\dIVXLCDM]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function deduplicateByWorkId(imageIds) {
  if (imageIds.length === 0) return [];
  const images = await db.collection('gallery_images')
    .find({ id: { $in: imageIds } }, { projection: { id: 1, book_id: 1, gallery_quality: 1 } })
    .toArray();
  const imageMap = new Map(images.map((img) => [img.id, img]));
  const bookIds = [...new Set(images.map((img) => img.book_id))];
  const books = await db.collection('books')
    .find({ id: { $in: bookIds } }, { projection: { id: 1, work_id: 1, title: 1 } })
    .toArray();
  const bookInfo = new Map(books.map((b) => [b.id, { workId: b.work_id, title: b.title || '' }]));
  const workToBooks = new Map();
  for (const [bookId, info] of bookInfo) {
    if (!info.workId) continue;
    const ex = workToBooks.get(info.workId) || [];
    ex.push(bookId);
    workToBooks.set(info.workId, ex);
  }
  const excludedBooks = new Set();
  for (const [, editionBookIds] of workToBooks) {
    if (editionBookIds.length <= 1) continue;
    const baseTitles = editionBookIds.map((id) => baseTitle(bookInfo.get(id)?.title));
    if (new Set(baseTitles).size === 1) continue; // volumes of one set — keep all
    const titleGroups = new Map();
    for (let i = 0; i < editionBookIds.length; i++) {
      const bt = baseTitles[i];
      const ex = titleGroups.get(bt) || [];
      ex.push(editionBookIds[i]);
      titleGroups.set(bt, ex);
    }
    let bestGroup = '';
    let bestAvg = -1;
    for (const [bt, groupBookIds] of titleGroups) {
      const groupImages = images.filter((img) => groupBookIds.includes(img.book_id));
      if (groupImages.length === 0) continue;
      const avg = groupImages.reduce((s, img) => s + (img.gallery_quality || 0), 0) / groupImages.length;
      if (avg > bestAvg) { bestAvg = avg; bestGroup = bt; }
    }
    for (const [bt, groupBookIds] of titleGroups) {
      if (bt !== bestGroup) for (const bookId of groupBookIds) excludedBooks.add(bookId);
    }
  }
  if (excludedBooks.size === 0) return imageIds;
  return imageIds.filter((id) => {
    const img = imageMap.get(id);
    return img && !excludedBooks.has(img.book_id);
  });
}

async function reseedThematic(bookCollectionSlug) {
  const bookDocs = await db.collection('books')
    .find({ collections: bookCollectionSlug, visible: true }, { projection: { id: 1 } })
    .toArray();
  const bookIds = bookDocs.map((b) => b.id);
  if (bookIds.length === 0) return [];
  const images = await db.collection('gallery_images')
    .find({
      book_id: { $in: bookIds },
      gallery_quality: { $gte: THEMATIC_MIN_QUALITY },
      type: { $nin: THEMATIC_EXCLUDED_TYPES },
    })
    .sort({ gallery_quality: -1 })
    .limit(THEMATIC_LIMIT)
    .project({ id: 1 })
    .toArray();
  return deduplicateByWorkId(images.map((img) => img.id));
}

const cols = await db.collection('gallery_collections')
  .find({})
  .project({ slug: 1, image_ids: 1, cover_image_id: 1, featured: 1, type: 1, book_collection_slug: 1 })
  .toArray();

const backups = [];
const report = [];
let touched = 0;

for (const col of cols) {
  const ids = col.image_ids || [];
  if (ids.length === 0) {
    if (col.type === 'thematic' && col.book_collection_slug) {
      report.push({ slug: col.slug, claimed: 0, live: 0, action: 'empty-thematic-reseed-candidate' });
    }
    continue;
  }
  const liveDocs = await db.collection('gallery_images')
    .find({ id: { $in: ids } }, { projection: { id: 1 } })
    .toArray();
  const liveSet = new Set(liveDocs.map((d) => d.id));
  if (liveSet.size === ids.length) continue; // fully resolvable — untouched

  let newIds = ids.filter((id) => liveSet.has(id));
  let action = `prune ${ids.length - newIds.length}`;

  if (newIds.length < RESEED_FLOOR && col.type === 'thematic' && col.book_collection_slug) {
    const reseeded = await reseedThematic(col.book_collection_slug);
    if (reseeded.length > newIds.length) {
      newIds = reseeded;
      action = `reseed ${reseeded.length} (was ${ids.length} claimed / ${liveSet.size} live)`;
    }
  } else if (newIds.length < RESEED_FLOOR) {
    action += ' — BELOW FLOOR, curated collection: needs human reseed';
  }

  const newCover = newIds.includes(col.cover_image_id) ? col.cover_image_id : (newIds[0] || '');
  report.push({ slug: col.slug, claimed: ids.length, live: liveSet.size, kept: newIds.length, featured: !!col.featured, action });
  backups.push({ slug: col.slug, image_ids: ids, cover_image_id: col.cover_image_id });
  touched++;

  if (APPLY) {
    await db.collection('gallery_collections').updateOne(
      { slug: col.slug },
      { $set: { image_ids: newIds, cover_image_id: newCover, updated_at: new Date() } },
    );
  }
}

if (backups.length) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outDir = path.join(repoRoot, 'scripts', 'output');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const backupPath = path.join(outDir, `gallery-collection-prune-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify(backups, null, 2));
  console.log(`backup of ${backups.length} pre-image docs: ${backupPath}`);
}

console.log(`\n${cols.length} collections scanned, ${touched} with dangling ids${APPLY ? ' (APPLIED)' : ' (dry run — pass --apply)'}:\n`);
for (const r of report.sort((a, b) => (b.claimed - (b.live ?? 0)) - (a.claimed - (a.live ?? 0)))) {
  console.log(` ${r.slug}: ${r.live}/${r.claimed} live → keep ${r.kept ?? '-'} | ${r.action}${r.featured ? ' | FEATURED' : ''}`);
}

await client.close();
process.exit(touched > 0 && !APPLY ? 2 : 0);
