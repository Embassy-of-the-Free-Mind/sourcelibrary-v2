#!/usr/bin/env node
/**
 * Restore page images that exist ONLY in Vercel Blob back into R2.
 *
 * Found while verifying the Blob store for deletion (#3645). The Feb 2026
 * Blob→R2 migration left a small residue behind: 86 objects across 10 visible
 * books whose `pages` documents point at an `images.sourcelibrary.org` URL for
 * a key **that does not exist in R2**, while the Blob original is still there.
 *
 * These are not a hypothetical risk. They are **broken images on the live site
 * right now** — the reader requests the R2 URL and gets a 404 — and Blob holds
 * the only copy, in a store we are actively planning to delete. Deleting Blob
 * first would have turned a repairable 404 into permanent loss, on books with
 * no `ia_identifier` (gallica and mdz manuscripts, including the Syriac Bible
 * of Paris and Plotinus' Enneades) that cannot be re-fetched from Internet
 * Archive.
 *
 * This is the precondition for reclaiming the verified 1,664 GB
 * (`verify-blob-residue-in-r2.mjs` reports it as `missing-and-still-referenced.tsv`).
 *
 * SAFETY: copies Blob → R2 only. Writes nothing to Mongo — the page documents
 * already point at the right key; the object was simply absent. Never deletes.
 * Re-verifies every candidate itself rather than trusting the sweep's output,
 * so it is safe to run standalone and safe to re-run (already-present keys are
 * skipped).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/restore-blob-only-page-images.mjs --keys <file>          # dry run
 *   node scripts/maintenance/restore-blob-only-page-images.mjs --keys <file> --apply
 */

import { MongoClient } from 'mongodb';
import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const APPLY = process.argv.includes('--apply');
const KEYS_FILE = arg('--keys');
const BLOB_HOST = arg('--blob-host', 'https://3kwioilsplnmnkv8.public.blob.vercel-storage.com');

if (!KEYS_FILE) {
  console.error('--keys <file> required (one R2 key per line; the first tab-separated\n' +
                'field is used, so verify-blob-residue-in-r2.mjs output works directly)');
  process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';

const keys = readFileSync(KEYS_FILE, 'utf8')
  .split('\n').map(l => l.split('\t')[0].trim()).filter(Boolean);

const mc = new MongoClient(process.env.MONGODB_URI);
await mc.connect();
const db = mc.db('bookstore');

console.log(`${keys.length} candidate key(s) from ${KEYS_FILE}\n`);

const stats = { restored: 0, alreadyInR2: 0, blobDead: 0, noPageDoc: 0, failed: 0, bytes: 0 };

for (const key of keys) {
  const [prefix, bookId, file] = key.split('/');
  const pageNumber = parseInt(file);
  if (prefix !== 'archived' || !bookId || !Number.isFinite(pageNumber)) {
    console.warn(`  SKIP  unexpected key shape: ${key}`);
    stats.failed++;
    continue;
  }

  // 1. A live page document must actually want this image. Without this the
  //    script would happily resurrect objects for deleted books.
  const page = await db.collection('pages').findOne(
    { book_id: bookId, page_number: pageNumber },
    { projection: { _id: 1 } },
  );
  if (!page) { stats.noPageDoc++; console.log(`  skip (no page doc)   ${key}`); continue; }

  // 2. Skip anything already in R2 — makes re-runs cheap and idempotent.
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    stats.alreadyInR2++;
    console.log(`  skip (already in R2) ${key}`);
    continue;
  } catch { /* absent, as expected */ }

  // 3. The Blob source has to still be there. Some Blob objects are themselves
  //    404 — those are unrecoverable here and must be re-archived from source.
  const res = await fetch(`${BLOB_HOST}/${key}`);
  if (!res.ok) {
    stats.blobDead++;
    console.error(`  DEAD IN BLOB (${res.status}) ${key} — re-archive from the provider instead`);
    continue;
  }
  const body = Buffer.from(await res.arrayBuffer());

  if (!APPLY) {
    console.log(`  would restore        ${key}  (${(body.length / 1024).toFixed(0)} KB)`);
    stats.restored++; stats.bytes += body.length;
    continue;
  }

  // The key came from a listing rather than string interpolation, but assert
  // anyway: a book-independent page key is shared between books by
  // construction and nothing downstream can detect it (#3362).
  assertBookScopedKey(key, bookId, 'restore-blob-only-page-images');

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: res.headers.get('content-type') || 'image/jpeg',
    CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));

  // Verify the write landed at the expected byte length before counting it.
  const head = await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
  if (head.ContentLength !== body.length) {
    stats.failed++;
    console.error(`  SIZE MISMATCH after write ${key}: wrote ${body.length}, R2 reports ${head.ContentLength}`);
    continue;
  }
  stats.restored++; stats.bytes += body.length;
  console.log(`  restored             ${key}  (${(body.length / 1024).toFixed(0)} KB)`);
}

console.log(`\n--- ${APPLY ? 'APPLIED' : 'DRY RUN'} ---`);
console.log(`  ${APPLY ? 'restored' : 'would restore'} : ${stats.restored}  (${(stats.bytes / 1e6).toFixed(1)} MB)`);
console.log(`  already in R2        : ${stats.alreadyInR2}`);
console.log(`  no page doc (skipped): ${stats.noPageDoc}`);
console.log(`  dead in Blob         : ${stats.blobDead}`);
console.log(`  failed               : ${stats.failed}`);
if (!APPLY) console.log('\nRe-run with --apply to write.');
else if (stats.blobDead || stats.failed) {
  console.log('\nNOT fully repaired — the Blob store still cannot be deleted safely.');
  process.exitCode = 1;
}

await mc.close();
