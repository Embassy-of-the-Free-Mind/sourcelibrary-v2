#!/usr/bin/env node
/**
 * Repair books whose `thumbnail`/`image_display` point at a FULL-RES scan —
 * issue #4337 (real-user report: "Super slow on this page").
 *
 * Symptom: /book/the-lament-for-urim shipped ~91 MB of images — related-book
 * cards rendered `thumbnails/{bookId}.jpg` objects of 13–27 MB (5306×9957 px
 * CDLI tablet photos). 386 books (383 visible) have `thumbnail` matching the
 * flat `thumbnails/{24-hex}.jpg` form; sampled 30 → 20 objects were >500 KB.
 *
 * Root cause: repair-cover-thumbs.mjs v2 ("book-level fallback",
 * thumbnail_source: cover-thumb-repair-booklevel) generated a 150px
 * `book-thumbnails/{id}-thumb.jpg` and repointed ONLY the thumb-tier fields
 * (image_thumb/thumbnail_blob), deliberately leaving `thumbnail` and
 * `image_display` at the full image "for the detail view". But card surfaces
 * read the DISPLAY tier (getBookThumbnailUrl 'display' → image_display ||
 * thumbnail), so cards got the full scan. next/image srcSet can't save us:
 * the #1727 cost policy loader returns the stored URL at every width.
 *
 * What this does, per affected book:
 *   1. Fetch the fat `thumbnails/{id}.jpg` (the only large source these books
 *      have — no pages/, no archived/ variants).
 *   2. Generate 1200px display + 600px card variants (same ladder as
 *      repair-cover-thumbs / #2401 card spec) and upload to
 *      `book-thumbnails/{id}.jpg` and `book-thumbnails/{id}-card.jpg`.
 *      The existing 150px `book-thumbnails/{id}-thumb.jpg` is left alone.
 *   3. Repoint Mongo: image_display → 1200px, thumbnail → 600px card,
 *      thumbnail_source → 'fat-thumb-repair-4337', bump updated_at (so the
 *      incremental sync-books-catalog cron propagates to the Supabase grid —
 *      books_catalog mirrors `thumbnail`).
 *   4. Record a sweep_log row with the before/after URLs (field-sprawl rule:
 *      rows, not columns).
 *
 * Books where the fat object is already small (<300 KB) are still migrated to
 * the variant ladder — uniform outcome, and the bare `thumbnails/{id}.jpg`
 * convention dies here. Fetch/upload failures are recorded as rows and
 * reported; no silent skips.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-fat-book-thumbnails-4337.mjs --dry-run
 *   node scripts/maintenance/repair-fat-book-thumbnails-4337.mjs --apply [--limit=N] [--concurrency=6]
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { recordSweepAction } from '../lib/sweep-log.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = Number((process.argv.find(a => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
const CONCURRENCY = Number((process.argv.find(a => a.startsWith('--concurrency=')) || '').split('=')[1]) || 6;

const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').trim();
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
if (APPLY && (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY must be set');
  process.exit(1);
}
const s3 = APPLY ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
}) : null;

const FLAT_FAT_RE = /^https:\/\/images\.sourcelibrary\.org\/thumbnails\/([a-f0-9]{24})\.jpg$/;

async function putR2(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: body, ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=604800',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');

console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

const filter = { thumbnail: FLAT_FAT_RE };
const targets = await books.find(filter, {
  projection: { title: 1, thumbnail: 1, image_display: 1, thumbnail_blob: 1, image_thumb: 1, visible: 1 },
}).limit(LIMIT || 0).toArray();
console.log(`Books with flat thumbnails/{id}.jpg as thumbnail: ${targets.length}`);

if (!APPLY) {
  let fat = 0;
  const sample = targets.slice(0, 15);
  for (const b of sample) {
    const res = await fetch(b.thumbnail.trim(), { method: 'HEAD' });
    const kb = Math.round((parseInt(res.headers.get('content-length') || '0')) / 1024);
    if (kb > 300) fat++;
    console.log(`  ${b._id} ${kb} KB visible=${b.visible} "${(b.title || '').slice(0, 45)}"`);
  }
  console.log(`\nSample: ${fat}/${sample.length} over 300 KB. Re-run with --apply to repair all ${targets.length}.`);
  await client.close();
  process.exit(0);
}

let ok = 0, failed = 0;
const failures = [];
let idx = 0;

async function repairOne(b) {
  const id = b._id.toString();
  const fatUrl = b.thumbnail.trim();
  const resp = await fetch(fatUrl, { signal: AbortSignal.timeout(120000) });
  if (!resp.ok) throw new Error(`fetch ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());

  const displayBuf = await sharp(buf)
    .resize(1200, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80, progressive: true })
    .toBuffer();
  const cardBuf = await sharp(buf)
    .resize(600, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toBuffer();

  const displayUrl = await putR2(`book-thumbnails/${id}.jpg`, displayBuf);
  const cardUrl = await putR2(`book-thumbnails/${id}-card.jpg`, cardBuf);

  const res = await books.updateOne(
    { _id: b._id, thumbnail: b.thumbnail },
    {
      $set: {
        thumbnail: cardUrl,
        image_display: displayUrl,
        thumbnail_source: 'fat-thumb-repair-4337',
        updated_at: new Date(),
      },
    },
  );
  if (res.modifiedCount !== 1) throw new Error('mongo write raced or matched 0 — not repointed');

  await recordSweepAction(db, {
    sweep: 'fat-thumb-repair-4337',
    book_id: id,
    action: 'repointed-display-tier-to-generated-variants',
    detail: {
      old_thumbnail: b.thumbnail,
      old_image_display: b.image_display || null,
      new_thumbnail: cardUrl,
      new_image_display: displayUrl,
      source_bytes: buf.length,
      card_bytes: cardBuf.length,
      display_bytes: displayBuf.length,
    },
  });
}

async function worker() {
  while (idx < targets.length) {
    const b = targets[idx++];
    try {
      await repairOne(b);
      ok++;
    } catch (e) {
      failed++;
      failures.push({ id: b._id.toString(), error: e.message });
      await recordSweepAction(db, {
        sweep: 'fat-thumb-repair-4337',
        book_id: b._id.toString(),
        action: 'repair-failed',
        detail: { error: e.message, thumbnail: b.thumbnail },
      }).catch(() => {});
    }
    if ((ok + failed) % 25 === 0) console.log(`  [${ok + failed}/${targets.length}] ok=${ok} fail=${failed}`);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nDone: ok=${ok} failed=${failed}`);
for (const f of failures.slice(0, 20)) console.log(`  FAIL ${f.id}: ${f.error}`);

// Verification — the read path, not the write path: count books still matching,
// and HEAD a few of the new URLs.
const remaining = await books.countDocuments(filter);
console.log(`Books still matching flat fat-thumbnail form: ${remaining} (failures above account for these)`);
const check = await books.find({ thumbnail_source: 'fat-thumb-repair-4337' }).limit(3).toArray();
for (const b of check) {
  const r = await fetch(b.thumbnail, { method: 'HEAD' });
  console.log(`  verify ${b._id}: ${r.status} ${Math.round(parseInt(r.headers.get('content-length') || '0') / 1024)} KB`);
}

await client.close();
if (failed > 0) process.exitCode = 1;
