#!/usr/bin/env node
/**
 * Fix bare cover cards on /gallery/collections.
 *
 * Each gallery_collections doc shows a cover resolved as:
 *   cover_image_id → first image_ids[] entry → null (gray placeholder).
 * The cover id is looked up in `gallery_images` (extracted_url || thumbnail_url).
 *
 * Two failure modes the page can't recover from on its own:
 *   B) cover_image_id points at a now-deleted gallery_images row, but the
 *      collection's own image_ids[] still has a resolvable image → repoint.
 *   C) NO image_ids entry resolves (backing images were purged into
 *      deleted_gallery_images) → cannot get a cover from its own content →
 *      set hidden:true so the public grid (which now filters hidden) skips it.
 *
 * Reversible: un-hiding is just unsetting `hidden`. Admin manager passes
 * includeHidden=true so these stay visible/manageable there.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-gallery-collection-covers.mjs --dry-run
 *   node scripts/maintenance/backfill-gallery-collection-covers.mjs
 */
import { MongoClient } from 'mongodb';

const DRY_RUN = process.argv.includes('--dry-run');
const client = new MongoClient(process.env.MONGODB_URI);

function usableUrl(img) {
  return img && (img.extracted_url || img.thumbnail_url) || null;
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  const gc = db.collection('gallery_collections');
  const gi = db.collection('gallery_images');

  const collections = await gc.find({}, {
    projection: { id: 1, slug: 1, title: 1, cover_image_id: 1, image_ids: 1, hidden: 1 },
  }).toArray();

  // Resolve every candidate id (current cover + all image_ids) in one sweep.
  const allIds = new Set();
  for (const c of collections) {
    if (c.cover_image_id) allIds.add(c.cover_image_id);
    for (const id of (c.image_ids || [])) allIds.add(id);
  }
  const imgDocs = await gi.find({ id: { $in: [...allIds] } }, {
    projection: { id: 1, extracted_url: 1, thumbnail_url: 1 },
  }).toArray();
  const imgMap = new Map(imgDocs.map((d) => [d.id, d]));

  let ok = 0, repointed = 0, hidden = 0, unhid = 0;
  const repointEx = [], hideEx = [];
  const ops = [];

  for (const c of collections) {
    const coverOk = c.cover_image_id && usableUrl(imgMap.get(c.cover_image_id));
    if (coverOk) {
      ok++;
      // A previously-hidden collection that now has a working cover → un-hide.
      if (c.hidden) { ops.push({ updateOne: { filter: { _id: c._id }, update: { $unset: { hidden: '' }, $set: { updated_at: new Date() } } } }); unhid++; }
      continue;
    }
    // Find the first image in the collection that resolves to a usable URL.
    const firstGood = (c.image_ids || []).find((id) => usableUrl(imgMap.get(id)));
    if (firstGood) {
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { cover_image_id: firstGood, updated_at: new Date() }, $unset: { hidden: '' } } } });
      repointed++;
      if (repointEx.length < 12) repointEx.push(c.slug);
    } else {
      ops.push({ updateOne: { filter: { _id: c._id }, update: { $set: { hidden: true, updated_at: new Date() } } } });
      hidden++;
      if (hideEx.length < 20) hideEx.push(`${c.slug} (${(c.image_ids || []).length} imgs)`);
    }
  }

  if (!DRY_RUN && ops.length) await gc.bulkWrite(ops, { ordered: false });

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}gallery_collections: ${collections.length}`);
  console.log(`  cover OK (unchanged):     ${ok}`);
  console.log(`  repointed cover (B):      ${repointed}  ${repointEx.join(', ')}`);
  console.log(`  hidden — no cover (C):    ${hidden}  ${hideEx.join(', ')}`);
  console.log(`  un-hidden (cover fixed):  ${unhid}`);
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
