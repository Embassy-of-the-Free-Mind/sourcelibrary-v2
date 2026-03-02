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
 *   npx tsx scripts/archive-images-fast.ts --no-bulk               # disable bulk PDF download
 *
 * Bulk PDF mode (default when pdftoppm is available):
 *   Downloads 1 PDF per book instead of N individual IIIF image requests.
 *   Much nicer to library servers — PDFs are static/cached files, IIIF requests
 *   require real-time image processing. Supported: Internet Archive, e-rara.
 *   Requires: poppler-utils (brew install poppler / apt-get install poppler-utils)
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { put } from '@vercel/blob';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// CLI args
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '15', 10);
const PAGE_LIMIT = parseInt(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10);
const BOOK_ID = process.argv.find(a => a.startsWith('--book-id='))?.split('=')[1];
const SOURCE_FILTER = process.argv.find(a => a.startsWith('--source='))?.split('=')[1]; // ia, gallica, mdz, wellcome, erara, blob, s3
const RECENT = parseInt(process.argv.find(a => a.startsWith('--recent='))?.split('=')[1] || '0', 10);
const DAYS = parseInt(process.argv.find(a => a.startsWith('--days='))?.split('=')[1] || '0', 10);
const SKIP_THUMBNAILS = process.argv.includes('--skip-thumbnails');
const DOWNLOAD_TIMEOUT = parseInt(process.argv.find(a => a.startsWith('--timeout='))?.split('=')[1] || '30000', 10);
const NO_BULK = process.argv.includes('--no-bulk');

const MAX_RETRIES = 3; // Retry on 429/503

const MONGODB_URI = process.env.MONGODB_URI;
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!BLOB_TOKEN) { console.error('Missing BLOB_READ_WRITE_TOKEN'); process.exit(1); }

// Check for pdftoppm (poppler-utils) — needed for bulk PDF download
// Install: brew install poppler (macOS) or apt-get install poppler-utils (Linux)
let hasPdftoppm = false;
try {
  execSync('pdftoppm -v 2>&1', { stdio: 'pipe' });
  hasPdftoppm = true;
} catch {}

// User-Agent for polite scraping — identifies us to library servers
const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

// Per-domain rate limiting (requests per second)
const DOMAIN_RATE_LIMITS: Record<string, number> = {
  ia: 10,       // IA is permissive
  gallica: 3,   // BnF is strict
  mdz: 5,
  wellcome: 5,
  erara: 2,     // Small Swiss library — be gentle
  vatican: 3,
  bodleian: 3,
  cambridge: 3,
  hab: 3,
  other: 5,
};

// Token bucket rate limiter per domain
const domainBuckets: Record<string, { tokens: number; lastRefill: number; rate: number }> = {};

function getDomainBucket(source: string) {
  if (!domainBuckets[source]) {
    const rate = DOMAIN_RATE_LIMITS[source] || DOMAIN_RATE_LIMITS.other;
    domainBuckets[source] = { tokens: rate, lastRefill: Date.now(), rate };
  }
  return domainBuckets[source];
}

async function waitForRateLimit(source: string): Promise<void> {
  const bucket = getDomainBucket(source);
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(bucket.rate, bucket.tokens + elapsed * bucket.rate);
  bucket.lastRefill = now;

  if (bucket.tokens < 1) {
    const waitMs = Math.ceil((1 - bucket.tokens) / bucket.rate * 1000);
    await new Promise(r => setTimeout(r, waitMs));
    bucket.tokens = 0;
  } else {
    bucket.tokens -= 1;
  }
}

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
  bulkPages: 0,
  bytesDownloaded: 0,
  bytesUploaded: 0,
  bySource: {} as Record<string, { ok: number; fail: number }>,
};

/**
 * Check if a book's source provider offers bulk PDF download.
 * Synchronous check — doesn't verify URL accessibility.
 */
