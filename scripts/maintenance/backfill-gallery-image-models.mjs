#!/usr/bin/env node
/**
 * Backfill the model (and detected_at, where absent) on gallery_images docs that are
 * missing it, copying from the source-of-truth detection on the page.
 *
 * WHY: older materialization runs dropped `model` from the gallery doc, while the page's
 * own detection kept it (#2406; 95,356 of 236,908 crops still blank on 2026-11-04, and
 * all 997 sampled pages carry a model). This is a copy, never an inference: it does not
 * hardcode a worker constant and does not guess from dates or logs.
 *
 * SAME-CROP CHECK (added 2026-11-04): a page can be detected more than once, by different
 * models, so the detection at `detection_index` may not be the one this crop came from.
 * The model is copied only when the detection has the same description, or the detection
 * at that index has the same box. Anything else is left blank and counted: a wrong
 * provenance record is worse than a missing one.
 *
 * UPDATE-only, no deletes. Manual crops are skipped; `detection_source` is not touched.
 * Each book gets a sweep_log row, with the crop ids, before its crops are written, so the
 * sweep can be listed and undone.
 *
 * Modes:
 *   --limit N   Stop after examining N gallery docs
 *   --write     Actually UPDATE (default is dry-run: report what would change)
 *
 * Env: MONGODB_URI
 */

import { MongoClient } from 'mongodb';
import { recordSweepActions } from '../lib/sweep-log.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('Missing env: MONGODB_URI');
  process.exit(1);
}

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const LIMIT = parseInt(args.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;

const BATCH = 500;
const SWEEP = 'gallery-model-backfill-2026-11';
const BOX_TOLERANCE = 0.01;
const NO_MODEL = [{ model: null }, { model: '' }];

const client = new MongoClient(MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const gallery = db.collection('gallery_images');
const pages = db.collection('pages');

const counts = {
  examined: 0,
  updated: 0,
  matchedByDescription: 0,
  matchedByBox: 0,
  pageMissing: 0, // source page gone (orphaned gallery doc)
  noDetections: 0, // page has no detections left
  notSameCrop: 0, // page has detections, but none is demonstrably this crop
  noModelOnDetection: 0, // the matching detection has no model either
  byModel: {},
};
const refusedSamples = [];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const sameBox = (a, b) =>
  a && b && ['x', 'y', 'width', 'height'].every((k) => Math.abs(Number(a[k]) - Number(b[k])) <= BOX_TOLERANCE);

/** The page detection this crop demonstrably came from, or null. */
function findSameCrop(g, detections) {
  const want = norm(g.description);
  if (want) {
    const atIndex = detections[g.detection_index];
    if (atIndex && norm(atIndex.description) === want) return { det: atIndex, by: 'description' };
    const same = detections.filter((d) => d && norm(d.description) === want);
    // The same words at two places on a page, from two models, do not identify one of them.
    if (same.length && new Set(same.map((d) => d.model)).size === 1) return { det: same[0], by: 'description' };
    if (same.length) return null;
  }
  const atIndex = detections[g.detection_index];
  if (atIndex && sameBox(g.bbox, atIndex.bbox)) return { det: atIndex, by: 'box' };
  return null;
}

const cursor = gallery
  .find(
    { $or: NO_MODEL, detection_source: { $ne: 'manual' } },
    { projection: { id: 1, page_id: 1, book_id: 1, detection_index: 1, description: 1, bbox: 1, detected_at: 1 } }
  )
  .batchSize(BATCH);

let batch = [];

async function flush() {
  if (!batch.length) return;

  const pageIds = [...new Set(batch.map((g) => g.page_id).filter(Boolean))];
  const pageDocs = await pages
    .find(
      { $or: [{ id: { $in: pageIds } }, { _id: { $in: pageIds } }] },
      { projection: { id: 1, 'detected_images.model': 1, 'detected_images.detected_at': 1, 'detected_images.description': 1, 'detected_images.bbox': 1 } }
    )
    .toArray();
  const pageMap = new Map();
  for (const p of pageDocs) {
    pageMap.set(String(p._id), p);
    if (p.id) pageMap.set(p.id, p);
  }

  const ops = [];
  const perBook = new Map();
  for (const g of batch) {
    const page = pageMap.get(String(g.page_id));
    if (!page) {
      counts.pageMissing++;
      continue;
    }
    const detections = page.detected_images || [];
    if (!detections.length) {
      counts.noDetections++;
      continue;
    }
    const found = findSameCrop(g, detections);
    if (!found) {
      counts.notSameCrop++;
      if (refusedSamples.length < 15) refusedSamples.push({ id: g.id, page_id: g.page_id, index: g.detection_index });
      continue;
    }
    if (!found.det.model) {
      counts.noModelOnDetection++;
      continue;
    }
    if (found.by === 'description') counts.matchedByDescription++;
    else counts.matchedByBox++;

    const $set = { model: found.det.model };
    if (!g.detected_at && found.det.detected_at) $set.detected_at = found.det.detected_at;
    counts.byModel[found.det.model] = (counts.byModel[found.det.model] || 0) + 1;
    counts.updated++;
    ops.push({ updateOne: { filter: { _id: g._id, $or: NO_MODEL }, update: { $set } } });

    const row = perBook.get(g.book_id) || { ids: [], models: {} };
    row.ids.push(String(g._id));
    row.models[found.det.model] = (row.models[found.det.model] || 0) + 1;
    perBook.set(g.book_id, row);
  }

  if (WRITE && ops.length) {
    await recordSweepActions(
      db,
      [...perBook].map(([book_id, detail]) => ({
        sweep: SWEEP,
        book_id: String(book_id),
        action: 'copied-model-from-page-detection',
        detail,
      }))
    );
    const res = await gallery.bulkWrite(ops, { ordered: false });
    if (res.modifiedCount !== ops.length) {
      console.warn(`  bulkWrite: ${res.modifiedCount}/${ops.length} modified`);
    }
  }
  batch = [];
}

for await (const doc of cursor) {
  batch.push(doc);
  counts.examined++;
  if (batch.length >= BATCH) {
    await flush();
    if (counts.examined % 10000 < BATCH) {
      console.log(`  ...${counts.examined} examined, ${counts.updated} ${WRITE ? 'updated' : 'would update'}`);
    }
  }
  if (LIMIT && counts.examined >= LIMIT) break;
}
await flush();

console.log(`\n${WRITE ? 'WROTE' : 'DRY RUN (use --write to apply)'}`);
console.log(JSON.stringify(counts, null, 1));
console.log('refused samples', JSON.stringify(refusedSamples));
console.log('gallery_images still without model:', await gallery.countDocuments({ $or: NO_MODEL }));

await client.close();
