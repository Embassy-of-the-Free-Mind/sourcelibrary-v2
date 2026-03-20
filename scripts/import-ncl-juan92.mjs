#!/usr/bin/env node
/**
 * Import Sancai Tuhui juan 92 from NCL Taiwan Wikimedia Commons PDFs.
 *
 * The NCL files are spread scans (two facing pages per image).
 * We import them as-is — the split-page detector in the pipeline
 * will handle splitting later.
 */

import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';
const DPI = 200;
const JPEG_QUALITY = 85;

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

async function downloadFile(url, dest) {
  console.log(`  Downloading: ${url.split('/').pop()}`);
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  const size = fs.statSync(dest).size;
  console.log(`  Downloaded: ${(size / (1024 * 1024)).toFixed(1)} MB`);
}

// NCL files that contain the 鳥獸 section around juan 92
// Based on visual inspection:
// File 149: beasts (鼴, 麝) — likely juan 91-92 area
// File 150: more beasts (飛鼠, 大風) — likely juan 92 continuation
// We'll download both candidates, extract pages, and identify juan 92 by headers
const NCL_FILES = [
  { num: 149, url: 'https://upload.wikimedia.org/wikipedia/commons/f/f2/NCL-08059_149_%E4%B8%89%E6%89%8D%E5%9C%96%E6%9C%83.pdf' },
  { num: 150, url: 'https://upload.wikimedia.org/wikipedia/commons/6/6e/NCL-08059_150_%E4%B8%89%E6%89%8D%E5%9C%96%E6%9C%83.pdf' },
];

