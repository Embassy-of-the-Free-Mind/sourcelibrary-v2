#!/usr/bin/env node
/**
 * Demote blank / sliver images that sit FIRST in a collection's
 * `featured_images`, so the collection card renders a real illustration.
 *
 * Why: gallery extraction occasionally promotes a blank page-margin (a pure
 * white sliver, e.g. 116x2124) or a near-empty faint scan into a collection's
 * featured images. The card renders `featured_images[0]`, and CollectionCardImage
 * only advances on a 404 — a blank-but-valid 200 image isn't an error, so the
 * card looks empty. Reported on /collections/natural-philosophy (Theatres of
 * Machines, Accademia dei Segreti), 2026-06-03.
 *
 * A featured image is "bad" if it 404s, is an extreme sliver (aspect < 0.18 or
 * > 5.5), or is near-uniform (max channel stdev < 10 = blank/washed-out). The
 * fix is NON-DESTRUCTIVE: bad entries move to the END of featured_images (not
 * removed), and hero_image is set to the first good one. Collections whose
 * images are ALL bad are reported and left untouched (they need a cover sourced
 * from a member book — a separate task).
 *
 * After running, the affected pages are statically prerendered, so a redeploy
 * (or on-demand revalidate) is needed to surface the change. revalidatePath
 * alone did NOT bust the prerendered route cache in testing — a redeploy did.
 *
 * Usage (Hetzner or local with sharp):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-blank-featured-images.mjs            # dry run
 *   node scripts/maintenance/fix-blank-featured-images.mjs --apply    # write
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');

function thumbUrl(f) {
  if (!f) return null;
  if (typeof f === 'string') return f;
  return f.thumbnail_url || f.extracted_url || f.image_url || null;
}

const cache = new Map();
async function isBad(url) {
  if (!url) return true;
  if (cache.has(url)) return cache.get(url);
  let bad = false;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) { cache.set(url, true); return true; } // 404 → bad
    const buf = Buffer.from(await r.arrayBuffer());
    const m = await sharp(buf).metadata();
    const ar = (m.width || 1) / (m.height || 1);
    if (ar < 0.18 || ar > 5.5) bad = true;            // sliver crop
    else {
      const s = await sharp(buf).stats();
      const maxStd = Math.max(...s.channels.map(x => x.stdev));
      if (maxStd < 10) bad = true;                    // near-uniform / blank
    }
  } catch { bad = true; }
  cache.set(url, bad);
  return bad;
}

async function main() {
  const c = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 30000, socketTimeoutMS: 0 });
  await c.connect();
  const coll = c.db(process.env.MONGODB_DB || 'bookstore').collection('collections');
  const all = await coll.find({}, { projection: { name: 1, slug: 1, featured_images: 1 } }).toArray();

  let blankFirst = 0, reordered = 0, allBad = 0;
  for (const d of all) {
    const fi = d.featured_images || [];
    if (!fi.length) continue;
    const flags = await Promise.all(fi.map(f => isBad(thumbUrl(f))));
    if (flags[0] !== true) continue; // first image is fine
    blankFirst++;
    const good = fi.filter((_, i) => !flags[i]);
    const bad = fi.filter((_, i) => flags[i]);
    if (!good.length) {
      allBad++;
      console.log(`ALL-BAD (needs a book cover): ${d.name}`);
      continue;
    }
    console.log(`REORDER: ${d.name} (${bad.length}/${fi.length} bad → moved to end)`);
    if (APPLY) {
      await coll.updateOne(
        { _id: d._id },
        { $set: { featured_images: [...good, ...bad], hero_image: thumbUrl(good[0]) } },
      );
      reordered++;
    }
  }

  console.log('---');
  console.log(`collections with blank first image: ${blankFirst}`);
  console.log(`reordered: ${reordered}${APPLY ? '' : ' (dry run)'}  | all-bad (left for book-cover fix): ${allBad}`);
  await c.close();
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });
