#!/usr/bin/env node
/**
 * Move the Vercel Blob URLs hardcoded in application source onto R2, so the
 * Blob store can be retired (issue #3645, Finding 3).
 *
 * WHY THIS EXISTS, and why the obvious check missed it: the page-image
 * migration to R2 repointed the DATABASE. Measured 2026-08-17, 0 of 20,000
 * randomly sampled `pages` docs carry a blob.vercel-storage.com URL — which
 * reads as "nothing uses Blob any more" and is wrong. The blog and landing
 * pages embed Blob URLs directly in JSX, where no database sweep can see
 * them: 259 occurrences / 173 distinct URLs across 31 live files, and 137 of
 * those occurrences point at `archived/` — the very prefix a "delete the
 * residue" cleanup would target first. Deleting Blob without this step breaks
 * images across the blog.
 *
 * Lesson worth keeping: a reference held in code is invisible to a data
 * migration, and "the DB is clean" is not "nothing points here".
 *
 * The keys are identical on both sides (`archived/{bookId}/{page}.jpg`), so
 * for most URLs this is a host swap, not a re-upload. Measured: 140 of 173
 * already exist in R2; 33 (mostly `blog/cuneiform/*`) must be copied first.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/rehost-source-blob-urls-to-r2.mjs            # dry run
 *   node scripts/maintenance/rehost-source-blob-urls-to-r2.mjs --apply    # copy + rewrite
 *
 * After --apply, `git grep blob.vercel-storage.com -- src public` must return
 * nothing but `_archived/`. scripts/audit/no-vercel-blob.mjs enforces that.
 */