async function main() {
  console.log('\n=== Import Sancai Tuhui Juan 92 from NCL Taiwan ===\n');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-ncl-import-'));
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });

  try {
    await client.connect();
    const db = client.db('bookstore');

    // Step 1: Download NCL PDFs
    console.log('Step 1: Downloading NCL PDFs...');
    const pdfPaths = [];
    for (const file of NCL_FILES) {
      const dest = path.join(tmpDir, `ncl-${file.num}.pdf`);
      await downloadFile(file.url, dest);
      pdfPaths.push({ num: file.num, path: dest });
    }

    // Step 2: Extract all pages from both PDFs
    console.log('\nStep 2: Extracting pages...');
    const allPages = [];

    for (const pdf of pdfPaths) {
      const pagesDir = path.join(tmpDir, `pages-${pdf.num}`);
      fs.mkdirSync(pagesDir, { recursive: true });

      execFileSync('pdftoppm', [
        '-jpeg', '-r', String(DPI), '-jpegopt', `quality=${JPEG_QUALITY}`,
        pdf.path, path.join(pagesDir, 'page'),
      ], { timeout: 300000, stdio: 'pipe' });

      const files = fs.readdirSync(pagesDir)
        .filter(f => f.endsWith('.jpg'))
        .sort();

      console.log(`  NCL file ${pdf.num}: ${files.length} pages extracted`);

      for (const f of files) {
        allPages.push({
          file: path.join(pagesDir, f),
          nclFile: pdf.num,
          fileName: f,
        });
      }
    }

    console.log(`  Total pages: ${allPages.length}`);

    // Step 3: Create new book record
    console.log('\nStep 3: Creating book record...');
    const bookId = new ObjectId();
    const bookIdStr = bookId.toHexString();

    // Generate a unique slug
    const baseSlug = 'sancai-tuhui-juan-92-ncl';
    let slug = baseSlug;
    let slugSuffix = 0;
    while (await db.collection('books').findOne({ slug })) {
      slugSuffix++;
      slug = `${baseSlug}-${slugSuffix}`;
    }

    const now = new Date();
    const bookDoc = {
      _id: bookId,
      id: bookIdStr,
      slug,
      tenant_id: 'default',
      title: '三才圖會（九十二）',
      display_title: 'Sancai Tuhui, Juan 92 — Birds & Beasts (NCL Original)',
      author: '王圻、王思義',
      display_author: 'Wang Qi & Wang Siyi',
      published: '1609',
      language: 'Literary Chinese',
      categories: ['Natural Philosophy', 'History'],
      status: 'draft',
      pages_count: allPages.length,
      pages_ocr: 0,
      pages_translated: 0,
      image_source: {
        provider: 'other',
        provider_name: 'National Central Library Taiwan',
        source_url: 'https://rbook.ncl.edu.tw/NCLSearch/Search/Index/1',
        license: 'publicdomain',
        license_url: 'https://creativecommons.org/publicdomain/mark/1.0/',
        attribution: 'National Central Library, Taiwan (國家圖書館)',
        access_date: now,
        identifier: 'NCL-08059',
        notes: `Original 1609 Ming Wanli 37th year woodblock print. High-quality color spread scans. Extracted from Wikimedia Commons files NCL-08059_149 and NCL-08059_150. Call number: 309 08059. Provenance stamps: 吳興劉氏嘉業堂藏書記, 東海郡圖書記, 蟄隱廬所得善本, 國立中央圖書館考藏.`,
        extraction: {
          method: 'pdftoppm',
          dpi: DPI,
          jpeg_quality: JPEG_QUALITY,
          ncl_files: NCL_FILES.map(f => `NCL-08059_${f.num}`),
          extracted_at: now,
        },
      },
      dublin_core: {
        dc_title: '三才圖會 鳥獸四卷',
        dc_creator: '王圻; 王思義',
        dc_date: '1609',
        dc_language: 'Literary Chinese',
        dc_type: 'Text',
        dc_format: 'image/jpeg',
        dc_publisher: 'Ming Dynasty (萬曆三十七年)',
        dc_source: 'National Central Library Taiwan, call number 309 08059',
        dc_rights: 'Public Domain',
        dc_identifier: 'NCL:08059',
      },
      description: 'Volume 92 of the Sancai Tuhui (三才圖會), a Ming Dynasty illustrated encyclopedia compiled by Wang Qi and Wang Siyi, published in 1609. This volume covers beasts (獸類) from the Birds & Beasts (鳥獸) section. This edition is scanned from the original 1609 Wanli woodblock print held by the National Central Library of Taiwan — a different and older edition than the modern reprint available on Internet Archive.',
      created_at: now,
      updated_at: now,
    };

    await db.collection('books').insertOne(bookDoc);
    console.log(`  Book created: ${slug} (${bookIdStr})`);

    // Step 4: Upload pages to R2 and create page records
    console.log(`\nStep 4: Uploading ${allPages.length} pages to R2...`);

    const CONCURRENCY = 8;
    let uploaded = 0;
    let workIdx = 0;
    let bytesUploaded = 0;
    const startTime = Date.now();

    async function worker() {
      while (workIdx < allPages.length) {
        const idx = workIdx++;
        if (idx >= allPages.length) break;
        const pageInfo = allPages[idx];

        try {
          let imgBuffer = fs.readFileSync(pageInfo.file);
          const meta = await sharp(imgBuffer).metadata();

          // Cap very large images
          if (meta.width > 3000 || meta.height > 3000) {
            imgBuffer = await sharp(imgBuffer)
              .resize(3000, 3000, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: JPEG_QUALITY })
              .toBuffer();
          }

          // Upload full image
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

          // Create page record (pages need both _id and string id)
          const pageOid = new ObjectId();
          const pageDoc = {
            _id: pageOid,
            id: pageOid.toHexString(),
            book_id: bookIdStr,
            page_number: idx,
            photo: photoUrl,
            photo_original: photoUrl,
            archived_photo: photoUrl,
            thumbnail_blob: thumbUrl,
            archive_metadata: {
              source: 'ncl_taiwan',
              ncl_file: `NCL-08059_${pageInfo.nclFile}`,
              ncl_page_file: pageInfo.fileName,
              dpi: DPI,
              archived_at: now,
            },
            created_at: now,
            updated_at: now,
          };

          await db.collection('pages').insertOne(pageDoc);
          uploaded++;

          if (uploaded % 10 === 0 || uploaded === allPages.length) {
            const elapsed = (Date.now() - startTime) / 1000;
            const rate = uploaded / Math.max(elapsed, 1);
            console.log(`    ${uploaded}/${allPages.length} pages (${rate.toFixed(1)} pg/s, ${(bytesUploaded / (1024*1024)).toFixed(0)} MB)`);
          }
        } catch (err) {
          console.error(`    FAIL page ${idx}: ${err.message?.slice(0, 120)}`);
        }
      }
    }

    const numWorkers = Math.min(CONCURRENCY, allPages.length);
    await Promise.all(Array.from({ length: numWorkers }, () => worker()));

    // Step 5: Set thumbnail
    const firstPage = await db.collection('pages').findOne(
      { book_id: bookIdStr, page_number: 0 },
      { projection: { archived_photo: 1 } }
    );
    if (firstPage?.archived_photo) {
      await db.collection('books').updateOne(
        { _id: bookId },
        { $set: { thumbnail: firstPage.archived_photo } }
      );
    }

    const elapsed = (Date.now() - startTime) / 1000;
    console.log(`\n=== Import Complete ===`);
    console.log(`  Book: ${slug}`);
    console.log(`  Pages: ${uploaded}`);
    console.log(`  Size: ${(bytesUploaded / (1024*1024)).toFixed(1)} MB`);
    console.log(`  Time: ${elapsed.toFixed(0)}s`);
    console.log(`  URL: https://sourcelibrary.org/book/${slug}`);

  } finally {
    await client.close();
    // Clean up temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
