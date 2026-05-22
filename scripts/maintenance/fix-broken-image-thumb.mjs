#!/usr/bin/env node
/**
 * Sister to scripts/fix-broken-thumbnails.mjs.
 *
 * That script handles books whose legacy `thumbnail` field is an /archived/
 * URL that getBookThumbnailUrl() rewrites to a /pages/ URL that 404s.
 *
 * This one handles the case where `image_thumb` / `thumbnail_blob` already
 * store the (broken) /pages/{id}/{padded}-thumb.jpg URL directly. Observed
 * on draft books from e-rara / MDZ imports — they were tagged into
 * collections, an upstream writer minted a /pages/-thumb URL based on
 * book_id + cover_page, but the page-level R2 upload never happened. The
 * exact writer is no longer in the active codebase (likely a one-shot
 * archived in scripts/_archived/2026-05-cover-fixes/), but the data drift
 * keeps surfacing as broken-image reports — see analytics_broken_image_reports
 * for /collections/jungs-library, /collections/agrippas-world, etc.
 *
 * `image_display` on these books usually points to a working /archived/N.jpg
 * URL, so we leave that alone — only the thumb variants get cleared, which
 * makes the card render the placeholder icon instead of a broken image.
 *
 * Designed to run weekly via the Hetzner crontab (see
 * .claude/docs/hetzner-scheduler-crontab.md).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-broken-image-thumb.mjs            # dry run
 *   node scripts/maintenance/fix-broken-image-thumb.mjs --apply    # write
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const CONCURRENCY = 24;

// images.sourcelibrary.org/pages/{24-hex-or-uuid}/{digits}-thumb.jpg
const PAGES_THUMB_RE = /^https:\/\/images\.sourcelibrary\.org\/pages\/[a-f0-9-]+\/\d+-thumb\.jpg$/;

async function head(url) {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    return r.status;
  } catch {
    return 0;
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. source .env.production.local first.');
    process.exit(1);
  }
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const cursor = books.find(
    {
      visible: true,
      image_thumb: { $regex: '^https://images\\.sourcelibrary\\.org/pages/[a-f0-9-]+/\\d+-thumb\\.jpg$' },
    },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, image_thumb: 1, thumbnail_blob: 1 } }
  );

  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);

  let scanned = 0, broken = 0, cleared = 0;
  let queue = [];

  const flush = async () => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    await Promise.all(batch.map(async (book) => {
      const url = book.image_thumb;
      if (!url || !PAGES_THUMB_RE.test(url)) return;
      const status = await head(url);
      if (status === 404) {
        broken++;
        if (APPLY) {
          const update = { $unset: { image_thumb: '' } };
          // Clear thumbnail_blob too if it points at the same broken URL.
          if (book.thumbnail_blob === url) update.$unset.thumbnail_blob = '';
          await books.updateOne({ _id: book._id }, update);
          cleared++;
        }
        const slug = book.slug || book.id || String(book._id);
        console.log(`  404  ${slug}  (${(book.title || '').slice(0, 60)})`);
      }
    }));
  };

  for await (const book of cursor) {
    scanned++;
    queue.push(book);
    if (queue.length >= CONCURRENCY) await flush();
    if (scanned % 500 === 0) console.log(`  ...scanned ${scanned}, broken so far ${broken}`);
  }
  await flush();

  console.log('---');
  console.log(`scanned: ${scanned}`);
  console.log(`broken:  ${broken}`);
  console.log(`cleared: ${cleared}${APPLY ? '' : ' (dry run — re-run with --apply)'}`);

  await client.close();
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
