#!/usr/bin/env node
/**
 * Fix page docs whose thumbnail fields point at the FULL-RES image instead of
 * the small pre-sized thumbnail.
 *
 * Symptom: the "Choose Cover Image" picker (and any grid that reads
 * `image_thumb` / `thumbnail_blob` directly) downloads multi-MB `…-full.jpg`
 * scans where it should load the ~2 KB `…-thumb.jpg`. Seen on legacy-split BPH
 * books (e.g. books-of-alchemy-geber, 6970e3609b09d309d780a266) where an old
 * split/thumbnail pass wrote the `pages/{book}/{NNNN}-full.jpg` URL into the
 * thumb fields. The matching `{NNNN}-thumb.jpg` exists on R2 — it's just not
 * referenced.
 *
 * This is a PURE SIZE SWAP of the identical image (`-full` → `-thumb`), built
 * together by the variant generator, so it never changes WHICH image a page
 * shows — only its byte size. We HEAD-verify the `-thumb.jpg` exists before
 * writing; if it's missing we leave the field untouched.
 *
 * Out of scope (left for the resolver's /api/image proxy to size at render
 * time): legacy `/cropped/{objectid}.jpg` URLs, which have no derivable
 * pre-sized sibling and would need a fresh thumbnail generated.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/fix-fullres-page-thumbs.mjs --book <bookId>          # dry run, one book
 *   node scripts/maintenance/fix-fullres-page-thumbs.mjs --book <bookId> --apply  # write, one book
 *   node scripts/maintenance/fix-fullres-page-thumbs.mjs --all                    # dry run, whole library
 *   node scripts/maintenance/fix-fullres-page-thumbs.mjs --all --apply            # write, whole library
 */

import { MongoClient } from 'mongodb';

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const bookIdx = process.argv.indexOf('--book');
const BOOK_ID = bookIdx !== -1 ? process.argv[bookIdx + 1] : null;
const CONCURRENCY = 24;

// Heavy field value we want to replace: a canonical pages/ full-res image.
// images.sourcelibrary.org/pages/{book}/{digits}-full.jpg
const FULL_RE = /^(https:\/\/images\.sourcelibrary\.org\/pages\/[a-f0-9-]+\/\d{3,})-full\.jpg$/;
const THUMB_FIELDS = ['image_thumb', 'thumbnail_blob'];

const headCache = new Map();
async function exists(url) {
  if (headCache.has(url)) return headCache.get(url);
  let ok = false;
  try {
    const r = await fetch(url, { method: 'HEAD' });
    ok = r.status === 200;
  } catch {
    ok = false;
  }
  headCache.set(url, ok);
  return ok;
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI not set. source .env.production.local first.');
    process.exit(1);
  }
  if (!ALL && !BOOK_ID) {
    console.error('Pass --book <bookId> or --all.');
    process.exit(1);
  }

  const client = new MongoClient(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 30000,
    socketTimeoutMS: 0,
  });
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const pages = db.collection('pages');

  // Match pages where EITHER thumb field is a -full.jpg pages URL.
  const fullRegex = { $regex: '^https://images\\.sourcelibrary\\.org/pages/[a-f0-9-]+/\\d{3,}-full\\.jpg$' };
  const query = {
    $or: [{ image_thumb: fullRegex }, { thumbnail_blob: fullRegex }],
  };
  if (BOOK_ID) query.book_id = BOOK_ID;

  console.log(`mode: ${APPLY ? 'APPLY (writes will happen)' : 'DRY RUN (no writes)'}  scope: ${BOOK_ID ? `book ${BOOK_ID}` : 'ALL books'}`);

  const cursor = pages.find(query, {
    projection: { _id: 1, book_id: 1, page_number: 1, image_thumb: 1, thumbnail_blob: 1 },
  });

  let scanned = 0, fixable = 0, written = 0, missingThumb = 0;
  let queue = [];

  const flush = async () => {
    if (queue.length === 0) return;
    const batch = queue.splice(0, queue.length);
    await Promise.all(batch.map(async (page) => {
      const set = {};
      for (const field of THUMB_FIELDS) {
        const val = page[field];
        const m = val && FULL_RE.exec(val);
        if (!m) continue;
        const thumbUrl = `${m[1]}-thumb.jpg`;
        if (await exists(thumbUrl)) {
          set[field] = thumbUrl;
        } else {
          missingThumb++;
        }
      }
      if (Object.keys(set).length === 0) return;
      fixable++;
      if (APPLY) {
        await pages.updateOne({ _id: page._id }, { $set: { ...set, updated_at: new Date() } });
        written++;
      }
      if (fixable <= 10 || fixable % 200 === 0) {
        console.log(`  fix ${page.book_id} p${page.page_number}: ${Object.keys(set).join(',')} -> -thumb.jpg`);
      }
    }));
  };

  for await (const page of cursor) {
    scanned++;
    queue.push(page);
    if (queue.length >= CONCURRENCY) await flush();
    if (scanned % 1000 === 0) console.log(`  ...scanned ${scanned}, fixable ${fixable}`);
  }
  await flush();

  console.log('---');
  console.log(`scanned (matched -full thumb):   ${scanned}`);
  console.log(`fixable (thumb sibling exists):  ${fixable}`);
  console.log(`thumb sibling MISSING (skipped): ${missingThumb}`);
  console.log(`written:                         ${written}${APPLY ? '' : ' (dry run — re-run with --apply)'}`);

  await client.close();
}

main().catch(err => { console.error('FAILED:', err); process.exit(1); });
