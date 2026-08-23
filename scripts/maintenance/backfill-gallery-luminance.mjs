#!/usr/bin/env node
/**
 * Mean luminance for gallery images — issue #4151.
 *
 * WHY: collection hero collages pick tiles at random from a quality-sorted pool,
 * and `gallery_quality` says nothing about BRIGHTNESS. A pristine scan of a dark
 * mezzotint scores 1.0 and renders as a black hole in the header — measured on
 * /collections/en-espanol, where one Fludd engraving at mean grey 59 sat in an
 * 18-image pool and had a 29% chance of appearing in any given ISR build.
 *
 * Writes `luminance` (0–255 integer, mean grey of the thumbnail) onto
 * `gallery_images`. Intrinsic per-image data, same class as `dhash`,
 * `gallery_quality` and `bbox`, which already live on that doc — not a sweep
 * finding, so it belongs in a field rather than a sweep-log row.
 *
 * Also useful to the quote-band picker, which needs "a calm, even mid-tone zone"
 * (see the `quote-background-image` skill) and currently has no signal for it.
 *
 * Scope: `gallery_quality >= 0.8 && book_visible` — the 53K images that can
 * actually reach a hero. Costs bandwidth and time only; no API spend.
 *
 * PAGES BY _id, never a streamed cursor: a cursor held open across 50K slow
 * network fetches dies mid-walk and loses its place (three jobs lost that way in
 * one day, 2026-08). Every batch is a fresh bounded query, so a kill resumes
 * from the last id with no state file.
 *
 *   node --env-file=.env.production.local scripts/maintenance/backfill-gallery-luminance.mjs [--apply] [--limit=N]
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';

const APPLY = process.argv.includes('--apply');
const arg = (n, d) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? Number(m.split('=')[1]) : d; };
const LIMIT = arg('limit', Infinity);
const BATCH = arg('batch', 200);
const CONCURRENCY = arg('concurrency', 16);

const strArg = (n) => { const m = process.argv.find((a) => a.startsWith(`--${n}=`)); return m ? m.split('=')[1] : null; };
const COLLECTION = strArg('collection'); // optional: do one collection's images first

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 6 });
await client.connect();
const db = client.db('bookstore');
const images = db.collection('gallery_images');

let bookScope = {};
if (COLLECTION) {
  const ids = (await db.collection('books')
    .find({ collections: COLLECTION, visible: true }, { projection: { id: 1 } }).toArray()).map((b) => b.id);
  if (!ids.length) { console.error(`no visible books in collection "${COLLECTION}"`); await client.close(); process.exit(1); }
  bookScope = { book_id: { $in: ids } };
  console.log(`scoped to collection "${COLLECTION}" — ${ids.length} books`);
}

const SCOPE = { gallery_quality: { $gte: 0.8 }, book_visible: true, luminance: { $exists: false }, ...bookScope };
const remaining = await images.countDocuments(SCOPE);
console.log(`${remaining} image(s) in scope without luminance${APPLY ? '' : '  — DRY RUN, pass --apply'}`);
if (!APPLY) { await client.close(); process.exit(0); }

/** Mean grey of the thumbnail, 0–255. null when the image cannot be read. */
async function luminanceOf(doc) {
  const url = doc.thumbnail_url || doc.extracted_url || doc.image_url;
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const stats = await sharp(buf).greyscale().stats();
    return Math.round(stats.channels[0].mean);
  } catch {
    return null;
  }
}

let after = null, done = 0, wrote = 0, failed = 0;
const t0 = Date.now();
while (done < LIMIT) {
  // Fresh bounded query each batch — no long-lived cursor.
  const q = after ? { ...SCOPE, _id: { $gt: after } } : SCOPE;
  const batch = await images.find(q, {
    projection: { _id: 1, thumbnail_url: 1, extracted_url: 1, image_url: 1 },
    sort: { _id: 1 },
    limit: Math.min(BATCH, LIMIT - done),
  }).toArray();
  if (!batch.length) break;
  after = batch[batch.length - 1]._id;

  const ops = [];
  for (let i = 0; i < batch.length; i += CONCURRENCY) {
    const slice = batch.slice(i, i + CONCURRENCY);
    const lums = await Promise.all(slice.map(luminanceOf));
    slice.forEach((doc, j) => {
      const lum = lums[j];
      if (lum === null) { failed++; return; }
      ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { luminance: lum } } } });
    });
  }
  if (ops.length) { await images.bulkWrite(ops, { ordered: false }); wrote += ops.length; }
  done += batch.length;
  const rate = done / ((Date.now() - t0) / 1000);
  console.log(`  ${done}/${Math.min(remaining, LIMIT)} walked, ${wrote} written, ${failed} unreadable — ${rate.toFixed(1)}/s`);
}

console.log(`\ndone: walked ${done}, wrote ${wrote}, unreadable ${failed} in ${Math.round((Date.now() - t0) / 1000)}s`);
const left = await images.countDocuments(SCOPE);
console.log(`still without luminance in scope: ${left}`);
await client.close();
