#!/usr/bin/env node
/**
 * Bulk-archive Leiden-hosted images to R2 before more of them go dark
 * (issue #2442).
 *
 * Leiden's IIIF server started returning per-item 403s (F5 anti-bot +
 * upstream restrictions): 59 Balinese drawings and pages of 9 manuscript
 * books are already unreachable. 23K+ pages and ~500 artwork thumbnails
 * still hotlink iiif.universiteitleiden.nl — today's 200s are not
 * guaranteed tomorrow. This script copies everything still fetchable:
 *
 *   pages:    photo → R2 archived/<book_id>/<page_number>.jpg, photo
 *             rewritten to the R2 URL, original kept in photo_original
 *             (standard archived-page convention)
 *   books:    universiteitleiden thumbnails → R2 artwork/<slug>.jpg
 *             (+ -thumb.jpg 600px), thumbnail/thumbnail_blob rewritten
 *
 * Idempotent/resumable: pages whose photo already points at
 * images.sourcelibrary.org are skipped; 403/404 items are logged and
 * skipped (they stay on the Leiden URL for later rescue — issue #2442).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/archive-leiden-images.mjs [--dry-run] [--pages-only|--thumbs-only] [--limit N]
 */
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const DRY_RUN = process.argv.includes('--dry-run');
const PAGES_ONLY = process.argv.includes('--pages-only');
const THUMBS_ONLY = process.argv.includes('--thumbs-only');
const LIMIT = parseInt(process.argv.find((_, i, a) => a[i - 1] === '--limit') || '0') || 0;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';
const LEIDEN = /universiteitleiden\.nl/;

const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function fetchImage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) return { status: res.status };
  return { status: 200, buf: Buffer.from(await res.arrayBuffer()) };
}

async function put(key, body) {
  await s3.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME, Key: key, Body: body,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable',
  }));
}

async function archivePages(db) {
  const pages = db.collection('pages');
  // distinct book ids first (regex scan once), then per-book indexed walks
  console.log('Finding books with Leiden-hosted pages…');
  const bookIds = await pages.distinct('book_id', { photo: LEIDEN });
  console.log(`${bookIds.length} books have Leiden-hosted pages`);

  let archived = 0, restricted = 0, errors = 0;
  for (const bookId of bookIds) {
    const docs = await pages.find({ book_id: bookId, photo: LEIDEN }, { projection: { page_number: 1, photo: 1 } })
      .sort({ page_number: 1 }).toArray();
    console.log(`book ${bookId}: ${docs.length} Leiden pages`);
    for (const p of docs) {
      if (LIMIT && archived >= LIMIT) return { archived, restricted, errors };
      if (DRY_RUN) { archived++; continue; }
      try {
        const { status, buf } = await fetchImage(p.photo);
        if (status !== 200) {
          restricted++;
          await pages.updateOne({ _id: p._id }, { $set: { leiden_restricted: status, leiden_probe_at: new Date() } });
          console.log(`  RESTRICTED ${status} book=${bookId} page=${p.page_number}`);
          continue;
        }
        const jpeg = await sharp(buf).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
        await put(`archived/${bookId}/${p.page_number}.jpg`, jpeg);
        await pages.updateOne({ _id: p._id }, {
          $set: {
            photo: `https://images.sourcelibrary.org/archived/${bookId}/${p.page_number}.jpg`,
            photo_original: p.photo,
            archived_at: new Date(), updated_at: new Date(),
          },
          $unset: { leiden_restricted: '' },
        });
        archived++;
        if (archived % 100 === 0) console.log(`  …${archived} pages archived so far (${restricted} restricted, ${errors} errors)`);
      } catch (err) {
        errors++;
        console.log(`  ERROR book=${bookId} page=${p.page_number}: ${err.message?.slice(0, 60)}`);
      }
      await new Promise(r => setTimeout(r, 400));
    }
  }
  return { archived, restricted, errors };
}

async function archiveThumbnails(db) {
  const books = db.collection('books');
  const docs = await books.find(
    { thumbnail: LEIDEN },
    { projection: { slug: 1, thumbnail: 1 } },
  ).toArray();
  console.log(`${docs.length} books have Leiden-hosted thumbnails`);

  let archived = 0, restricted = 0, errors = 0;
  for (const b of docs) {
    if (LIMIT && archived >= LIMIT) break;
    if (DRY_RUN) { archived++; continue; }
    try {
      // fetch a high-res rendition rather than the stored (often 400px) thumb
      const fullUrl = b.thumbnail.replace(/\/full\/[^/]+\//, '/full/1600,/');
      let { status, buf } = await fetchImage(fullUrl);
      if (status !== 200) ({ status, buf } = await fetchImage(b.thumbnail));
      if (status !== 200) {
        restricted++;
        await books.updateOne({ _id: b._id }, { $set: { leiden_restricted: status, leiden_probe_at: new Date() } });
        console.log(`  RESTRICTED ${status} ${b.slug}`);
        continue;
      }
      const prefix = b.slug.startsWith('art-') ? b.slug : `art-${b.slug}`;
      const display = await sharp(buf).resize({ width: 3840, withoutEnlargement: true }).jpeg({ quality: 85, mozjpeg: true }).toBuffer();
      const thumb = await sharp(buf).resize({ width: 600, withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      await put(`artwork/${prefix}.jpg`, display);
      await put(`artwork/${prefix}-thumb.jpg`, thumb);
      await books.updateOne({ _id: b._id }, {
        $set: {
          thumbnail: `https://images.sourcelibrary.org/artwork/${prefix}-thumb.jpg`,
          thumbnail_blob: `https://images.sourcelibrary.org/artwork/${prefix}.jpg`,
          leiden_thumbnail_original: b.thumbnail,
          updated_at: new Date(),
        },
        $unset: { leiden_restricted: '' },
      });
      archived++;
      if (archived % 50 === 0) console.log(`  …${archived} thumbnails archived (${restricted} restricted)`);
    } catch (err) {
      errors++;
      console.log(`  ERROR ${b.slug}: ${err.message?.slice(0, 60)}`);
    }
    await new Promise(r => setTimeout(r, 400));
  }
  return { archived, restricted, errors };
}

async function main() {
  await client.connect();
  const db = client.db('bookstore');
  console.log(DRY_RUN ? '=== DRY RUN ===' : '=== LIVE ===');

  if (!PAGES_ONLY) {
    const t = await archiveThumbnails(db);
    console.log(`THUMBNAILS — archived: ${t.archived}, restricted: ${t.restricted}, errors: ${t.errors}`);
  }
  if (!THUMBS_ONLY) {
    const p = await archivePages(db);
    console.log(`PAGES — archived: ${p.archived}, restricted: ${p.restricted}, errors: ${p.errors}`);
  }
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
