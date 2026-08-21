#!/usr/bin/env node
/**
 * Import Sancai Tuhui physical volume 52 from National Archives of Japan.
 * Contains juan 91-92 (鳥獸三卷-四卷, Beasts sections).
 *
 * Source: 内閣文庫 (Cabinet Library), CC0 license.
 * Document ID: M2018062116361750245, 85 pages.
 * Image URL: https://www.digital.archives.go.jp/acv/auto_conversion/conv/jp2jpeg?ID={ID}&p={PAGE}
 */

import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { makeBookDoc, makePageDoc } from './lib/book-docs.mjs';

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';
const JPEG_QUALITY = 85;
const MAX_DIMENSION = 3000;

// NAJ source details
const DOC_ID = 'M2018062116361750245';
const TOTAL_PAGES = 85;
const IMAGE_BASE = 'https://www.digital.archives.go.jp/acv/auto_conversion/conv/jp2jpeg';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function downloadImage(pageNum) {
  const url = `${IMAGE_BASE}?ID=${DOC_ID}&p=${pageNum}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for page ${pageNum}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  console.log('\n=== Import Sancai Tuhui Vol. 52 from National Archives of Japan ===\n');

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  try {
    // First, clean up old NCL import if it exists
    const oldBook = await db.collection('books').findOne({ slug: 'sancai-tuhui-juan-92-ncl' });
    if (oldBook) {
      console.log(`Removing old NCL import: ${oldBook.id} (${oldBook.pages_count} pages)`);
      await db.collection('pages').deleteMany({ book_id: oldBook.id });
      await db.collection('books').deleteOne({ _id: oldBook._id });
      console.log('  Old book and pages removed.\n');
    }

    // Create new book record
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    const baseSlug = 'sancai-tuhui-vol52-niaoshou';
    let slug = baseSlug;
    let slugSuffix = 0;
    while (await db.collection('books').findOne({ slug })) {
      slugSuffix++;
      slug = `${baseSlug}-${slugSuffix}`;
    }

    const now = new Date();
    const bookDoc = makeBookDoc({
      _id: bookId,
      id: bookIdStr,
      slug,
      title: '三才圖會 鳥獸三卷-四卷',
      display_title: 'Sancai Tuhui — Birds & Beasts, Juan 91-92 (National Archives of Japan)',
      author: '王圻、王思義',
      display_author: 'Wang Qi & Wang Siyi',
      published: '1609',
      language: 'Literary Chinese',
      categories: ['Natural Philosophy', 'History'],
      status: 'draft',
      pages_count: TOTAL_PAGES,
      pages_ocr: 0,
      pages_translated: 0,
      image_source: {
        provider: 'other',
        provider_name: 'National Archives of Japan',
        source_url: 'https://www.digital.archives.go.jp/file/1077889.html',
        license: 'CC0-1.0',
        license_url: 'https://creativecommons.org/publicdomain/zero/1.0/',
        attribution: '国立公文書館 National Archives of Japan — 内閣文庫 (Cabinet Library)',
        access_date: now,
        identifier: 'NAJ:F1000000000000103015:vol52',
        shelfmark: '別029-0001',
        contributing_library: 'National Archives of Japan (内閣文庫)',
        notes: `Ming Wanli 37 (1609) woodblock print. Physical volume 52 of 60, containing juan 91 (鳥獸三卷, Beasts) and juan 92 (鳥獸四卷, Beasts continued). 85 pages. CC0 public domain. Provenance: 清璜川呉氏旧蔵 (Qing-era Wu family collection).`,
      },
      dublin_core: {
        dc_title: '三才圖會 鳥獸三卷-四卷',
        dc_creator: '王圻; 王思義',
        dc_date: '1609',
        dc_language: 'Literary Chinese',
        dc_type: 'Text',
        dc_format: 'image/jpeg',
        dc_publisher: 'Ming Dynasty (萬曆三十七年)',
        dc_source: 'National Archives of Japan, Cabinet Library, call number 別029-0001, volume 52',
        dc_rights: 'CC0 1.0 Universal',
        dc_identifier: `NAJ:${DOC_ID}`,
      },
      description: 'Physical volume 52 of the Sancai Tuhui (三才圖會), a Ming Dynasty illustrated encyclopedia compiled by Wang Qi and Wang Siyi (1609). Contains juan 91-92 covering beasts (獸類), including both real animals and mythical creatures from the Shanhaijing. This scan is from the National Archives of Japan (内閣文庫), CC0 public domain, with minimal watermarking.',
      created_at: now,
      updated_at: now,
    });

    await db.collection('books').insertOne(bookDoc);
    console.log(`Book created: ${slug} (${bookIdStr})\n`);

    // Download and upload pages
    console.log(`Downloading and uploading ${TOTAL_PAGES} pages...\n`);

    const CONCURRENCY = 6; // Be gentle with NAJ servers
    let uploaded = 0;
    let failed = 0;
    let workIdx = 0;
    let bytesUploaded = 0;
    const startTime = Date.now();

    async function worker() {
      while (workIdx < TOTAL_PAGES) {
        const idx = workIdx++;
        if (idx >= TOTAL_PAGES) break;
        const najPageNum = idx + 1; // NAJ pages are 1-indexed

        try {
          // Download from NAJ
          let imgBuffer = await downloadImage(najPageNum);
          const meta = await sharp(imgBuffer).metadata();

          // Resize if needed (NAJ images are 3250x2375)
          if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
            imgBuffer = await sharp(imgBuffer)
              .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: JPEG_QUALITY })
              .toBuffer();
          } else {
            // Re-encode at our quality setting
            imgBuffer = await sharp(imgBuffer).jpeg({ quality: JPEG_QUALITY }).toBuffer();
          }

          // Upload full image to R2
          const key = `archived/${bookIdStr}/${idx}.jpg`;
          const photoUrl = await uploadToR2(key, imgBuffer);
          bytesUploaded += imgBuffer.length;

          // Generate and upload thumbnail
          const thumbBuffer = await sharp(imgBuffer)
            .resize(150, 150, { fit: 'inside' })
            .jpeg({ quality: 70 })
            .toBuffer();
          const thumbKey = `thumbnails/${bookIdStr}/${idx}.jpg`;
          const thumbUrl = await uploadToR2(thumbKey, thumbBuffer);
          bytesUploaded += thumbBuffer.length;

          // Create page record
          const pageOid = new ObjectId();
          const pageDoc = makePageDoc({
            _id: pageOid,
            id: pageOid.toHexString(),
            book_id: bookIdStr,
            page_number: idx,
            photo: photoUrl,
            photo_original: `${IMAGE_BASE}?ID=${DOC_ID}&p=${najPageNum}`,
            archived_photo: photoUrl,
            thumbnail_blob: thumbUrl,
            archive_metadata: {
              source: 'national_archives_japan',
              naj_document_id: DOC_ID,
              naj_page: najPageNum,
              naj_volume: 52,
              archived_at: now,
            },
            created_at: now,
            updated_at: now,
          });

          await db.collection('pages').insertOne(pageDoc);
          uploaded++;

          if (uploaded % 10 === 0 || uploaded === TOTAL_PAGES) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = uploaded / Math.max(elapsed, 1);
            console.log(`  ${uploaded}/${TOTAL_PAGES} pages (${rate.toFixed(1)} pg/s, ${(bytesUploaded / (1024*1024)).toFixed(0)} MB)`);
          }
        } catch (err) {
          failed++;
          console.error(`  FAIL page ${idx} (NAJ p${najPageNum}): ${err.message?.slice(0, 120)}`);
        }
      }
    }

    const numWorkers = Math.min(CONCURRENCY, TOTAL_PAGES);
    await Promise.all(Array.from({ length: numWorkers }, () => worker()));

    // Set thumbnail
    const firstPage = await db.collection('pages').findOne(
      { book_id: bookIdStr, page_number: 0 },
      { projection: { archived_photo: 1 } }
    );
    if (firstPage?.archived_photo) {
      await db.collection('books').updateOne(
        { _id: bookId },
        { $set: { thumbnail: firstPage.archived_photo, pages_count: uploaded } }
      );
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n=== Import Complete ===`);
    console.log(`  Book: ${slug}`);
    console.log(`  Pages: ${uploaded} (${failed} failed)`);
    console.log(`  Size: ${(bytesUploaded / (1024*1024)).toFixed(1)} MB`);
    console.log(`  Time: ${elapsed.toFixed(0)}s`);
    console.log(`  URL: https://sourcelibrary.org/book/${slug}`);

  } finally {
    await client.close();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
