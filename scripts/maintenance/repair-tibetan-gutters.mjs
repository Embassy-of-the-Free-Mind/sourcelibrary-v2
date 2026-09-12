#!/usr/bin/env node
/**
 * Repair the tile-stitch gutter damage on Tibetan page masters (#4534, from #4523).
 *
 * WHAT HAPPENED
 * -------------
 * `rearchive-iiif-fullres.mjs` (pre-#4531) sized its tile stride from EAP's
 * ADVERTISED 2000px cap while EAP silently serves 1200px, so every archived
 * master got a 2000px grid of 1200px tiles pasted top-left onto white canvas —
 * masters ~60% white with full-span gutters through every line of text. It
 * rewrote `photo` as well as `archived_photo`, so readers, IIIF and OCR all got
 * the gapped image. Scope (measured, #4523 handoff): the 167 Tibetan books /
 * 80,981 pages; 1,501 sampled non-Tibetan cohort pages showed zero damage.
 *
 * WHY THIS IS A SEPARATE SCRIPT, NOT A RERUN OF THE REARCHIVER
 * ------------------------------------------------------------
 * Two of the rearchiver's own safety features block exactly this repair:
 *   - `--min-upgrade-ratio` (default 1.5): damaged archives are ALREADY at
 *     native dimensions — they just have holes. Ratio ≈ 1.0 → every page skipped.
 *   - the #3186 phash alignment guard compares fetched(photo_original) against
 *     the CURRENT archived_photo. A guttered archive never phash-matches a
 *     correct fetch, so the guard reads damage as misalignment and blocks the
 *     book. (Alignment itself is not in doubt here: the rearchiver verified it
 *     against the pre-damage archives before it overwrote them.)
 *
 * DESIGN — selection and success are both PIXEL-VERIFIED, same instrument:
 *   for each candidate page (Tibetan books, image_metadata.upgraded_at set):
 *     1. fetch current archived_photo, measure()      -> must be GUTTERED, else skip
 *        (the marker is the cohort, never proof — clean pages are untouched)
 *     2. refetch via the FIXED fetchIiifNativeRes     -> probes the real served
 *        tile size and THROWS on any short tile (#4531), so a gapped master
 *        cannot be produced again
 *     3. measure() the new buffer                     -> must be CLEAN, else record + skip
 *     4. $unset archived_photo BEFORE writing         -> a crash between unset and
 *        write leaves the page visibly "unarchived" (recoverable by the normal
 *        archiver), never wearing a wrong value that hides it from every later
 *        sweep (CLAUDE.md Data Protection corollary)
 *     5. r2Put to the SAME key, regenerateVariants, then $set
 *        archived_photo/photo + image_metadata.gutter_repaired_at
 *
 * Re-runs converge for free: repaired pages measure clean at step 1 and are
 * skipped. Every skip is written to the report file — absence is never silent.
 *
 * RATE LIMITS: EAP fetches go through rateLimitedFetch (per-domain politeness);
 * on top of that this file aborts after 5 consecutive fetch failures or any
 * 429/403 streak — the #4490 lesson: the guard travels with THIS file.
 *
 * Run on Hetzner, never the laptop (bulk egress; ~81k pages ≈ a day of wall
 * clock, EAP rate limits dominate). NEVER run before PR #4531's fetcher is
 * deployed (it is: merged as 1dc8afbf).
 *
 * Usage:
 *   node --env-file=.env.production.local scripts/maintenance/repair-tibetan-gutters.mjs \
 *     --dry-run --limit=20            # measure + report only, no writes
 *   node --env-file=.env.production.local scripts/maintenance/repair-tibetan-gutters.mjs \
 *     --book-id=<id>                  # one book
 *   node --env-file=.env.production.local scripts/maintenance/repair-tibetan-gutters.mjs
 *                                     # full damaged cohort
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { fetchIiifNativeRes, isIiifUrl } from '../lib/iiif-utils.mjs';
import { measure } from '../lib/gutter-measure.mjs';
import { generateDisplayVariants } from '../workers/lib/display-image.mjs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const FLAG = (f) => process.argv.includes(f);
const ARG = (n, d) => process.argv.find((a) => a.startsWith(`${n}=`))?.split('=')[1] ?? d;

const DRY_RUN = FLAG('--dry-run');
const BOOK_ID = ARG('--book-id', null);
const LIMIT = parseInt(ARG('--limit', '0'), 10);
// Wall-clock at ~11s/page serial is ~9 days for the 81k cohort (EAP politeness
// dominates). Shard BY BOOK so N processes never touch the same page:
//   --shard=0 --shards=3   etc. Keep N small (<=3) — politeness is per-process.
const SHARD = parseInt(ARG('--shard', '0'), 10);
const SHARDS = parseInt(ARG('--shards', '1'), 10);
const REPORT = ARG('--report', `scripts/output/gutter-repair-${new Date().toISOString().slice(0, 10)}.jsonl`);
const ABORT_STREAK = 5;

const mongo = new MongoClient(process.env.MONGODB_URI);
await mongo.connect();
const db = mongo.db('bookstore');

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function r2Put(key, buffer, contentType = 'image/jpeg') {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

/** Same-key display/thumb regeneration as the rearchiver (reader serves these). */
async function regenerateVariants(page, masterBuffer) {
  const toKey = (url) =>
    typeof url === 'string' && url.startsWith(`${R2_PUBLIC_URL}/`)
      ? url.slice(R2_PUBLIC_URL.length + 1)
      : null;
  const displayKey = toKey(page.display_photo);
  const thumbKey = toKey(page.image_thumb) || toKey(page.thumbnail_blob);
  if (!displayKey && !thumbKey) return;
  const { display, thumb } = await generateDisplayVariants(masterBuffer, {
    bookId: page.book_id, pageNumber: page.page_number,
  });
  if (displayKey) await r2Put(displayKey, display);
  if (thumbKey) await r2Put(thumbKey, thumb);
}

