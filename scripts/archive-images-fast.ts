#!/usr/bin/env npx tsx
/**
 * Fast standalone image archiver.
 *
 * Downloads images from external sources (IA, Gallica, MDZ, Wellcome, e-rara),
 * uploads to Vercel Blob, and generates 150px thumbnails in one pass.
 *
 * For pages where `photo` already points to Vercel Blob, just sets
 * `archived_photo = photo` and generates a thumbnail (no re-download).
 *
 * Requires env vars: MONGODB_URI, BLOB_READ_WRITE_TOKEN
 * Use `secret-lover run -- npx tsx scripts/archive-images-fast.ts`
 *
 * Usage:
 *   npx tsx scripts/archive-images-fast.ts                          # all pages
 *   npx tsx scripts/archive-images-fast.ts --concurrency=15         # parallel workers
 *   npx tsx scripts/archive-images-fast.ts --limit=10000            # page limit
 *   npx tsx scripts/archive-images-fast.ts --source=ia              # only Internet Archive
 *   npx tsx scripts/archive-images-fast.ts --source=blob            # only Vercel Blob fixup
 *   npx tsx scripts/archive-images-fast.ts --book-id=abc123         # single book
 *   npx tsx scripts/archive-images-fast.ts --recent=50              # 50 most recent books
 *   npx tsx scripts/archive-images-fast.ts --days=7                 # books imported in last N days
 *   npx tsx scripts/archive-images-fast.ts --skip-thumbnails        # skip thumbnail generation
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { put } from '@vercel/blob';

// CLI args
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '15', 10);
const PAGE_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];
const SOURCE_FILTER = process.argv.find(a => a.startsWith('--source='))?.split('=')[1]; // ia, gallica, mdz, wellcome, erara, blob, s3
const RECENT = parseInt(process.argv.find(a => a.startsWith('--recent='))?.split('=')[1] || '0', 10);
const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '0', 10);
const SKIP_THUMBNAILS = process.argv.includes('--skip-thumbnails');
const DOWNLOAD_TIMEOUT = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30000', 10);

const MONGODB_URI = process.env.MONGODB_URI;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!BLOB_TOKEN) { console.error('Missing BLOB_READ_WRITE_TOKEN'); process.exit(1); }

// Source detection patterns
const SOURCE_PATTERNS: Record<string, RegExp> = {
  blob: /blob\.vercel-storage\.com/,
  ia: /archive\.org/,
  gallica: /gallica\.bnf\.fr/,
  mdz: /digitale-sammlungen\.de/,
  wellcome: /wellcomecollection/,
  erara: /e-rara/,
  s3: /s3\.amazonaws\.com/,
  vatican: /digi\.vatlib\.it/,
  bodleian: /digital\.bodleian/,
  cambridge: /cudl\.lib\.cam/,
  hab: /diglib\.hab\.de/,
};

function detectSource(url: string): string {
  for (const [name, pattern] of Object.entries(SOURCE_PATTERNS)) {
    if (pattern.test(url)) return name;
  }
  return 'other';
}

function getSourceUrl(page: any): string | null {
  // For archiving, use the original URL (not cropped_photo which is already on Blob)
  return page.photo_original || page.photo || null;
}

// Stats tracking
const stats = {
  blobFixup: 0,
  downloaded: 0,
  thumbnailed: 0,
  failed: 0,
  bytesDownloaded: 0,
  bytesUploaded: 0,
  bySource: {} as Record<string, { ok: number; fail: number }>,
};

async function archivePage(page: any, db: any): Promise<boolean> {
  const sourceUrl = getSourceUrl(page);
  if (!sourceUrl) return false;

  const source = detectSource(sourceUrl);
  if (!stats.bySource[source]) stats.bySource[source] = { ok: 0, fail: 0 };

  try {
    const isAlreadyBlob = source === 'blob';
    let archivedUrl: string;
    let bytes = 0;
    let buffer: Buffer | null = null;

    if (isAlreadyBlob) {
      // Page photo already on Vercel Blob — just set archived_photo, no re-upload
      archivedUrl = sourceUrl;
      stats.blobFixup++;
    } else {
      // Download from external source
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);

      let res: Response;
      try {
        res = await fetch(sourceUrl, { signal: controller.signal });
        clearTimeout(timeout);
      } catch (fetchErr: any) {
        clearTimeout(timeout);
        throw new Error(fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message);
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      buffer = Buffer.from(await res.arrayBuffer());
      bytes = buffer.byteLength;
      stats.bytesDownloaded += bytes;

      // Detect MIME type
      const contentType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
      const mimeType = contentType === 'application/octet-stream' ? 'image/jpeg' : contentType;

      // Upload to Vercel Blob with retry
      const filename = `archived/${page.book_id}/${page.page_number}.jpg`;
      let blob;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          blob = await put(filename, buffer, {
            access: 'public',
            contentType: mimeType,
            addRandomSuffix: false,
            allowOverwrite: true,
          });
          break;
        } catch (blobErr: any) {
          if (blobErr.message?.includes('Too many requests') && attempt < 2) {
            await new Promise(r => setTimeout(r, (attempt + 1) * 3000));
            continue;
          }
          throw blobErr;
        }
      }

      archivedUrl = blob!.url;
      stats.bytesUploaded += bytes;
      stats.downloaded++;
    }

    // Generate thumbnail if we have the image (or can fetch from Blob)
    let thumbnailUrl: string | undefined;
    if (!SKIP_THUMBNAILS && !page.thumbnail_blob) {
      try {
        // Get buffer if we don't have it (blob fixup case)
        if (!buffer) {
          const thumbRes = await fetch(archivedUrl);
          if (thumbRes.ok) {
            buffer = Buffer.from(await thumbRes.arrayBuffer());
          }
        }

        if (buffer) {
          // Apply crop if needed
          let thumbInput = buffer;
          if (page.crop && !page.cropped_photo) {
            const metadata = await sharp(buffer).metadata();
            const w = metadata.width || 1000;
            const h = metadata.height || 1000;
            const left = Math.round((page.crop.xStart / 1000) * w);
            const cropWidth = Math.round(((page.crop.xEnd - page.crop.xStart) / 1000) * w);
            thumbInput = await sharp(buffer)
              .extract({ left, top: 0, width: Math.min(cropWidth, w - left), height: h })
              .toBuffer();
          }

          const thumbBuffer = await sharp(thumbInput)
            .resize(150, null, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 60, progressive: true })
            .toBuffer();

          const thumbFilename = `thumbnails/${page.book_id}/${page.page_number}.jpg`;
          let thumbBlob;
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              thumbBlob = await put(thumbFilename, thumbBuffer, {
                access: 'public',
                contentType: 'image/jpeg',
                addRandomSuffix: false,
                allowOverwrite: true,
              });
              break;
            } catch (blobErr: any) {
              if (blobErr.message?.includes('Too many requests') && attempt < 2) {
                await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
                continue;
              }
              // Non-fatal for thumbnails
              break;
            }
          }

          if (thumbBlob) {
            thumbnailUrl = thumbBlob.url;
            stats.thumbnailed++;
          }
        }
      } catch {
        // Non-fatal — thumbnail can be generated later
      }
    }

    // Update MongoDB
    const updateFields: Record<string, unknown> = {
      archived_photo: archivedUrl,
      'archive_metadata.archived_at': new Date(),
      'archive_metadata.source_url': sourceUrl,
      updated_at: new Date(),
    };
    if (bytes > 0) {
      updateFields['archive_metadata.bytes'] = bytes;
    }
    if (thumbnailUrl) {
      updateFields.thumbnail_blob = thumbnailUrl;
    }

    await db.collection('pages').updateOne(
      { _id: page._id },
      { $set: updateFields }
    );

    stats.bySource[source]!.ok++;
    return true;
  } catch (err: any) {
    const msg = err.message || '';

    // Don't mark rate limit errors as permanent
    if (msg.includes('Too many requests') || msg.includes('429')) {
      process.stderr.write(`  [RATE] ${page.book_id}/${page.page_number} (${source})\n`);
      stats.bySource[source]!.fail++;
      stats.failed++;
      return false;
    }

    // Mark permanent failures
    await db.collection('pages').updateOne(
      { _id: page._id },
      { $set: { archived_photo: `failed:${msg.slice(0, 80)}` } }
    ).catch(() => {});

    process.stderr.write(`  [FAIL] ${page.book_id}/${page.page_number} (${source}): ${msg}\n`);
    stats.bySource[source]!.fail++;
    stats.failed++;
    return false;
  }
}

async function runPool(pages: any[], db: any) {
  let idx = 0;
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= pages.length) break;
      const ok = await archivePage(pages[i], db);
      if (ok) success++; else failed++;

      // Progress every 100 pages
      const done = success + failed;
      if (done % 100 === 0) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = done / elapsed;
        const remaining = (pages.length - done) / rate;
        const mbDown = (stats.bytesDownloaded / (1024 * 1024)).toFixed(0);
        const mbUp = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);
        process.stdout.write(
          `  ${done}/${pages.length} (${success} ok, ${failed} fail) — ` +
          `${rate.toFixed(1)} pages/sec, ~${Math.ceil(remaining / 60)} min remaining, ` +
          `${mbDown}MB down, ${mbUp}MB up\n`
        );
      }
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, pages.length) }, () => worker());
  await Promise.all(workers);

  return { success, failed };
}

async function main() {
  console.log(`Image archiver — concurrency: ${CONCURRENCY}, limit: ${PAGE_LIMIT || 'all'}, source: ${SOURCE_FILTER || 'all'}, timeout: ${DOWNLOAD_TIMEOUT}ms`);
  if (BOOK_ID) console.log(`  Book: ${BOOK_ID}`);
  if (RECENT) console.log(`  Recent: ${RECENT} books`);
  if (DAYS) console.log(`  Days: last ${DAYS}`);

  const client = new MongoClient(MONGODB_URI!, { maxPoolSize: 1, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // If --recent or --days, resolve to book IDs first
  let bookIdFilter: string[] | null = null;
  if (RECENT || DAYS) {
    const bookQuery: any = {};
    if (DAYS) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - DAYS);
      bookQuery.created_at = { $gte: cutoff };
    }
    const books = await db.collection('books')
      .find(bookQuery, { projection: { id: 1, title: 1 } })
      .sort({ created_at: -1 })
      .limit(RECENT || 0)
      .toArray();
    bookIdFilter = books.map(b => b.id);
    console.log(`  Resolved to ${bookIdFilter.length} books`);
    if (bookIdFilter.length <= 10) {
      books.forEach(b => console.log(`    - ${b.title?.slice(0, 60)}`));
    }
  }

  // Build query for pages needing archiving
  const query: any = {
    archived_photo: { $exists: false },
  };

  // Source filter
  if (SOURCE_FILTER) {
    const pattern = SOURCE_PATTERNS[SOURCE_FILTER];
    if (!pattern) {
      console.error(`Unknown source: ${SOURCE_FILTER}. Valid: ${Object.keys(SOURCE_PATTERNS).join(', ')}`);
      process.exit(1);
    }
    query.$or = [
      { photo: { $regex: pattern } },
      { photo_original: { $regex: pattern } },
    ];
  }

  if (BOOK_ID) query.book_id = BOOK_ID;
  if (bookIdFilter) query.book_id = { $in: bookIdFilter };

  const totalNeeding = await db.collection('pages').countDocuments(query);
  console.log(`Pages needing archiving: ${totalNeeding}`);

  if (totalNeeding === 0) {
    console.log('Nothing to do!');
    await client.close();
    return;
  }

  const CHUNK_SIZE = PAGE_LIMIT > 0 ? Math.min(5000, PAGE_LIMIT) : 5000;
  let totalSuccess = 0;
  let totalFailed = 0;
  let processed = 0;
  const startTime = Date.now();

  while (true) {
    const remaining = PAGE_LIMIT > 0 ? PAGE_LIMIT - processed : CHUNK_SIZE;
    if (remaining <= 0) break;

    // Re-query each chunk to skip pages completed by other workers
    const pages = await db.collection('pages')
      .find(query, {
        projection: {
          _id: 1, id: 1, book_id: 1, page_number: 1,
          photo: 1, photo_original: 1, archived_photo: 1,
          cropped_photo: 1, crop: 1, thumbnail_blob: 1,
        }
      })
      .sort({ book_id: 1, page_number: 1 })
      .limit(Math.min(CHUNK_SIZE, remaining))
      .toArray();

    if (pages.length === 0) break;

    console.log(`\nChunk: ${pages.length} pages (${processed} done so far)`);
    const { success, failed } = await runPool(pages, db);
    totalSuccess += success;
    totalFailed += failed;
    processed += pages.length;
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const mbDown = (stats.bytesDownloaded / (1024 * 1024)).toFixed(0);
  const mbUp = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done in ${elapsed.toFixed(0)}s — ${totalSuccess} archived, ${totalFailed} failed`);
  console.log(`Rate: ${(totalSuccess / elapsed).toFixed(1)} pages/sec`);
  console.log(`Blob fixups (already on Blob): ${stats.blobFixup}`);
  console.log(`Downloaded from external: ${stats.downloaded}`);
  console.log(`Thumbnails generated: ${stats.thumbnailed}`);
  console.log(`Data: ${mbDown}MB downloaded, ${mbUp}MB uploaded`);
  console.log(`\nBy source:`);
  for (const [source, counts] of Object.entries(stats.bySource).sort((a, b) => b[1].ok - a[1].ok)) {
    console.log(`  ${source}: ${counts.ok} ok, ${counts.fail} fail`);
  }

  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
