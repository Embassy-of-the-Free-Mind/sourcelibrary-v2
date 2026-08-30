/**
 * Backfill the 500px `-card.avif` cover variant.
 *
 * WHY
 * ---
 * R2 stores two cover sizes and nothing between them: `-thumb.jpg` (150px) and
 * the bare `.jpg`, documented as "1200px display" but in practice the archival
 * scan at ~2000px / ~750KB. A catalogue card renders in a 163–265px slot
 * (326–530px at 2× DPR), so every grid pulls the 2000px file: measured
 * 2026-08-26, the 60-card /catalog grid ships 43.4 MB and its slowest covers
 * take 6–10s. Neither existing variant fits the slot — the thumb upscales 3.3×
 * and reads soft (which is what PR #4212 was working around by lowering
 * THUMB_WIDTH_THRESHOLD to 200, at the cost of sending mobile the 2000px file).
 *
 * This writes the missing middle tier: 500px AVIF q55, ~47 KB median. 500px
 * covers a phone at 3× DPR (489px) exactly and the widest desktop card at 2×
 * (530px) within 6%. Measured over 40 real catalogue covers: 746 KB avg → 47 KB
 * avg, p90 94 KB, worst 105 KB — a 16× reduction, 43.4 MB → 2.8 MB per grid.
 *
 * Format note: resizing is the 12× and AVIF is a further ~1.35×. AVIF at the
 * SOURCE resolution is still 804 KB, so the resize is the load-bearing half.
 *
 * The archival scan is never touched, re-encoded or deleted — the reader,
 * downloads and deep zoom keep reading it. This is purely additive.
 *
 * SAFETY
 * ------
 * Writes `books.image_card` only after the R2 PUT succeeds, so the pointer can
 * never name an object that does not exist. The card component reads the
 * pointer rather than deriving the URL by convention, which is what stops the
 * "derived a -thumb.jpg sibling that 404s" class of broken cover (homepage
 * smoke-test failure, 2026-07-08; see src/lib/book-cover-loader.ts).
 *
 * Every key goes through assertBookScopedKey (#3362) — a page-image key that
 * does not contain its own book id is shared between books by construction.
 *
 * Idempotent and resumable: books that already have `image_card` are skipped,
 * so this can be stopped and restarted, or run in slices, without redoing work.
 *
 * ORDER
 * -----
 * read_count DESC, then first translations, then the rest — so the covers
 * people actually look at (the "popular" catalogue sort, the homepage, the
 * collection sliders) are fixed in the first couple of minutes rather than the
 * last.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-cover-cards.mjs --dry-run --limit=50
 *   node scripts/maintenance/backfill-cover-cards.mjs --limit=500
 *   node scripts/maintenance/backfill-cover-cards.mjs            # everything
 *
 * Flags:
 *   --dry-run        resolve + encode but write nothing (no R2 PUT, no Mongo)
 *   --limit=N        stop after N books
 *   --book-id=ID     one book, for spot checks
 *   --concurrency=N  default 10 (measured ceiling; R2 fetch is the bottleneck)
 *   --width=N        default 500
 *   --quality=N      default 55
 *   --force          rebuild even when image_card is already set
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const arg = (name, fallback = null) => {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const LIMIT = Number(arg('limit', 0)) || 0;
const BOOK_ID = arg('book-id');
const CONCURRENCY = Number(arg('concurrency', 10)) || 10;
const WIDTH = Number(arg('width', 500)) || 500;
const QUALITY = Number(arg('quality', 55)) || 55;

const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\s+/g, '');
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, MONGODB_URI } = process.env;

if (!MONGODB_URI) { console.error('MONGODB_URI must be set'); process.exit(1); }
if (!DRY_RUN && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set (or pass --dry-run)');
  process.exit(1);
}

const s3 = DRY_RUN ? null : new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

// Stored URLs occasionally carry stray whitespace from a past run where
// R2_PUBLIC_URL had a trailing newline. Strip it before deriving any key.
const cleanUrl = u => { const s = (u || '').replace(/\s+/g, '').trim(); return s || null; };

/**
 * Resolve a book's cover to the R2 page-scan URL we should re-cut from.
 *
 * Mirrors getBookThumbnailUrl(book, 'display') in src/lib/utils.ts for the R2
 * families that carry a full-size sibling. Anything it cannot map to a
 * `pages/` or `cropped/` object is skipped rather than guessed at — external
 * IIIF, Wikimedia and one-off uploads have no variant to write next to.
 */
function resolveSource(book) {
  const raw = cleanUrl(book.image_display || book.thumbnail || book.thumbnail_blob);
  if (!raw || !raw.includes('images.sourcelibrary.org/')) return null;

  // /archived/{bookId}/{n}.jpg and /thumbnails/{bookId}/{n}.jpg both name a
  // page whose canonical three-variant home is /pages/{bookId}/{NNNN}.jpg.
  const legacy = raw.match(/\/(?:archived|thumbnails)\/([^/]+)\/(\d+)\.jpg$/);
  if (legacy) {
    const [, bookId, num] = legacy;
    return `${R2_PUBLIC_URL}/pages/${bookId}/${num.padStart(4, '0')}.jpg`;
  }

  // Canonical page scans — normalise whichever suffix is stored to the display
  // variant. Anchored to the /pages/ scan path so the PDF-import blob path
  // `/books/{id}/pages/NNNN.jpg` (single-variant) is left alone.
  if (raw.includes('images.sourcelibrary.org/pages/')) {
    return raw.replace(/-thumb\.jpg$/, '.jpg').replace(/-full\.jpg$/, '.jpg');
  }

  // Cropped covers carry the same three-variant convention.
  if (raw.includes('images.sourcelibrary.org/cropped/')) {
    return raw.replace(/-thumb\.jpg$/, '.jpg').replace(/-full\.jpg$/, '.jpg');
  }

  return null;
}

