#!/usr/bin/env node
/**
 * Find books whose `thumbnail` field points at an R2 URL that 404s, and clear
 * the field so BookCard falls through to its placeholder icon instead of
 * cycling through display → thumb → broken before giving up.
 *
 * Why this is a problem:
 *   - 7.3K books have legacy /archived/{bookId}/{N}.jpg thumbnail URLs.
 *   - getBookThumbnailUrl() rewrites those to /pages/{bookId}/{padded}.jpg
 *     when building cards. About 3% of books had no pages actually uploaded
 *     to R2, so the rewritten URL 404s. The user sees a flash of broken
 *     image before BookCard's onError settles on the placeholder.
 *   - These rewrites happen at render time on every page that shows the
 *     book card, repeatedly hammering R2 with requests we know will 404.
 *
 * What this does:
 *   - Streams over visible books with /archived/ thumbnails.
 *   - HEAD-checks each rewritten URL with bounded concurrency.
 *   - On 404, unsets `book.thumbnail` so the card renders the icon state
 *     from the first paint.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/fix-broken-thumbnails.mjs            # dry run (default)
 *   node scripts/fix-broken-thumbnails.mjs --apply    # actually update
 *   node scripts/fix-broken-thumbnails.mjs --apply --limit 500  # bounded
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : Infinity;
const CONCURRENCY = 24;

function rewriteThumbToDisplayUrl(thumbnail) {
  const m = thumbnail.match(/\/archived\/([^/]+)\/(\d+)\.jpg$/);
  if (!m) return null;
  const padded = m[2].padStart(4, '0');
  return `https://images.sourcelibrary.org/pages/${m[1]}/${padded}.jpg`;
}

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
    { visible: true, thumbnail: /\/archived\// },
    { projection: { _id: 1, id: 1, slug: 1, title: 1, thumbnail: 1 } }
  ).limit(Number.isFinite(LIMIT) ? LIMIT : 0);

  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}`);
  console.log(`scanning visible books with /archived/ thumbnail...`);

  let scanned = 0;
  let broken = 0;
  let cleared = 0;
  let queue = [];

  const flush = async () => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    await Promise.all(batch.map(async (book) => {
      const display = rewriteThumbToDisplayUrl(book.thumbnail);
      if (!display) return;
      const status = await head(display);
      if (status === 404) {
        broken++;
        if (APPLY) {
          await books.updateOne(
            { _id: book._id },
            { $unset: { thumbnail: '', thumbnail_blob: '' } }
          );
          cleared++;
        }
        const slug = book.slug || book.id || String(book._id);
        console.log(`  404  ${slug}  (${book.title?.slice(0, 60) || ''})`);
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

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
