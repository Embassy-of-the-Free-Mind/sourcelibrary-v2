#!/usr/bin/env node
/**
 * Remap `gallery_collections.image_ids` and `collections.featured_images`
 * references that point at archived `deleted_gallery_images` rows so they
 * resolve to their canonical kept_id instead.
 *
 * Why this exists
 *   scripts/maintenance/dedup-book-gallery-images.mjs --apply archives
 *   redundant gallery_images rows and records each survivor's id in the
 *   archive doc's `kept_id` field. Anything that referenced an archived
 *   row by id now silently breaks on the render side: the resolver
 *   `find({ id: { $in: imageIds } })` returns fewer docs than asked for,
 *   and the page shows a smaller collection. After today's apply (5,400
 *   archived rows), 1,582 refs in `gallery_collections` and 7 refs in
 *   `collections.featured_images` are dangling.
 *
 * What this does
 *   1. Builds an archived_id → kept_id map from
 *      deleted_gallery_images where reason='recurring_template'.
 *   2. For each gallery_collection, walks `image_ids`, replaces any
 *      mapped id with its kept_id, then dedups (multiple refs to the
 *      same archived row collapse to one ref to the canonical).
 *   3. For each `collections` doc with `featured_images`, drops entries
 *      whose `id` points at an archived row that no longer exists in
 *      gallery_images. (We don't auto-add a substitute; featured_images
 *      stores the full image metadata, not just an id, so a remap would
 *      require copying the kept row's data — out of scope.)
 *
 * Safety
 *   - Dry-run by default; needs --apply.
 *   - Only acts on archives with reason='recurring_template' so an
 *     unrelated archive (e.g., the orphan cleanup PR #2093) won't be
 *     touched.
 *   - Per-doc write only when something actually changes (no-op writes
 *     are skipped, keeps `updated_at` honest).
 *
 * Usage
 *   node scripts/maintenance/remap-archived-gallery-refs.mjs           # dry-run
 *   node scripts/maintenance/remap-archived-gallery-refs.mjs --apply
 *
 * Exit codes
 *   0 — nothing to do, or --apply succeeded
 *   1 — dangling refs found in dry-run
 *   2 — script error
 */
import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set.');
  process.exit(2);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  try {
    const archives = await db.collection('deleted_gallery_images')
      .find({ reason: 'recurring_template' }, { projection: { id: 1, kept_id: 1 } })
      .toArray();
    const remap = new Map(archives.filter(a => a.kept_id).map(a => [a.id, a.kept_id]));
    console.log(`Archive remap entries: ${remap.size} (of ${archives.length} total archives)`);

    // --- gallery_collections.image_ids -----------------------------------
    const galleryColls = await db.collection('gallery_collections')
      .find({}, { projection: { _id: 1, slug: 1, image_ids: 1 } })
      .toArray();

    const galleryUpdates = [];
    for (const coll of galleryColls) {
      const oldIds = coll.image_ids || [];
      const newIds = [];
      const seen = new Set();
      let mapped = 0;
      for (const id of oldIds) {
        const target = remap.get(id) ?? id;
        if (target !== id) mapped++;
        if (seen.has(target)) continue;
        seen.add(target);
        newIds.push(target);
      }
      if (mapped > 0 || newIds.length !== oldIds.length) {
        galleryUpdates.push({
          _id: coll._id,
          slug: coll.slug,
          mapped,
          oldLen: oldIds.length,
          newLen: newIds.length,
          newIds,
        });
      }
    }
    console.log(`\ngallery_collections to update: ${galleryUpdates.length}`);
    galleryUpdates.sort((a, b) => b.mapped - a.mapped);
    for (const u of galleryUpdates.slice(0, 10)) {
      console.log(`  ${u.mapped} remapped, ${u.oldLen}→${u.newLen} ids — ${u.slug}`);
    }

    // --- collections.featured_images (drop dangling refs) ----------------
    // featured_images stores the full image record, not a thin id, so we
    // can't substitute the kept row without copying its metadata. Cleanest
    // action: drop entries whose `id` is archived.
    const archivedIds = new Set(remap.keys());
    const bookColls = await db.collection('collections')
      .find({ 'featured_images.0': { $exists: true } }, { projection: { _id: 1, slug: 1, featured_images: 1 } })
      .toArray();
    const collUpdates = [];
    for (const c of bookColls) {
      const before = c.featured_images || [];
      const after = before.filter(fi => !(fi && fi.id && archivedIds.has(fi.id)));
      if (after.length !== before.length) {
        collUpdates.push({ _id: c._id, slug: c.slug, removed: before.length - after.length, after });
      }
    }
    console.log(`\ncollections (book) with featured_images to trim: ${collUpdates.length}`);
    for (const u of collUpdates) {
      console.log(`  -${u.removed} entry(ies) — /collections/${u.slug}`);
    }

    if (galleryUpdates.length === 0 && collUpdates.length === 0) {
      console.log('\nNothing to do.');
      process.exit(0);
    }
    if (!APPLY) {
      console.log('\n(dry run; pass --apply to write)');
      process.exit(1);
    }

    let writes = 0;
    for (const u of galleryUpdates) {
      await db.collection('gallery_collections').updateOne(
        { _id: u._id },
        { $set: { image_ids: u.newIds, updated_at: new Date() } }
      );
      writes++;
    }
    for (const u of collUpdates) {
      await db.collection('collections').updateOne(
        { _id: u._id },
        { $set: { featured_images: u.after, updated_at: new Date() } }
      );
      writes++;
    }
    console.log(`\nDone. Wrote ${writes} doc updates.`);
    process.exit(0);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
