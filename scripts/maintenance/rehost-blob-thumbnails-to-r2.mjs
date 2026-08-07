#!/usr/bin/env node
/**
 * Rehost `books.thumbnail` values still pointing at Vercel Blob → Cloudflare R2.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `migrate-book-thumbnails-to-r2.mjs`
 * ---------------------------------------------------------------------
 * That script selects on `thumbnail_blob` matching `vercel-storage`, and writes
 * its result back to `thumbnail_blob`. Measured 2026-08-06, the corpus has
 * **zero** `thumbnail_blob` values on Blob and **nine** `thumbnail` values on
 * Blob — so it finds none of them, and even with `--external` it would write to
 * the wrong field while scooping up ~3,168 unrelated books whose thumbnails are
 * external IIIF/IA URLs (a different job, and one that hits Internet Archive
 * 403s, which are often rights refusals and must not be auto-retried — see
 * `.claude/docs/invariants/archive-fetch-failures.md`).
 *
 * This is the last residue of the March 2026 Blob→R2 migration, which was
 * declared complete on 2026-03-26 ("zero Blob references remain"). It wasn't
 * quite: all nine of these books were created 2–26 March, i.e. the sweep raced
 * with books still being created and missed them. Nothing created since has a
 * Blob thumbnail, so this is a one-off tail, not an ongoing leak.
 *
 * Clearing it is a precondition for deleting the Vercel Blob store (~$50/mo).
 * All nine books are `visible: true`, so deleting the store first would break
 * live covers.
 *
 * Run:
 *   set -a; source .env.production.local; set +a; \
 *     node scripts/maintenance/rehost-blob-thumbnails-to-r2.mjs --dry-run
 *
 * Flags:
 *   --dry-run   Fetch and validate, write nothing (default OFF — you must opt in to writing)
 *   --apply     Actually upload to R2 and update Mongo
 *   --limit=N   Process at most N books
 *
 * Neither flag ⇒ dry run. Writing requires `--apply` explicitly.
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { writeFileSync, mkdirSync } from 'node:fs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const APPLY = process.argv.includes('--apply');
const LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0') || 0;
const BLOB_RE = /blob\.vercel-storage\.com/;

const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

for (const v of ['MONGODB_URI', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']) {
  if (!process.env[v]) {
    console.error(`Missing required env var: ${v}`);
    process.exit(1);
  }
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SourceLibrary/1.0 (scholarly archive)' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // A truncated or error-page body must never be written over a working URL.
  if (buf.length < 1024) throw new Error(`suspiciously small (${buf.length}b)`);
  const type = res.headers.get('content-type') || '';
  if (!type.startsWith('image/')) throw new Error(`not an image (content-type: ${type || 'none'})`);
  return { buf, type };
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const query = { thumbnail: BLOB_RE };
  const cursor = books.find(query, { projection: { id: 1, title: 1, thumbnail: 1, visible: 1 } });
  if (LIMIT) cursor.limit(LIMIT);
  const targets = await cursor.toArray();

  console.log(`Rehost Blob thumbnails → R2 ${APPLY ? '(APPLY — will write)' : '(DRY RUN — writes nothing)'}`);
  console.log(`Bucket: ${BUCKET}  ·  public: ${R2_PUBLIC_URL}`);
  console.log(`Found ${targets.length} book(s) with thumbnail on Vercel Blob\n`);
  if (!targets.length) {
    console.log('Nothing to do. If this is unexpected, confirm the field: this script targets');
    console.log('`books.thumbnail`, not `books.thumbnail_blob`.');
    await client.close();
    return;
  }

  // Back up BEFORE any write, so --revert is always possible. One-shot tail, so
  // a plain write is fine here — but if this ever becomes re-runnable, merge on
  // id and let the EARLIER `before` win (it is the true original).
  const stamp = new Date().toISOString().slice(0, 10);
  const backupPath = `scripts/output/blob-thumbnail-backup-${stamp}.json`;
  if (APPLY) {
    mkdirSync('scripts/output', { recursive: true });
    writeFileSync(backupPath, JSON.stringify(
      targets.map(b => ({ id: b.id, _id: b._id.toString(), before: b.thumbnail })), null, 2));
    console.log(`Backup written: ${backupPath}\n`);
  }

  let ok = 0, failed = 0;
  for (const book of targets) {
    const bookId = book.id || book._id.toString();
    const key = `book-thumbnails/${bookId}.jpg`;
    const label = `${bookId}  ${String(book.title || '').slice(0, 44)}`;

    try {
      // #3362: a book-independent key is shared between books BY CONSTRUCTION,
      // and nothing downstream can detect it. Fail closed before any upload.
      assertBookScopedKey(key, bookId, 'rehost-blob-thumbnails');

      const { buf, type } = await fetchImage(book.thumbnail);

      if (!APPLY) {
        console.log(`  would rehost  ${label}  (${(buf.length / 1024).toFixed(0)} KB, ${type})`);
        ok++;
        continue;
      }

      await r2.send(new PutObjectCommand({
        Bucket: BUCKET,
        Key: key,
        Body: buf,
        ContentType: type,
        CacheControl: 'public, max-age=86400, s-maxage=86400',
      }));
      const newUrl = `${R2_PUBLIC_URL}/${key}`;

      const res = await books.updateOne({ _id: book._id }, { $set: { thumbnail: newUrl } });
      if (res.modifiedCount !== 1) throw new Error(`updateOne modifiedCount=${res.modifiedCount}`);

      console.log(`  rehosted      ${label}  → ${newUrl}`);
      ok++;
    } catch (err) {
      // Deliberately leave `thumbnail` untouched on failure. Writing an error
      // marker into the field the selector reads would hide the record from
      // every future run (the archived_photo mistake, #3362 corollary).
      console.error(`  FAILED        ${label}  — ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${APPLY ? 'Applied' : 'Dry run'}: ${ok} ok, ${failed} failed, of ${targets.length}`);

  if (APPLY && ok > 0) {
    const remaining = await books.countDocuments({ thumbnail: BLOB_RE });
    console.log(`Remaining books with a Blob thumbnail: ${remaining}`);
    if (remaining === 0) {
      console.log('\nBlob thumbnails are clear. Before deleting the Vercel Blob store:');
      console.log('  1. Full count (not a sample) of `pages` for any Blob reference.');
      console.log('  2. Make src/lib/storage.ts THROW rather than warn on the Blob fallback —');
      console.log('     once the store is gone that path writes into nothing.');
      console.log('  3. Then delete the store and remove BLOB_READ_WRITE_TOKEN from Vercel.');
    }
  }
  if (failed > 0) process.exitCode = 1;

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