const report = fs.createWriteStream(REPORT, { flags: 'a' });
const record = (row) => report.write(`${JSON.stringify({ ...row, at: new Date().toISOString() })}\n`);

// ── Candidate books: Tibetan, unless a single book is named ──
const bookQuery = BOOK_ID
  ? { id: BOOK_ID }
  : { $or: [{ language: /tibetan/i }, { original_language: /tibetan/i }, { languages: /tibetan/i }] };
const allBooks = await db.collection('books')
  .find(bookQuery, { projection: { id: 1, title: 1 } }).toArray();
const books = allBooks.filter((_, i) => i % SHARDS === SHARD);
console.log(`candidate books: ${books.length}/${allBooks.length} (shard ${SHARD}/${SHARDS})${DRY_RUN ? '  [DRY RUN]' : ''}`);

let fetchFailStreak = 0;
const totals = { measured: 0, guttered: 0, repaired: 0, cleanSkip: 0, stillBad: 0, errors: 0 };

for (const book of books) {
  const pages = await db.collection('pages').find(
    {
      book_id: book.id,
      'image_metadata.upgraded_at': { $exists: true },
      archived_photo: { $type: 'string', $ne: '' },
    },
    {
      projection: {
        _id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1,
        archived_photo: 1, display_photo: 1, image_thumb: 1, thumbnail_blob: 1,
      },
    },
  ).sort({ page_number: 1 }).toArray();
  if (!pages.length) continue;

  let bookRepaired = 0;
  for (const page of pages) {
    if (LIMIT && totals.measured >= LIMIT) break;
    const id = `${book.id}/${page.page_number}`;
    try {
      // 1. Measure the CURRENT archive. The marker selected the cohort; only
      //    the pixels select the page.
      const curRes = await fetch(page.archived_photo);
      if (!curRes.ok) {
        record({ id, status: `current-fetch:${curRes.status}` });
        totals.errors++;
        fetchFailStreak++;
        if (fetchFailStreak >= ABORT_STREAK) throw new Error(`ABORT: ${ABORT_STREAK} consecutive fetch failures`);
        continue;
      }
      fetchFailStreak = 0;
      const current = Buffer.from(await curRes.arrayBuffer());
      const before = await measure(current);
      totals.measured++;
      if (!before.guttered) {
        totals.cleanSkip++;
        record({ id, status: 'clean-skip', white: +before.white.toFixed(3) });
        continue;
      }
      totals.guttered++;

      const sourceUrl = page.photo_original;
      if (!sourceUrl || !isIiifUrl(sourceUrl)) {
        record({ id, status: 'no-iiif-source', guttered: true });
        totals.errors++;
        continue;
      }

      // 2. Refetch at native res. The fixed fetcher probes the truly-served
      //    tile size and throws on any short tile — it cannot rebuild a gap.
      let fetched;
      try {
        fetched = await fetchIiifNativeRes(sourceUrl);
      } catch (e) {
        record({ id, status: `refetch-fail:${(e.message || '').slice(0, 100)}`, guttered: true });
        totals.errors++;
        fetchFailStreak++;
        if (fetchFailStreak >= ABORT_STREAK) throw new Error(`ABORT: ${ABORT_STREAK} consecutive refetch failures`);
        continue;
      }
      fetchFailStreak = 0;

      // 3. Success criterion, same instrument as selection.
      const after = await measure(fetched.buffer);
      if (after.guttered) {
        totals.stillBad++;
        record({ id, status: 'refetched-still-guttered', width: after.width, white: +after.white.toFixed(3) });
        continue;
      }

      if (DRY_RUN) {
        totals.repaired++;
        record({ id, status: 'would-repair', before_white: +before.white.toFixed(3), after_white: +after.white.toFixed(3), dims: `${after.width}x${after.height}` });
        continue;
      }

      // 4. $unset BEFORE the write: if we die between here and the $set, the
      //    page reads as unarchived (recoverable by the normal archiver) rather
      //    than wearing a value that hides it from every later sweep.
      await db.collection('pages').updateOne({ _id: page._id }, { $unset: { archived_photo: '' }, $set: { updated_at: new Date() } });

      // 5. Write master + variants, then restore the pointers.
      const key = `archived/${book.id}/${page.page_number}.jpg`;
      assertBookScopedKey(key, book.id, 'repair-tibetan-gutters');
      const newUrl = await r2Put(key, fetched.buffer);
      await regenerateVariants(page, fetched.buffer);
      await db.collection('pages').updateOne(
        { _id: page._id },
        {
          $set: {
            archived_photo: newUrl,
            photo: newUrl,
            'image_metadata.width': after.width,
            'image_metadata.height': after.height,
            'image_metadata.gutter_repaired_at': new Date(),
            updated_at: new Date(),
          },
        },
      );
      totals.repaired++;
      bookRepaired++;
      record({ id, status: 'repaired', before_white: +before.white.toFixed(3), after_white: +after.white.toFixed(3), dims: `${after.width}x${after.height}`, tiles: fetched.tiles });
    } catch (e) {
      if (String(e.message).startsWith('ABORT')) {
        record({ id, status: 'run-aborted', error: e.message });
        console.error(e.message);
        report.end();
        await mongo.close();
        process.exit(2);
      }
      totals.errors++;
      record({ id, status: `error:${(e.message || '').slice(0, 120)}` });
    }
  }
  if (bookRepaired) console.log(`  ${book.id} ${String(book.title || '').slice(0, 50)}: repaired ${bookRepaired}`);
  if (LIMIT && totals.measured >= LIMIT) break;
}

console.log(JSON.stringify(totals));
record({ status: 'run-summary', ...totals });
report.end();
await mongo.close();