function hasBulkPdfSource(book: any): boolean {
  const provider = book.image_source?.provider;
  const iaId = book.ia_identifier || (provider === 'ia' ? book.image_source?.identifier : null);
  const eraraId = book.erara_id || (provider === 'e-rara' ? book.image_source?.identifier : null);
  return !!(iaId || eraraId);
}

/**
 * Resolve the actual PDF download URL for a book.
 * For IA, fetches metadata to find the real PDF filename (doesn't always match the identifier).
 * For e-rara, uses a predictable URL pattern.
 */
async function resolveBulkPdfUrl(book: any): Promise<string | null> {
  const provider = book.image_source?.provider;

  // Internet Archive — must look up actual PDF filename from metadata
  const iaId = book.ia_identifier || (provider === 'ia' ? book.image_source?.identifier : null);
  if (iaId) {
    try {
      const metaRes = await fetch(`https://archive.org/metadata/${iaId}`, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!metaRes.ok) return null;

      const metadata = await metaRes.json() as { files?: Array<{ name: string; format?: string; size?: string }> };
      const files = metadata.files || [];
      const pdfs = files.filter(f => f.name.endsWith('.pdf'));
      if (pdfs.length === 0) return null;

      // Prefer Image Container PDF (full resolution scans) over Text PDF
      const imageContainerPdf = pdfs.find(f => f.format === 'Image Container PDF');
      const primaryPdf = pdfs.find(f => !f.name.endsWith('_text.pdf'));
      const chosenPdf = imageContainerPdf || primaryPdf || pdfs[0];

      return `https://archive.org/download/${iaId}/${encodeURIComponent(chosenPdf.name)}`;
    } catch {
      return null;
    }
  }

  // e-rara — predictable URL pattern
  const eraraId = book.erara_id || (provider === 'e-rara' ? book.image_source?.identifier : null);
  if (eraraId) return `https://www.e-rara.ch/download/pdf/${eraraId}`;

  return null;
}

/**
 * Bulk download a book's PDF, split into page images with pdftoppm, upload to Vercel Blob.
 *
 * This is dramatically nicer to library servers:
 * - 1 static file download instead of N dynamic IIIF image requests
 * - PDFs are usually pre-rendered and CDN-cached
 * - IIIF requests require real-time image processing on their end
 *
 * Returns { success, skipped }. If skipped=true, caller falls back to page-by-page.
 */
