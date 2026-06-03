#!/usr/bin/env node
/**
 * Fix blurry artwork thumbnails in collection grids.
 *
 * Root cause: ~14,160 visible artworks have `image_thumb` pointing at a 150px
 * `book-thumbnails/{id}-thumb.jpg` variant (made by the book display-variant
 * worker). The art-grid card requests the 'thumb' size, so a 150px image is
 * upscaled into a ~270–540px card → visibly blurry.
 *
 * But every artwork already has a sharp 600px sibling at
 * `artwork/{prefix}-thumb.jpg` (written by the artwork importers /
 * upgrade-artwork-images.mjs). The fix is almost entirely a cheap repoint:
 * set `image_thumb` to that existing 600px URL. Only artworks that genuinely
 * lack the sibling get a freshly generated 600px thumb (--generate), resized
 * from the 2000px display we already host.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/backfill-artwork-thumb-pointers.mjs --dry-run
 *   node scripts/maintenance/backfill-artwork-thumb-pointers.mjs --generate
 *   node scripts/maintenance/backfill-artwork-thumb-pointers.mjs --collection ficinos-florence
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const GENERATE = process.argv.includes('--generate');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;
const ONLY_COLLECTION = process.argv.find((_, i, a) => a[i - 1] === '--collection') || null;
const CONCURRENCY = 20;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';

const client = new MongoClient(process.env.MONGODB_URI);
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

/** Candidate sharp-thumb URLs for an artwork, in priority order. */
function candidateThumbUrls(doc) {
  const out = [];
  const push = (u) => { if (u && !out.includes(u)) out.push(u); };
  for (const src of [doc.image_display, doc.thumbnail, doc.thumbnail_blob]) {
    if (!src || typeof src !== 'string') continue;
    if (!src.includes('images.sourcelibrary.org/artwork/')) continue;
    if (src.endsWith('-thumb.jpg')) { push(src); continue; }
    if (src.endsWith('-full.jpg')) { push(src.replace(/-full\.jpg$/, '-thumb.jpg')); continue; }
    if (src.endsWith('.jpg')) { push(src.replace(/\.jpg$/, '-thumb.jpg')); }
  }
  return out;
}

async function exists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch { return false; }
}

/** Generate a 600px thumb from the artwork's hi-res display image and upload it. */
async function generateThumb(doc) {
  const src = doc.image_display || doc.thumbnail;
  if (!src) return null;
  // Derive the R2 key for the thumb from the display key when possible.
  const m = src.match(/images\.sourcelibrary\.org\/artwork\/(.+?)(?:-full|-thumb)?\.jpg$/);
  if (!m) return null;
  const key = `artwork/${m[1]}-thumb.jpg`;
  const res = await fetch(src, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) return null;
  const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: thumb,
    ContentType: 'image/jpeg',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `https://images.sourcelibrary.org/${key}`;
}

async function main() {
  await client.connect();
  const books = client.db('bookstore').collection('books');

  const match = {
    content_type: 'artwork',
    visible: true,
    $or: [
      { image_thumb: { $regex: '/book-thumbnails/' } },
      { image_thumb: { $in: [null, ''] } },
      { image_thumb: { $exists: false } },
    ],
  };
  if (ONLY_COLLECTION) match.collections = ONLY_COLLECTION;

  const cursor = books.find(match, {
    projection: { image_display: 1, thumbnail: 1, thumbnail_blob: 1, image_thumb: 1 },
    noCursorTimeout: true,
  });
  if (LIMIT) cursor.limit(LIMIT);
  const docs = await cursor.toArray();

  console.log(`${DRY_RUN ? 'DRY RUN — ' : ''}${docs.length} affected artworks${ONLY_COLLECTION ? ` in "${ONLY_COLLECTION}"` : ''}`);

  let repointed = 0, generated = 0, skippedNoSrc = 0, errors = 0, processed = 0;
  const ops = [];

  async function handle(doc) {
    processed++;
    try {
      const cands = candidateThumbUrls(doc);
      let chosen = null;
      for (const u of cands) { if (await exists(u)) { chosen = u; break; } }
      if (chosen) {
        if (!DRY_RUN) ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { image_thumb: chosen, updated_at: new Date() } } } });
        repointed++;
      } else if (GENERATE) {
        if (DRY_RUN) { generated++; return; }
        const url = await generateThumb(doc);
        if (url) { ops.push({ updateOne: { filter: { _id: doc._id }, update: { $set: { image_thumb: url, updated_at: new Date() } } } }); generated++; }
        else { skippedNoSrc++; }
      } else {
        skippedNoSrc++;
      }
    } catch (e) { errors++; if (errors <= 10) console.log(`  err ${doc._id}: ${e.message?.slice(0, 80)}`); }
    if (ops.length >= 500) { const batch = ops.splice(0, ops.length); await books.bulkWrite(batch, { ordered: false }); }
    if (processed % 500 === 0) console.log(`  ${processed}/${docs.length} (repoint ${repointed}, gen ${generated}, no-src ${skippedNoSrc})`);
  }

  // simple concurrency pool
  let idx = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (idx < docs.length) { const d = docs[idx++]; await handle(d); }
  }));
  if (ops.length && !DRY_RUN) await books.bulkWrite(ops, { ordered: false });

  console.log('\n━━━ SUMMARY ━━━');
  console.log(`Processed:          ${processed}`);
  console.log(`Repointed (free):   ${repointed}`);
  console.log(GENERATE ? `Generated (600px):  ${generated}` : `Would need gen:     ${skippedNoSrc} (re-run with --generate)`);
  if (GENERATE) console.log(`No usable source:   ${skippedNoSrc}`);
  console.log(`Errors:             ${errors}`);
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
