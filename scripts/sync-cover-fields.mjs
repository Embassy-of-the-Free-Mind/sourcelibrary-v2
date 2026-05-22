#!/usr/bin/env node
/**
 * Sync legacy cover fields (thumbnail / thumbnail_blob) to agree with the
 * canonical fields (image_display / image_thumb) for books where they diverge.
 *
 * Rationale: `getBookThumbnailUrl()` prefers image_display. When thumbnail
 * and image_display point to different pages, the book detail page (which reads
 * thumbnail) and the embed gallery (which reads image_display via the helper)
 * show different covers. Aligning thumbnail → image_display makes all read
 * paths agree without changing which image is visible on the gallery.
 *
 * Safety rules:
 *   - Skip books with thumbnail_source === 'manual' (human-curated override).
 *   - Only touch books where image_display IS set (never blindly clear thumbnail).
 *   - Dry-run by default; pass --apply to write.
 *   - Can be scoped with --provider bph (default) or --all.
 *   - Can target a single book with --id <book_id>.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/sync-cover-fields.mjs --dry-run       # preview (default)
 *   node scripts/sync-cover-fields.mjs --apply          # write changes
 *   node scripts/sync-cover-fields.mjs --apply --all    # all visible books
 *   node scripts/sync-cover-fields.mjs --apply --id 69c85eca6c6f3cc53c8552ec
 */

import { MongoClient } from 'mongodb';

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--apply');
const ALL = args.includes('--all');
const ONLY_ID = (() => {
  const i = args.indexOf('--id');
  return i !== -1 ? args[i + 1] : null;
})();
const PROVIDER = (() => {
  const i = args.indexOf('--provider');
  return i !== -1 ? args[i + 1] : 'bph';
})();

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(1);
}

function normalize(u) {
  if (!u) return null;
  return u
    .replace(/-thumb\.jpg(\?.*)?$/, '.jpg')
    .replace(/-full\.jpg(\?.*)?$/, '.jpg');
}

const client = new MongoClient(MONGODB_URI);
await client.connect();
try {
  const db = client.db('bookstore');

  const baseMatch = { visible: true, image_display: { $exists: true, $ne: null } };
  if (ONLY_ID) {
    baseMatch.id = ONLY_ID;
  } else if (!ALL) {
    baseMatch['image_source.provider'] = PROVIDER;
  }

  const cursor = db.collection('books').find(baseMatch, {
    projection: {
      id: 1, slug: 1, title: 1,
      image_display: 1, image_thumb: 1,
      thumbnail: 1, thumbnail_blob: 1,
      thumbnail_source: 1,
    },
  });

  let checked = 0;
  let skippedManual = 0;
  let alreadyInSync = 0;
  let fixed = 0;
  let errors = 0;

  for await (const b of cursor) {
    checked++;

    if (b.thumbnail_source === 'manual') {
      skippedManual++;
      continue;
    }

    const displayNorm = normalize(b.image_display);
    const thumbNorm = normalize(b.thumbnail);

    if (displayNorm === thumbNorm) {
      alreadyInSync++;
      continue;
    }

    // image_thumb: prefer what's already set if it matches image_display;
    // otherwise mirror image_display (the thumb variant if available).
    const newThumb = b.image_thumb || b.image_display;

    console.log(`${DRY_RUN ? '[DRY]' : '[FIX]'} ${b.id} ${(b.slug || '').slice(0, 55)}`);
    console.log(`  image_display: ${b.image_display}`);
    console.log(`  thumbnail    : ${b.thumbnail}`);

    if (!DRY_RUN) {
      try {
        await db.collection('books').updateOne(
          { id: b.id },
          {
            $set: {
              thumbnail: b.image_display,
              thumbnail_blob: newThumb,
            },
          },
        );
        fixed++;
      } catch (err) {
        console.error(`  ERROR: ${err.message}`);
        errors++;
      }
    } else {
      fixed++;
    }
  }

  console.log('\n--- Summary ---');
  console.log(`checked       : ${checked}`);
  console.log(`already in sync: ${alreadyInSync}`);
  console.log(`skipped manual : ${skippedManual}`);
  console.log(`${DRY_RUN ? 'would fix' : 'fixed'}   : ${fixed}`);
  if (errors) console.log(`errors        : ${errors}`);
  if (DRY_RUN) console.log('\nDry-run complete. Pass --apply to write changes.');
} finally {
  await client.close();
}