import { S3Client, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { validateR2Key } from '../lib/r2-key.mjs';

const APPLY = process.argv.includes('--apply');
const R2_PUBLIC_URL = (process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org').replace(/\/$/, '');
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BLOB_RX = /https:\/\/[a-zA-Z0-9._-]*blob\.vercel-storage\.com\/[^"')\s`]*/g;

/**
 * The same URLs also appear PERCENT-ENCODED as the `url=` parameter of
 * /api/crop-image, e.g.
 *   /api/crop-image?url=https%3A%2F%2F…blob.vercel-storage.com%2Farchived%2F…
 * A plain-URL regex silently misses every one of these — 15 of them, across
 * the beta landing page and three blog posts. Any sweep that greps for the
 * literal host must handle both encodings or it will report "done" while a
 * whole class of reference survives.
 */
const BLOB_ENC_RX = /https%3A%2F%2F[a-zA-Z0-9._-]*blob\.vercel-storage\.com(?:%2F[^"'&\s`]*)?/gi;

/** Files that legitimately still mention Blob: retired pages and this tooling. */
const EXCLUDE = /(^|\/)_archived\//;

function sourceFiles() {
  const out = execSync(`git grep -l "blob\\.vercel-storage\\.com" -- src public`, { encoding: 'utf8' });
  return out.trim().split('\n').filter(f => f && !EXCLUDE.test(f));
}

/**
 * Split a Blob URL into the storage key and any trailing crop/query suffix.
 * Five URLs in the tree carry `&x=…&y=…&w=…&h=…` appended after `.jpg`; the
 * suffix is consumed downstream and must survive the rewrite untouched.
 */
function splitUrl(url) {
  const afterHost = url.replace(/^https:\/\/[^/]+\//, '');
  const m = afterHost.match(/^(.*?\.(?:jpg|jpeg|png|gif|webp|svg))([&?].*)?$/i);
  if (!m) return { key: decodeURIComponent(afterHost.split(/[?&]/)[0]), suffix: '' };
  return { key: decodeURIComponent(m[1]), suffix: m[2] || '' };
}

async function existsInR2(key) {
  try {
    await r2.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch { return false; }
}

async function copyBlobToR2(url, key) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`blob fetch ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  // Same guard every other R2 write site uses — a key with an undefined
  // segment produces one object shared across books (#3362).
  validateR2Key(key, 'rehost-source-blob-urls');
  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: res.headers.get('content-type') || 'image/jpeg',
  }));
  return body.length;
}

async function main() {
  const files = sourceFiles();
  const urls = new Set();      // plain form
  const encUrls = new Set();   // percent-encoded, inside /api/crop-image?url=
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(BLOB_RX)) urls.add(m[0]);
    for (const m of src.matchAll(BLOB_ENC_RX)) encUrls.add(m[0]);
  }
  // Fold the encoded ones into the same key space so R2 presence is checked once.
  for (const e of encUrls) urls.add(decodeURIComponent(e));
  console.log(`${files.length} live source files, ${urls.size} distinct Blob URLs ` +
              `(${encUrls.size} of them percent-encoded in a crop-image param)\n`);

  // --- Phase 1: make sure R2 has every key ---
  const need = [];
  for (const url of urls) {
    const { key } = splitUrl(url);
    if (!(await existsInR2(key))) need.push({ url, key });
  }
  console.log(`already in R2 : ${urls.size - need.length}`);
  console.log(`need copying  : ${need.length}`);

  let copied = 0, failed = 0;
  // A source object that is ALREADY 404 in Blob is a broken image on the live
  // site today, not a migration failure. Rewriting its host would move a dead
  // link to a new dead link and make it look migrated — so those URLs are left
  // exactly as they are, listed, and reported. Everything else still migrates.
  const deadAtSource = new Set();
  for (const { url, key } of need) {
    if (!APPLY) { console.log(`  would copy  ${key}`); continue; }
    try {
      const n = await copyBlobToR2(url, key);
      copied++;
      console.log(`  copied  ${key}  (${(n / 1024).toFixed(0)} KB)`);
    } catch (e) {
      if (/blob fetch 404/.test(e.message)) {
        deadAtSource.add(url);
        console.warn(`  DEAD AT SOURCE (already broken on the live site)  ${key}`);
      } else {
        failed++;
        console.error(`  FAILED  ${key}: ${e.message}`);
      }
    }
  }

  if (APPLY && failed) {
    console.error(`\n${failed} copies failed — NOT rewriting source. Fix those first;`);
    console.error('rewriting now would point the site at keys R2 does not have.');
    process.exit(1);
  }

  // --- Phase 2: rewrite the source ---
  let edits = 0, filesTouched = 0;
  for (const f of files) {
    const before = readFileSync(f, 'utf8');
    let after = before.replace(BLOB_RX, (url) => {
      if (deadAtSource.has(url)) return url; // leave visibly broken, not fake-migrated
      const { key, suffix } = splitUrl(url);
      edits++;
      return `${R2_PUBLIC_URL}/${key}${suffix}`;
    });
    // Encoded form: rewrite the host inside the crop-image param, keeping the
    // value encoded exactly as the route expects it.
    after = after.replace(BLOB_ENC_RX, (enc) => {
      const plain = decodeURIComponent(enc);
      if (deadAtSource.has(plain)) return enc;
      const { key, suffix } = splitUrl(plain);
      edits++;
      return encodeURIComponent(`${R2_PUBLIC_URL}/${key}${suffix}`);
    });
    if (after !== before) {
      filesTouched++;
      if (APPLY) writeFileSync(f, after);
    }
  }

  console.log(`\n${APPLY ? 'rewrote' : 'would rewrite'} ${edits} URL(s) across ${filesTouched} file(s) → ${R2_PUBLIC_URL}`);
  if (deadAtSource.size) {
    console.log(`\n${deadAtSource.size} URL(s) left untouched because the Blob object is ALREADY 404 —`);
    console.log('these are broken images on the live site right now and need a real fix,');
    console.log('not a rehost:');
    for (const u of deadAtSource) console.log(`  ${u}`);
  }
  if (APPLY) {
    console.log(`copied ${copied} object(s) into R2.`);
    console.log('\nNext: `git grep blob.vercel-storage.com -- src public` should be empty,');
    console.log('and `node scripts/audit/no-vercel-blob.mjs` should pass.');
  } else {
    console.log('\nDry run. Re-run with --apply to copy and rewrite.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