/** `.../pages/{id}/0005.jpg` → `pages/{id}/0005-card.avif` */
function cardKeyFrom(sourceUrl) {
  const path = sourceUrl.split('?')[0].replace(`${R2_PUBLIC_URL}/`, '');
  if (!/\.jpg$/.test(path)) return null;
  return path.replace(/\.jpg$/, `-card.avif`);
}

async function processPool(items, concurrency, fn) {
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      try { await fn(items[i], i); } catch (err) { items[i]._error = err?.message || String(err); }
    }
  });
  await Promise.all(workers);
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'bookstore');
  const books = db.collection('books');

  const query = BOOK_ID
    ? { $or: [{ id: BOOK_ID }, { _id: BOOK_ID }, { slug: BOOK_ID }] }
    : {
        visible: true,
        pages_count: { $gt: 0 },
        image_display: { $type: 'string' },
        ...(FORCE ? {} : { image_card: { $exists: false } }),
      };

  const cursor = books.find(query, {
    projection: { _id: 1, id: 1, slug: 1, title: 1, image_display: 1, thumbnail: 1, thumbnail_blob: 1, read_count: 1, is_first_translation: 1 },
  }).sort({ read_count: -1, is_first_translation: -1, _id: 1 });
  if (LIMIT) cursor.limit(LIMIT);

  const candidates = await cursor.toArray();
  console.log(`${DRY_RUN ? 'DRY RUN — nothing will be written\n' : ''}candidates: ${candidates.length}   ${WIDTH}px AVIF q${QUALITY}   concurrency ${CONCURRENCY}\n`);

  const stats = { done: 0, skipped: 0, failed: 0, srcBytes: 0, outBytes: 0 };
  const skipReasons = new Map();
  const samples = [];
  const started = Date.now();

  await processPool(candidates, CONCURRENCY, async (book) => {
    const bookId = book.id || String(book._id);
    const source = resolveSource(book);
    if (!source) {
      stats.skipped++;
      const why = 'no R2 page-scan source';
      skipReasons.set(why, (skipReasons.get(why) || 0) + 1);
      return;
    }

    const key = cardKeyFrom(source);
    if (!key) { stats.skipped++; skipReasons.set('unmappable key', (skipReasons.get('unmappable key') || 0) + 1); return; }

    // #3362 — a page-image key must carry its own book id, or it is shared.
    assertBookScopedKey(key, bookId, 'backfill-cover-cards');

    const resp = await fetch(source, { signal: AbortSignal.timeout(45000) });
    if (!resp.ok) {
      stats.skipped++;
      const why = `source HTTP ${resp.status}`;
      skipReasons.set(why, (skipReasons.get(why) || 0) + 1);
      return;
    }
    const src = Buffer.from(await resp.arrayBuffer());

    const card = await sharp(src)
      .resize(WIDTH, null, { fit: 'inside', withoutEnlargement: true })
      .avif({ quality: QUALITY, effort: 3 })
      .toBuffer();

    stats.srcBytes += src.length;
    stats.outBytes += card.length;
    if (samples.length < 12) {
      samples.push({ title: (book.title || bookId).slice(0, 44), src: src.length, out: card.length, key });
    }

    if (!DRY_RUN) {
      await s3.send(new PutObjectCommand({
        Bucket: R2_BUCKET, Key: key, Body: card, ContentType: 'image/avif',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      // Pointer written only after the object exists.
      await books.updateOne({ _id: book._id }, { $set: { image_card: `${R2_PUBLIC_URL}/${key}` } });
    }
    stats.done++;
  });

  const failures = candidates.filter(b => b._error);
  stats.failed = failures.length;
  const secs = (Date.now() - started) / 1000;

  console.log('sample of what was produced:');
  for (const s of samples) {
    console.log(`  ${s.title.padEnd(46)} ${String(Math.round(s.src / 1024)).padStart(5)} KB -> ${String(Math.round(s.out / 1024)).padStart(4)} KB   ${s.key}`);
  }

  console.log(`\nconverted : ${stats.done}`);
  console.log(`skipped   : ${stats.skipped}`);
  for (const [why, n] of [...skipReasons].sort((a, b) => b[1] - a[1])) console.log(`            ${n} × ${why}`);
  console.log(`failed    : ${stats.failed}`);
  for (const f of failures.slice(0, 5)) console.log(`            ${f.id || f._id}: ${f._error}`);
  if (stats.done) {
    console.log(`\nbytes     : ${(stats.srcBytes / 1048576).toFixed(1)} MB -> ${(stats.outBytes / 1048576).toFixed(2)} MB   (${(stats.srcBytes / stats.outBytes).toFixed(0)}× smaller)`);
    console.log(`average   : ${Math.round(stats.srcBytes / stats.done / 1024)} KB -> ${Math.round(stats.outBytes / stats.done / 1024)} KB`);
  }
  console.log(`elapsed   : ${secs.toFixed(1)}s  (${(stats.done / secs).toFixed(1)} books/s)`);
  if (stats.done) {
    const remaining = 16800 - stats.done;
    console.log(`projected : ~${Math.round(remaining / (stats.done / secs) / 60)} min for the remaining ~${remaining.toLocaleString('en-US')} covers`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
