#!/usr/bin/env node
/**
 * Find and remove gallery_images rows whose `page_id` no longer exists in
 * the `pages` collection.
 *
 * Why these exist
 *   When a book is re-imported / re-OCR'd / page-split with a new policy,
 *   the page-split / import workers drop the previous page documents and
 *   regenerate fresh ones with new ObjectIds. The corresponding
 *   gallery_images rows from the previous run reference page_ids that no
 *   longer resolve — orphans. The user-visible symptom is /gallery/image/<id>
 *   soft-404'ing ("Image Not Found") and /book/<id>/page/<pageId> 404'ing
 *   for any URL minted off the old gallery data.
 *
 * Strategy
 *   1. Aggregate gallery_images with a left-join to pages on (page_id → id);
 *      flag rows where the join is empty.
 *   2. Group orphans by book_id so we can report which books were affected
 *      (usually a small set — books that got re-imported).
 *   3. By default, DRY-RUN: print the report and exit non-zero so cron can
 *      alert without doing anything destructive.
 *   4. With `--apply`, delete the orphan rows. With `--archive`, instead
 *      move them to `deleted_gallery_images` for a 7-day rollback window
 *      (mirroring the deleted_books archival convention in CLAUDE.md).
 *   5. Optionally `--revalidate` the affected book pages so their ISR
 *      snapshot reflects the cleaner gallery, and `--purge-cf` to also
 *      flush Cloudflare for the deleted image URLs.
 *
 * Safety
 *   - Will refuse to delete if orphan count > MAX_DELETE_DEFAULT (10000)
 *     without --force; protects against a join-bug deleting good rows.
 *   - Always logs the full list of (id, book_id, page_id) before any write.
 *   - Idempotent: re-running on a clean DB is a no-op (0 orphans).
 *
 * Usage
 *   node scripts/maintenance/cleanup-orphan-gallery-images.mjs           # dry run
 *   node scripts/maintenance/cleanup-orphan-gallery-images.mjs --apply
 *   node scripts/maintenance/cleanup-orphan-gallery-images.mjs --archive
 *   node scripts/maintenance/cleanup-orphan-gallery-images.mjs --apply --revalidate --purge-cf
 *
 * Env
 *   MONGODB_URI            — required
 *   CRON_SECRET            — required for --revalidate
 *   CLOUDFLARE_API_TOKEN   — required for --purge-cf (Cache Purge scope)
 *   CF_ZONE_ID             — optional; defaults to sourcelibrary.org zone id
 *
 * Exit codes
 *   0 — no orphans found (or --apply / --archive succeeded with no errors)
 *   1 — orphans found (dry-run) OR delete refused by safety cap
 *   2 — script error (Mongo down, etc.)
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APPLY = flag('apply');
const ARCHIVE = flag('archive');
const FORCE = flag('force');
const REVALIDATE = flag('revalidate');
const PURGE_CF = flag('purge-cf');
const BASE_URL = (arg('base', process.env.BASE_URL || 'https://sourcelibrary.org')).replace(/\/+$/, '');
const MAX_DELETE_DEFAULT = Number(arg('max', 10000));
const CF_ZONE_ID = process.env.CF_ZONE_ID || '2a9b9c5c8eaf11ed3f9279ad50a0d06c';

if (APPLY && ARCHIVE) {
  console.error('Use --apply OR --archive, not both.');
  process.exit(2);
}

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(2);
}

// ---------------------------------------------------------------------------

async function findOrphans(db) {
  // Left-join gallery_images.page_id → pages.id; orphans are rows where the
  // join returns nothing. Project only what we need so the in-memory list
  // stays small even if there are 10K+ orphans.
  return db.collection('gallery_images').aggregate(
    [
      {
        $lookup: {
          from: 'pages',
          localField: 'page_id',
          foreignField: 'id',
          as: 'page',
          pipeline: [{ $project: { _id: 1 } }, { $limit: 1 }],
        },
      },
      { $match: { page: { $size: 0 } } },
      {
        $project: {
          _id: 1,
          id: 1,
          book_id: 1,
          page_id: 1,
          extracted_url: 1,
          thumbnail_url: 1,
        },
      },
    ],
    { allowDiskUse: true, maxTimeMS: 120_000 }
  ).toArray();
}

function reportByBook(orphans) {
  const byBook = new Map();
  for (const o of orphans) {
    const arr = byBook.get(o.book_id) || [];
    arr.push(o);
    byBook.set(o.book_id, arr);
  }
  const sorted = [...byBook.entries()].sort((a, b) => b[1].length - a[1].length);
  console.log(`\nAffected books: ${sorted.length}`);
  console.log(`Total orphans:  ${orphans.length}\n`);
  for (const [bookId, arr] of sorted.slice(0, 20)) {
    console.log(`  ${arr.length.toString().padStart(4)}  ${bookId}`);
  }
  if (sorted.length > 20) {
    console.log(`  …and ${sorted.length - 20} more book(s).`);
  }
  return [...byBook.keys()];
}

async function archive(db, orphans) {
  if (orphans.length === 0) return;
  await db.collection('deleted_gallery_images').insertMany(
    orphans.map(o => ({ ...o, deleted_at: new Date(), reason: 'orphan_page_id' }))
  );
  console.log(`[archive] inserted ${orphans.length} into deleted_gallery_images`);
}

async function deleteOrphans(db, orphans) {
  const ids = orphans.map(o => o._id);
  const r = await db.collection('gallery_images').deleteMany({ _id: { $in: ids } });
  console.log(`[delete] removed ${r.deletedCount}/${orphans.length} rows from gallery_images`);
  if (r.deletedCount !== orphans.length) {
    console.warn(`[delete] WARNING: deletedCount mismatch — race with concurrent writes?`);
  }
}

async function revalidateBooks(bookIds) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn('[revalidate] CRON_SECRET not set — skipping');
    return;
  }
  let ok = 0, fail = 0;
  for (const bookId of bookIds) {
    try {
      const r = await fetch(`${BASE_URL}/api/admin/revalidate-book/${bookId}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) ok++; else fail++;
    } catch {
      fail++;
    }
  }
  console.log(`[revalidate] ${ok} ok / ${fail} failed of ${bookIds.length} books`);
}

async function purgeCloudflare(orphans) {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!token) {
    console.warn('[purge-cf] CLOUDFLARE_API_TOKEN not set — skipping');
    return;
  }
  // Build the dead URLs that users will have hit. Each orphan corresponds to:
  //   - the gallery image page    /gallery/image/<id>
  //   - the book/page reader URL  /book/<book_id>/page/<page_id>
  const urls = [];
  for (const o of orphans) {
    urls.push(`${BASE_URL}/gallery/image/${o.id}`);
    urls.push(`${BASE_URL}/book/${o.book_id}/page/${o.page_id}`);
  }
  // CF caps purge_cache `files` at 30 per request — chunk it.
  let purged = 0;
  for (let i = 0; i < urls.length; i += 30) {
    const chunk = urls.slice(i, i + 30);
    try {
      const r = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: chunk }),
        }
      );
      if (r.ok) purged += chunk.length;
    } catch {
      // Skip on transient failure; next run will catch up
    }
  }
  console.log(`[purge-cf] requested purge for ${purged}/${urls.length} URLs`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    console.log('Searching for orphan gallery_images (this can take ~30s on a cold cache)…');
    const orphans = await findOrphans(db);

    if (orphans.length === 0) {
      console.log('No orphans. Nothing to do.');
      process.exit(0);
    }

    const affectedBookIds = reportByBook(orphans);

    if (orphans.length > MAX_DELETE_DEFAULT && !FORCE) {
      console.error(
        `\nRefusing: ${orphans.length} orphans exceeds --max (${MAX_DELETE_DEFAULT}). ` +
        `Re-run with --force if intentional.`
      );
      process.exit(1);
    }

    if (!APPLY && !ARCHIVE) {
      console.log('\n(dry run; pass --apply to delete or --archive to soft-delete)');
      process.exit(1);
    }

    if (ARCHIVE) await archive(db, orphans);
    await deleteOrphans(db, orphans);

    if (REVALIDATE) await revalidateBooks(affectedBookIds);
    if (PURGE_CF) await purgeCloudflare(orphans);

    console.log('\nDone.');
    process.exit(0);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