async function bulkArchiveBook(
  book: any,
  allBookPages: any[],
  pagesToArchive: any[],
  db: any,
): Promise<{ success: number; skipped: boolean }> {
  const pdfUrl = await resolveBulkPdfUrl(book);
  if (!pdfUrl) return { success: 0, skipped: true };

  const source = pdfUrl.includes('archive.org') ? 'ia' : 'erara';
  if (!stats.bySource[source]) stats.bySource[source] = { ok: 0, fail: 0 };
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-bulk-'));

  try {
    // Download PDF — single request
    console.log(`  [BULK] Downloading PDF: ${pdfUrl}`);
    await waitForRateLimit(source);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600000); // 10 min for large PDFs
    const res = await fetch(pdfUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      console.log(`  [BULK] PDF download failed: HTTP ${res.status} — falling back`);
      return { success: 0, skipped: true };
    }

    const pdfBuffer = Buffer.from(await res.arrayBuffer());
    const pdfPath = path.join(tmpDir, 'book.pdf');
    fs.writeFileSync(pdfPath, pdfBuffer);
    const sizeMb = (pdfBuffer.byteLength / (1024 * 1024)).toFixed(0);
    console.log(`  [BULK] Downloaded ${sizeMb}MB PDF (1 request vs ${allBookPages.length} page-by-page)`);
    stats.bytesDownloaded += pdfBuffer.byteLength;

    // Split PDF into JPEG pages with pdftoppm (200 DPI ≈ same as IIIF at 50%)
    const outPrefix = path.join(tmpDir, 'page');
    console.log(`  [BULK] Splitting PDF with pdftoppm...`);
    execSync(`pdftoppm -jpeg -r 200 "${pdfPath}" "${outPrefix}"`, {
      timeout: 600000,
      stdio: 'pipe',
    });

    // Delete PDF to free disk space
    fs.unlinkSync(pdfPath);

    // Find output files (page-01.jpg, page-02.jpg, etc.)
    const outputFiles = fs.readdirSync(tmpDir)
      .filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
      .sort();

    console.log(`  [BULK] Split into ${outputFiles.length} PDF pages (book has ${allBookPages.length} pages)`);

    // Map book pages to PDF pages using leaf numbers from IIIF URLs
    // IA URLs contain /page/nN/ where N is the 0-based leaf number
    // PDF page index = leaf number (pdftoppm output is 1-indexed: page-01.jpg = PDF page 1)
    const pageToFileIndex: Map<string, number> = new Map();
    const needsArchiveSet = new Set(pagesToArchive.map(p => (p.id || p._id.toString())));

    for (const page of allBookPages) {
      const pageId = page.id || page._id.toString();
      if (!needsArchiveSet.has(pageId)) continue;

      // Extract leaf number from IA IIIF URL: /page/nN/
      const photoUrl = page.photo_original || page.photo || '';
      const leafMatch = photoUrl.match(/\/page\/n(\d+)/);
      if (leafMatch) {
        const leafNum = parseInt(leafMatch[1]);
        // leaf N = PDF page N+1 = output file index N
        if (leafNum < outputFiles.length) {
          pageToFileIndex.set(pageId, leafNum);
        }
      }
    }

    // If we can't map most pages, fall back — e-rara and others use 1:1 mapping
    if (pageToFileIndex.size === 0 && source !== 'ia') {
      // Non-IA: try 1:1 mapping if page counts match
      if (outputFiles.length === allBookPages.length) {
        for (let i = 0; i < allBookPages.length; i++) {
          const pageId = allBookPages[i].id || allBookPages[i]._id.toString();
          if (needsArchiveSet.has(pageId)) {
            pageToFileIndex.set(pageId, i);
          }
        }
      }
    }

    if (pageToFileIndex.size === 0) {
      if (source === 'ia') {
        console.log(`  [BULK] Could not map leaf numbers from page URLs — falling back`);
      } else {
        console.log(`  [BULK] Page count mismatch: PDF ${outputFiles.length} vs book ${allBookPages.length} — falling back`);
      }
      return { success: 0, skipped: true };
    }

    console.log(`  [BULK] Mapped ${pageToFileIndex.size}/${pagesToArchive.length} pages to PDF, uploading...`);

    let success = 0;
    for (const page of allBookPages) {
      const pageId = page.id || page._id.toString();
      const fileIndex = pageToFileIndex.get(pageId);
      if (fileIndex === undefined) continue;

      try {
        const imgPath = path.join(tmpDir, outputFiles[fileIndex]);
        const buffer = fs.readFileSync(imgPath);

        // Upload to Vercel Blob
        const filename = `archived/${page.book_id}/${page.page_number}.jpg`;
        let blob;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            blob = await put(filename, buffer, {
              access: 'public',
              contentType: 'image/jpeg',
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

        // Generate thumbnail
        let thumbnailUrl: string | undefined;
        if (!SKIP_THUMBNAILS && !page.thumbnail_blob) {
          try {
            let thumbInput: Buffer = buffer;
            if (page.crop) {
              const meta = await sharp(buffer).metadata();
              const w = meta.width || 1000;
              const h = meta.height || 1000;
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
            const thumbBlob = await put(thumbFilename, thumbBuffer, {
              access: 'public',
              contentType: 'image/jpeg',
              addRandomSuffix: false,
              allowOverwrite: true,
            });
            thumbnailUrl = thumbBlob.url;
            stats.thumbnailed++;
          } catch {
            // Non-fatal
          }
        }

        // Update MongoDB
        const sourceUrl = page.photo_original || page.photo || pdfUrl;
        const updateFields: Record<string, unknown> = {
          archived_photo: blob!.url,
          'archive_metadata.archived_at': new Date(),
          'archive_metadata.source_url': sourceUrl,
          'archive_metadata.bytes': buffer.byteLength,
          'archive_metadata.bulk_source': 'pdf',
          updated_at: new Date(),
        };
        if (thumbnailUrl) updateFields.thumbnail_blob = thumbnailUrl;

        await db.collection('pages').updateOne({ _id: page._id }, { $set: updateFields });

        success++;
        stats.downloaded++;
        stats.bulkPages++;
        stats.bytesUploaded += buffer.byteLength;

        if (success % 50 === 0) {
          console.log(`  [BULK] ${success}/${pagesToArchive.length} uploaded...`);
        }

        // Clean up page file to save disk space
        fs.unlinkSync(imgPath);
      } catch (err: any) {
        process.stderr.write(`  [BULK] Failed page ${page.page_number}: ${err.message}\n`);
        stats.bySource[source]!.fail++;
        stats.failed++;
      }
    }

    stats.bySource[source]!.ok += success;
    console.log(`  [BULK] Done: ${success}/${pagesToArchive.length} archived from PDF`);
    return { success, skipped: false };
  } catch (err: any) {
    console.log(`  [BULK] Error: ${err.message} — falling back to page-by-page`);
    return { success: 0, skipped: true };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

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
      // Rate limit before downloading
      await waitForRateLimit(source);

      const fetchUrl = sourceUrl;

      // Download with retry on 429/503
      let res: Response | undefined;
      let lastErr: Error | undefined;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT);
        try {
          res = await fetch(fetchUrl, {
            signal: controller.signal,
            headers: { 'User-Agent': USER_AGENT },
          });
          clearTimeout(timeout);

          if (res.ok) break;

          // Retry on 429 and 503 with exponential backoff
          if ((res.status === 429 || res.status === 503) && attempt < MAX_RETRIES - 1) {
            const retryAfter = parseInt(res.headers.get('Retry-After') || '0') * 1000;
            const backoff = retryAfter || (attempt + 1) * 3000;
            await new Promise(r => setTimeout(r, backoff));
            res = undefined;
            continue;
          }

          throw new Error(`HTTP ${res.status}`);
        } catch (fetchErr: any) {
          clearTimeout(timeout);
          lastErr = new Error(fetchErr.name === 'AbortError' ? 'timeout' : fetchErr.message);
          if (attempt < MAX_RETRIES - 1 && fetchErr.name !== 'AbortError') {
            await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
            continue;
          }
          throw lastErr;
        }
      }

      if (!res?.ok) throw lastErr || new Error('fetch failed after retries');

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
          // Use cropped version if available, otherwise apply crop manually
          let thumbInput = buffer;
          if (page.cropped_photo) {
            // Cropped photo already exists on Blob — fetch it for the thumbnail
            const croppedRes = await fetch(page.cropped_photo);
            if (croppedRes.ok) {
              thumbInput = Buffer.from(await croppedRes.arrayBuffer());
            }
          } else if (page.crop) {
            // No pre-cropped image — apply crop to the spread buffer
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

// Circuit breaker: stop after this many consecutive failures (e.g. rate limits)
const MAX_CONSECUTIVE_FAILURES = 50;
let consecutiveFailures = 0;
let circuitBroken = false;

async function runPool(pages: any[], db: any) {
  let idx = 0;
  let success = 0;
  let failed = 0;
  const startTime = Date.now();

  async function worker() {
    while (true) {
      if (circuitBroken) break;
      const i = idx++;
      if (i >= pages.length) break;
      const ok = await archivePage(pages[i], db);
      if (ok) {
        success++;
        consecutiveFailures = 0;
      } else {
        failed++;
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          circuitBroken = true;
          process.stdout.write(`\n  CIRCUIT BREAKER: ${MAX_CONSECUTIVE_FAILURES} consecutive failures — stopping.\n`);
          break;
        }
      }

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
  console.log(`  Bulk PDF mode: ${NO_BULK ? 'disabled' : hasPdftoppm ? 'enabled (pdftoppm found)' : 'unavailable (install poppler-utils)'}`);
  console.log(`  User-Agent: ${USER_AGENT}`);
  console.log(`  Per-domain rate limits: ${Object.entries(DOMAIN_RATE_LIMITS).map(([k, v]) => `${k}:${v}/s`).join(', ')}`);
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

  // === Bulk PDF download (nicer to library servers) ===
  // Downloads 1 PDF instead of N individual IIIF image requests
  let bulkSuccess = 0;
  let bulkFailed = 0;

  if (!NO_BULK && hasPdftoppm) {
    const distinctBookIds = await db.collection('pages').distinct('book_id', query);

    if (distinctBookIds.length > 0 && distinctBookIds.length <= 100) {
      const books = await db.collection('books')
        .find(
          { id: { $in: distinctBookIds } },
          { projection: { id: 1, title: 1, ia_identifier: 1, erara_id: 1, image_source: 1 } }
        )
        .toArray();

      const booksWithPdf = books.filter(b => hasBulkPdfSource(b));

      if (booksWithPdf.length > 0) {
        console.log(`\nBulk PDF download available for ${booksWithPdf.length}/${distinctBookIds.length} book(s)`);

        for (const book of booksWithPdf) {
          const allBookPages = await db.collection('pages')
            .find(
              { book_id: book.id },
              { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1, archived_photo: 1, crop: 1, thumbnail_blob: 1 } }
            )
            .sort({ page_number: 1 })
            .toArray();

          const pagesToArchive = allBookPages.filter((p: any) => !p.archived_photo);
          if (pagesToArchive.length === 0) continue;

          console.log(`\n  ${book.title?.slice(0, 60)} — ${pagesToArchive.length}/${allBookPages.length} pages`);

          const result = await bulkArchiveBook(book, allBookPages, pagesToArchive, db);
          if (!result.skipped) {
            bulkSuccess += result.success;
            bulkFailed += (pagesToArchive.length - result.success);
          }
        }

        const remainingAfterBulk = await db.collection('pages').countDocuments(query);
        if (remainingAfterBulk === 0) {
          console.log(`\nAll pages archived via bulk PDF download!`);
        } else {
          console.log(`\n${remainingAfterBulk} pages remaining for page-by-page download`);
        }
      }
    }
  } else if (!NO_BULK && !hasPdftoppm) {
    console.log('  Note: pdftoppm not found — bulk PDF mode disabled. Install poppler-utils to enable.');
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

    if (circuitBroken) {
      console.log(`\nStopping early — circuit breaker tripped. ${totalSuccess} archived, ${totalFailed} failed.`);
      break;
    }
  }

  const elapsed = (Date.now() - startTime) / 1000;
  const mbDown = (stats.bytesDownloaded / (1024 * 1024)).toFixed(0);
  const mbUp = (stats.bytesUploaded / (1024 * 1024)).toFixed(0);

  const grandSuccess = bulkSuccess + totalSuccess;
  const grandFailed = bulkFailed + totalFailed;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Done in ${elapsed.toFixed(0)}s — ${grandSuccess} archived, ${grandFailed} failed`);
  if (bulkSuccess > 0) {
    console.log(`  Bulk PDF: ${bulkSuccess} pages (${bulkFailed} failed)`);
    console.log(`  Page-by-page: ${totalSuccess} pages (${totalFailed} failed)`);
  }
  console.log(`Rate: ${(grandSuccess / elapsed).toFixed(1)} pages/sec`);
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
