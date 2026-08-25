#!/usr/bin/env node
/**
 * Detector: pages we SERVE from R2 whose full-resolution master we do not hold.
 *
 * WHY THIS CLASS IS INVISIBLE
 * ---------------------------
 * Every serving-side measurement reports these pages as healthy, because they
 * are. A page can hold our 1200px `display_photo` and our 150px `image_thumb`
 * on R2 — so it renders entirely from our own CDN, counts toward "served from
 * R2", and shows up in no broken-image sweep — while the only full-resolution
 * copy of the scan sits on the source institution's server:
 *
 *   photo           api.digitale-sammlungen.de/.../full/full/...   (MDZ master)
 *   archived_photo  (absent)                                        <- ours: none
 *   display_photo   images.sourcelibrary.org/.../0040.jpg           (1200px, ours)
 *   image_thumb     images.sourcelibrary.org/.../0040-thumb.jpg     (150px, ours)
 *
 * Measured 2026-08-21: a corpus census reported 99.56% of live pages "held on R2
 * and served from R2" — true, and it missed ~100,000 pages in exactly this state.
 * If the source changes a URL scheme or withdraws an item, we keep serving 1200px
 * forever and can never regenerate anything larger. The loss is silent and
 * permanent, and nothing else we run would notice it.
 *
 * WHAT COUNTS AS A MASTER
 * -----------------------
 * Two eras store it differently, and checking only one is how this gap reads as
 * a field-naming artifact rather than a real one (verified by curl before this
 * detector was written — `…-full.jpg` was a 404 on every book sampled):
 *   - old era: `archived_photo` -> images.sourcelibrary.org/archived/<book>/N.jpg
 *   - new era: `photo`          -> images.sourcelibrary.org/pages/<book>/NNNN-full.jpg
 *   - split halves: `cropped_photo` on R2 is the materialised page
 *
 * READ-ONLY. Finds, never fixes — repair is `archive-mdz-gap-4190.mjs` and its
 * kin, which fetch from the source and cost bandwidth and storage.
 *
 * Exit codes follow the corpus-integrity-watch contract:
 *   0  under threshold
 *   1  finding — over threshold
 *   2  could not reach the database (fail LOUDLY; a silent green run is
 *      indistinguishable from "checked, found nothing" — #4071)
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/audit/pages-served-without-a-master.mjs
 *   … --max=0        threshold above which this is a finding (default 0)
 *   … --top=20       how many books to list
 *   … --all          include hidden books (default: live only)
 */
import { MongoClient } from 'mongodb';

const ARGS = process.argv.slice(2);
const num = (n, d) => { const m = ARGS.find(a => a.startsWith(`--${n}=`)); return m ? Number(m.split('=')[1]) : d; };
const MAX = num('max', 0);
const TOP = num('top', 20);
const ALL = ARGS.includes('--all');

const R2 = 'images\\.sourcelibrary\\.org';
const MASTER_NEW = `^https://${R2}/pages/[^/]+/[^/]*\\d+(-full)?\\.jpg$`;

let client;
try {
  client = new MongoClient(process.env.MONGODB_URI, { socketTimeoutMS: 0, serverSelectionTimeoutMS: 30000, retryReads: true });
  await client.connect();
  await client.db('bookstore').command({ ping: 1 });
} catch (e) {
  console.error(`could not reach the database: ${e.message}`);
  process.exit(2);
}

try {
  const db = client.db('bookstore');
  const bookFilter = ALL ? { pages_count: { $gt: 0 } } : { visible: true, pages_count: { $gt: 0 } };
  const bookDocs = await db.collection('books')
    .find(bookFilter, { projection: { _id: 1, title: 1, 'image_source.provider': 1 }, maxTimeMS: 600000 })
    .toArray();
  const meta = Object.fromEntries(bookDocs.map(b => [b._id.toString(), b]));

  const rows = await db.collection('pages').aggregate([
    {
      $match: {
        page_number: { $gte: 0 },
        // Serves from us at SOME size…
        $or: [
          { display_photo: { $regex: R2 } },
          { image_thumb: { $regex: R2 } },
          { thumbnail_blob: { $regex: R2 } },
        ],
        // …but we hold no full-resolution copy, under either era's convention.
        archived_photo: { $not: new RegExp(R2) },
        photo: { $not: new RegExp(MASTER_NEW) },
        cropped_photo: { $not: new RegExp(R2) },
      },
    },
    { $group: { _id: '$book_id', pages: { $sum: 1 }, sample: { $first: '$photo' } } },
  ], { allowDiskUse: true, maxTimeMS: 3600000 }).toArray();

  const found = rows.filter(r => meta[r._id]);
  const total = found.reduce((a, r) => a + r.pages, 0);

  const byProvider = {};
  for (const r of found) {
    const p = meta[r._id]?.image_source?.provider || '(none)';
    byProvider[p] = byProvider[p] || { books: 0, pages: 0 };
    byProvider[p].books++; byProvider[p].pages += r.pages;
  }

  console.log(`pages served from R2 with NO master held: ${total.toLocaleString()} across ${found.length} ${ALL ? '' : 'live '}books\n`);
  if (total) {
    console.log('by source provider:');
    for (const [p, v] of Object.entries(byProvider).sort((a, b) => b[1].pages - a[1].pages)) {
      console.log(`  ${p.padEnd(20)} ${String(v.books).padStart(5)} books  ${v.pages.toLocaleString().padStart(9)} pages`);
    }
    console.log(`\nlargest ${Math.min(TOP, found.length)}:`);
    for (const r of found.sort((a, b) => b.pages - a.pages).slice(0, TOP)) {
      console.log(`  ${String(r.pages).padStart(6)}p  ${String(meta[r._id]?.image_source?.provider || '?').padEnd(14)} ${String(meta[r._id]?.title || r._id).slice(0, 48)}`);
      console.log(`          source: ${String(r.sample || '(none)').slice(0, 92)}`);
    }
    console.log('\nRepair fetches from the source and costs bandwidth + R2 storage — it is a');
    console.log('decision, not a cleanup. See scripts/maintenance/archive-mdz-gap-4190.mjs.');
  }

  if (total > MAX) {
    console.log(`\nFINDING: ${total.toLocaleString()} > threshold ${MAX}`);
    process.exit(1);
  }
  console.log(`\nclean (threshold ${MAX})`);
  process.exit(0);
} catch (e) {
  console.error(`detector failed before producing a measurement: ${e.message}`);
  process.exit(2);
} finally {
  await client.close().catch(() => {});
}
