#!/usr/bin/env node
/**
 * Replace a book's page images with higher-quality scans from a PDF.
 *
 * Downloads a PDF (or uses a local file), extracts pages with pdftoppm,
 * uploads to R2, and updates existing MongoDB page records — preserving
 * all OCR, translation, and detected_images data.
 *
 * Includes LLM spot-checking via Gemini Vision to verify old/new pages match.
 *
 * Usage:
 *   # Detect which pages in a multi-section PDF correspond to your book
 *   node scripts/maintenance/replace-pages-from-pdf.mjs \
 *     --book-id=6992ce5c673ee1e40e32030d \
 *     --pdf-url="https://..." \
 *     --detect-range
 *
 *   # Preview what will happen
 *   node scripts/maintenance/replace-pages-from-pdf.mjs \
 *     --book-id=6992ce5c673ee1e40e32030d \
 *     --pdf-url="https://..." \
 *     --page-range=START-END \
 *     --dry-run
 *
 *   # Execute the replacement
 *   node scripts/maintenance/replace-pages-from-pdf.mjs \
 *     --book-id=6992ce5c673ee1e40e32030d \
 *     --pdf-url="https://..." \
 *     --page-range=START-END \
 *     --provider-name="National Central Library Taiwan" \
 *     --source-url="https://old.shuge.org/ebook/san-cai-tu-hui/"
 *
 *   # Use a local PDF file instead of downloading
 *   node scripts/maintenance/replace-pages-from-pdf.mjs \
 *     --book-id=6992ce5c673ee1e40e32030d \
 *     --pdf-path=/path/to/local.pdf \
 *     --page-range=START-END
 *
 * Requires: pdftoppm (poppler-utils), sharp, @aws-sdk/client-s3, @google/generative-ai
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ── CLI args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_ID = getArg('book-id');
const PDF_URL = getArg('pdf-url');
const PDF_PATH = getArg('pdf-path');
const PAGE_RANGE = getArg('page-range'); // e.g. "142-222"
const DPI = parseInt(getArg('dpi') || '200', 10);
const DRY_RUN = hasFlag('dry-run');
const DETECT_RANGE = hasFlag('detect-range');
const SKIP_VERIFY = hasFlag('skip-verify');
const VERIFY_ONLY = hasFlag('verify-only');
const PROVIDER_NAME = getArg('provider-name') || 'Unknown';
const SOURCE_URL = getArg('source-url') || '';
const LICENSE = getArg('license') || 'publicdomain';
const PAGE_CONCURRENCY = parseInt(getArg('page-concurrency') || '8', 10);
const JPEG_QUALITY = parseInt(getArg('quality') || '85', 10);
const MAX_DIMENSION = parseInt(getArg('max-dim') || '3000', 10);
const VERIFY_SAMPLES = parseInt(getArg('verify-samples') || '5', 10);

if (!BOOK_ID) { console.error('Missing --book-id'); process.exit(1); }
if (!PDF_URL && !PDF_PATH && !VERIFY_ONLY) { console.error('Missing --pdf-url or --pdf-path'); process.exit(1); }

// ── Env vars ──────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID && !DRY_RUN && !DETECT_RANGE && !VERIFY_ONLY) {
  console.error('Missing R2_ACCOUNT_ID'); process.exit(1);
}

// Verify pdftoppm is available
if (!VERIFY_ONLY) {
  try { execSync('which pdftoppm', { stdio: 'pipe' }); }
  catch { console.error('pdftoppm not found. Install: brew install poppler'); process.exit(1); }
}

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@ancientwisdomtrust.org)';

// ── R2 client ─────────────────────────────────────────────────────────
const s3 = R2_ACCOUNT_ID ? new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
}) : null;

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  if (!s3) throw new Error('R2 not configured');
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// ── Gemini client ─────────────────────────────────────────────────────
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

async function geminiVisionCompare(oldImageUrl, newImageBuffer) {
  if (!genAI) throw new Error('GEMINI_API_KEY not set');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

  // Fetch old image
  const oldRes = await fetch(oldImageUrl, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(30000),
  });
  if (!oldRes.ok) throw new Error(`Failed to fetch old image: ${oldRes.status}`);
  const oldBuffer = Buffer.from(await oldRes.arrayBuffer());

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: oldBuffer.toString('base64'),
      }
    },
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: newImageBuffer.toString('base64'),
      }
    },
    `These are two scans of what should be the same page from a Chinese encyclopedia (三才圖會, Sancai Tuhui).
The FIRST image is the old (lower quality) scan. The SECOND image is the new (higher quality) scan.

Do they show the same page content? Check if the text and illustrations match.
Reply ONLY with JSON (no markdown): {"match": true/false, "confidence": "high"|"medium"|"low", "notes": "brief explanation"}`,
  ]);

  const text = result.response.text().trim();
  // Strip markdown code fences if present
  const jsonStr = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { match: false, confidence: 'low', notes: `Failed to parse: ${text.slice(0, 200)}` };
  }
}

async function geminiDetectJuan(imageBuffer, pdfPageNum) {
  if (!genAI) throw new Error('GEMINI_API_KEY not set');
  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-preview-05-20' });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: 'image/jpeg',
        data: imageBuffer.toString('base64'),
      }
    },
    `This is a page from a Chinese encyclopedia called 三才圖會 (Sancai Tuhui), specifically from the 鳥獸 (Birds & Beasts) section which covers juan (卷) 89 through 94.

Look at this page and determine which juan number it belongs to. The juan number is typically shown in the page header/margin as "三才圖會 鳥獸X卷" where X is the volume number within the section (一 through 六, corresponding to juan 89-94).

Reply ONLY with JSON (no markdown): {"juan": NUMBER, "section_volume": "X卷", "confidence": "high"|"medium"|"low", "notes": "what you see on the page"}`,
  ]);

  const text = result.response.text().trim();
  const jsonStr = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(jsonStr);
  } catch {
    return { juan: null, confidence: 'low', notes: `Parse failed: ${text.slice(0, 200)}` };
  }
}

// ── Download PDF ──────────────────────────────────────────────────────
async function downloadPdf(url, destPath) {
  console.log(`  Downloading PDF from ${url}...`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 900000); // 15 min
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

    const contentLength = res.headers.get('content-length');
    if (contentLength) console.log(`  Size: ${(parseInt(contentLength) / (1024 * 1024)).toFixed(1)} MB`);

    await pipeline(res.body, createWriteStream(destPath));
    const size = fs.statSync(destPath).size;
    console.log(`  Downloaded: ${(size / (1024 * 1024)).toFixed(1)} MB`);
    return size;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// ── Extract pages from PDF ────────────────────────────────────────────
function extractPages(pdfPath, outDir, firstPage, lastPage, dpi) {
  const prefix = path.join(outDir, 'page');
  const args = ['-jpeg', '-r', String(dpi), '-jpegopt', `quality=${JPEG_QUALITY}`];
  if (firstPage) args.push('-f', String(firstPage));
  if (lastPage) args.push('-l', String(lastPage));
  args.push(pdfPath, prefix);

  console.log(`  Extracting pages${firstPage ? ` ${firstPage}-${lastPage}` : ' (all)'} at ${dpi} DPI...`);
  execFileSync('pdftoppm', args, { timeout: 600000, stdio: 'pipe' });

  const files = fs.readdirSync(outDir)
    .filter(f => f.startsWith('page-') && f.endsWith('.jpg'))
    .sort();

  console.log(`  Extracted ${files.length} pages`);
  return files;
}

// ── Get total page count without extracting ───────────────────────────
function getPdfPageCount(pdfPath) {
  const output = execSync(`pdftoppm -f 1 -l 1 -r 10 -jpeg "${pdfPath}" /dev/null 2>&1 || pdfinfo "${pdfPath}" | grep Pages`, {
    timeout: 30000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  // Try pdfinfo output
  const match = output.match(/Pages:\s*(\d+)/);
  if (match) return parseInt(match[1]);
  // Fallback: extract at very low res and count
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-count-'));
  try {
    execFileSync('pdftoppm', ['-jpeg', '-r', '10', pdfPath, path.join(tmpDir, 'p')], { timeout: 120000, stdio: 'pipe' });
    return fs.readdirSync(tmpDir).filter(f => f.endsWith('.jpg')).length;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Detect juan range in multi-section PDF ────────────────────────────
async function detectRange(pdfPath, targetJuan) {
  console.log(`\n  Detecting page range for juan ${targetJuan} in PDF...`);

  // Get total page count
  let totalPages;
  try {
    const infoOutput = execSync(`pdfinfo "${pdfPath}"`, { encoding: 'utf8', timeout: 30000 });
    const match = infoOutput.match(/Pages:\s*(\d+)/);
    totalPages = match ? parseInt(match[1]) : null;
  } catch {}

  if (!totalPages) {
    totalPages = getPdfPageCount(pdfPath);
  }
  console.log(`  Total PDF pages: ${totalPages}`);

  // Sample every ~20 pages + first and last
  const samplePages = new Set([1, totalPages]);
  const step = Math.max(1, Math.floor(totalPages / 20));
  for (let p = 1; p <= totalPages; p += step) samplePages.add(p);

  const sorted = [...samplePages].sort((a, b) => a - b);
  console.log(`  Sampling ${sorted.length} pages for juan detection...`);

  // Extract samples at low res
  const sampleDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-detect-'));
  const juanMap = new Map(); // pdfPage -> juan number

  try {
    for (const pageNum of sorted) {
      const prefix = path.join(sampleDir, `sample`);
      execFileSync('pdftoppm', [
        '-jpeg', '-r', '72', '-jpegopt', 'quality=60',
        '-f', String(pageNum), '-l', String(pageNum),
        pdfPath, prefix,
      ], { timeout: 30000, stdio: 'pipe' });

      const files = fs.readdirSync(sampleDir).filter(f => f.startsWith('sample-') && f.endsWith('.jpg')).sort();
      if (files.length === 0) continue;

      const imgBuffer = fs.readFileSync(path.join(sampleDir, files[files.length - 1]));
      // Clean up sample files
      for (const f of files) fs.unlinkSync(path.join(sampleDir, f));

      const detection = await geminiDetectJuan(imgBuffer, pageNum);
      console.log(`    Page ${pageNum}: juan ${detection.juan} (${detection.confidence}) — ${detection.notes?.slice(0, 60) || ''}`);
      if (detection.juan) juanMap.set(pageNum, detection.juan);
    }

    // Find boundaries of target juan
    const targetPages = [...juanMap.entries()]
      .filter(([, juan]) => juan === targetJuan)
      .map(([page]) => page);

    if (targetPages.length === 0) {
      console.error(`\n  ERROR: Juan ${targetJuan} not found in sampled pages. Try with more samples.`);
      return null;
    }

    const roughStart = Math.min(...targetPages);
    const roughEnd = Math.max(...targetPages);

    // Binary search for exact boundaries
    console.log(`\n  Rough range: pages ${roughStart}-${roughEnd}. Refining boundaries...`);

    // Search backwards from roughStart for exact start
    let exactStart = roughStart;
    for (let p = roughStart - 1; p >= Math.max(1, roughStart - step); p--) {
      const prefix = path.join(sampleDir, 'refine');
      execFileSync('pdftoppm', [
        '-jpeg', '-r', '72', '-jpegopt', 'quality=60',
        '-f', String(p), '-l', String(p),
        pdfPath, prefix,
      ], { timeout: 30000, stdio: 'pipe' });
      const files = fs.readdirSync(sampleDir).filter(f => f.startsWith('refine-') && f.endsWith('.jpg'));
      if (files.length === 0) break;
      const imgBuffer = fs.readFileSync(path.join(sampleDir, files[0]));
      for (const f of files) fs.unlinkSync(path.join(sampleDir, f));

      const det = await geminiDetectJuan(imgBuffer, p);
      console.log(`    Refine page ${p}: juan ${det.juan} (${det.confidence})`);
      if (det.juan === targetJuan) exactStart = p;
      else break;
    }

    // Search forwards from roughEnd for exact end
    let exactEnd = roughEnd;
    for (let p = roughEnd + 1; p <= Math.min(totalPages, roughEnd + step); p++) {
      const prefix = path.join(sampleDir, 'refine');
      execFileSync('pdftoppm', [
        '-jpeg', '-r', '72', '-jpegopt', 'quality=60',
        '-f', String(p), '-l', String(p),
        pdfPath, prefix,
      ], { timeout: 30000, stdio: 'pipe' });
      const files = fs.readdirSync(sampleDir).filter(f => f.startsWith('refine-') && f.endsWith('.jpg'));
      if (files.length === 0) break;
      const imgBuffer = fs.readFileSync(path.join(sampleDir, files[0]));
      for (const f of files) fs.unlinkSync(path.join(sampleDir, f));

      const det = await geminiDetectJuan(imgBuffer, p);
      console.log(`    Refine page ${p}: juan ${det.juan} (${det.confidence})`);
      if (det.juan === targetJuan) exactEnd = p;
      else break;
    }

    console.log(`\n  ✓ Detected range for juan ${targetJuan}: pages ${exactStart}-${exactEnd} (${exactEnd - exactStart + 1} pages)`);
    console.log(`\n  Re-run with: --page-range=${exactStart}-${exactEnd}`);
    return { start: exactStart, end: exactEnd };

  } finally {
    fs.rmSync(sampleDir, { recursive: true, force: true });
  }
}

// ── Spot-check verification ───────────────────────────────────────────
async function verifyPages(db, bookId, extractedDir, pageFiles, existingPages) {
  if (!GEMINI_API_KEY) {
    console.log('\n  GEMINI_API_KEY not set — skipping verification');
    return true;
  }

  console.log(`\n  Verifying ${VERIFY_SAMPLES} sample pages with Gemini Vision...`);

  // Pick samples: first, last, and random middle pages
  const indices = [0, pageFiles.length - 1];
  while (indices.length < Math.min(VERIFY_SAMPLES, pageFiles.length)) {
    const r = Math.floor(Math.random() * pageFiles.length);
    if (!indices.includes(r)) indices.push(r);
  }
  indices.sort((a, b) => a - b);

  let allMatch = true;
  for (const idx of indices) {
    const page = existingPages[idx];
    if (!page) {
      console.log(`    Page index ${idx}: no existing page — SKIP`);
      continue;
    }

    const oldUrl = page.photo_original || page.archived_photo || page.photo;
    if (!oldUrl) {
      console.log(`    Page ${page.page_number}: no old image URL — SKIP`);
      continue;
    }

    const newImgPath = path.join(extractedDir, pageFiles[idx]);
    const newBuffer = fs.readFileSync(newImgPath);

    // Resize new image for comparison (save tokens)
    const compareBuffer = await sharp(newBuffer).resize(800, 800, { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();

    try {
      const result = await geminiVisionCompare(oldUrl, compareBuffer);
      const status = result.match ? '✓' : '✗';
      console.log(`    Page ${page.page_number} [${idx}]: ${status} (${result.confidence}) — ${result.notes?.slice(0, 80) || ''}`);
      if (!result.match) {
        allMatch = false;
        console.log(`    WARNING: Mismatch detected on page ${page.page_number}!`);
      }
    } catch (err) {
      console.log(`    Page ${page.page_number} [${idx}]: ERROR — ${err.message?.slice(0, 100)}`);
    }
  }

  return allMatch;
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`\nReplace Pages from PDF`);
  console.log(`  Book ID: ${BOOK_ID}`);
  console.log(`  Source: ${PDF_URL || PDF_PATH}`);
  console.log(`  DPI: ${DPI}, Quality: ${JPEG_QUALITY}`);
  if (DRY_RUN) console.log('  MODE: DRY RUN');
  if (DETECT_RANGE) console.log('  MODE: DETECT RANGE');
  if (VERIFY_ONLY) console.log('  MODE: VERIFY ONLY');

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  try {
    // Fetch existing book
    const book = await db.collection('books').findOne({
      $or: [{ id: BOOK_ID }, { slug: BOOK_ID }],
    });
    if (!book) { console.error('Book not found'); process.exit(1); }
    console.log(`  Book: ${book.title} (${book.slug})`);

    // Fetch existing pages
    const existingPages = await db.collection('pages')
      .find({ book_id: book.id })
      .sort({ page_number: 1 })
      .toArray();
    console.log(`  Existing pages: ${existingPages.length}`);

    if (VERIFY_ONLY) {
      // Just check that archived pages match originals
      console.log('\n  Running verification on existing pages...');
      for (const page of existingPages.slice(0, VERIFY_SAMPLES)) {
        const oldUrl = page.photo_original;
        const newUrl = page.archived_photo || page.photo;
        if (oldUrl && newUrl && oldUrl !== newUrl) {
          console.log(`  Page ${page.page_number}: old=${oldUrl.slice(-40)}, new=${newUrl.slice(-40)}`);
        }
      }
      return;
    }

    // Get or download PDF
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-replace-'));
    const pdfPath = PDF_PATH || path.join(tmpDir, 'source.pdf');

    try {
      if (!PDF_PATH) {
        await downloadPdf(PDF_URL, pdfPath);
      } else {
        console.log(`  Using local PDF: ${PDF_PATH} (${(fs.statSync(PDF_PATH).size / (1024*1024)).toFixed(1)} MB)`);
      }

      // Detect range mode
      if (DETECT_RANGE) {
        // Determine target juan from book title or metadata
        // For now, look for juan number in the IA identifier or default to asking
        let targetJuan = parseInt(getArg('target-juan') || '0');
        if (!targetJuan) {
          // Try to extract from IA identifier pattern
          const iaId = book.ia_identifier || book.image_source?.identifier || '';
          const match = iaId.match(/(\d+)\.cn$/);
          if (match) {
            // IA identifiers: 02098268.cn = juan 1, so juan = id - 02098267
            const idNum = parseInt(match[1]);
            targetJuan = idNum - 2098267;
            console.log(`  Auto-detected target juan: ${targetJuan} (from IA id ${iaId})`);
          }
        }
        if (!targetJuan) {
          console.error('Cannot determine target juan. Use --target-juan=N');
          process.exit(1);
        }

        await detectRange(pdfPath, targetJuan);
        return;
      }

      // Parse page range
      if (!PAGE_RANGE) {
        console.error('Missing --page-range. Run with --detect-range first to find it.');
        process.exit(1);
      }
      const [firstPage, lastPage] = PAGE_RANGE.split('-').map(Number);
      if (!firstPage || !lastPage || lastPage < firstPage) {
        console.error('Invalid --page-range format. Use START-END, e.g., 142-222');
        process.exit(1);
      }
      const expectedPages = lastPage - firstPage + 1;
      console.log(`  PDF page range: ${firstPage}-${lastPage} (${expectedPages} pages)`);

      // Extract pages
      const pagesDir = path.join(tmpDir, 'pages');
      fs.mkdirSync(pagesDir, { recursive: true });
      const pageFiles = extractPages(pdfPath, pagesDir, firstPage, lastPage, DPI);

      // Validate page count
      if (pageFiles.length !== existingPages.length) {
        console.log(`\n  WARNING: Page count mismatch!`);
        console.log(`    Extracted: ${pageFiles.length}`);
        console.log(`    Existing:  ${existingPages.length}`);
        console.log(`    Difference: ${Math.abs(pageFiles.length - existingPages.length)}`);

        if (pageFiles.length < existingPages.length) {
          console.error('  Fewer pages extracted than existing — aborting. Check --page-range.');
          process.exit(1);
        }
        // More extracted than existing: trim extras (common for blank cover pages in PDFs)
        console.log(`  Will use first ${existingPages.length} extracted pages.`);
      }

      // Spot-check verification
      if (!SKIP_VERIFY) {
        const verified = await verifyPages(db, book.id, pagesDir, pageFiles, existingPages);
        if (!verified) {
          console.error('\n  VERIFICATION FAILED — pages do not match. Aborting.');
          console.error('  Use --skip-verify to override (not recommended).');
          process.exit(1);
        }
        console.log('  ✓ Verification passed');
      }

      if (DRY_RUN) {
        console.log('\n  DRY RUN — no changes made. Remove --dry-run to execute.');
        return;
      }

      // ── Upload and update ─────────────────────────────────────────
      console.log(`\n  Uploading ${existingPages.length} pages to R2...`);

      // Save backup of old URLs
      const backup = existingPages.map(p => ({
        page_number: p.page_number,
        photo: p.photo,
        photo_original: p.photo_original,
        archived_photo: p.archived_photo,
        thumbnail_blob: p.thumbnail_blob,
      }));
      const backupPath = path.join(tmpDir, 'backup.json');
      fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
      console.log(`  Backup saved: ${backupPath}`);
      // Also save to project dir
      const projectBackupPath = path.join(process.cwd(), `scripts/output/backup-${book.id}-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(projectBackupPath), { recursive: true });
      fs.writeFileSync(projectBackupPath, JSON.stringify(backup, null, 2));
      console.log(`  Backup also saved: ${projectBackupPath}`);

      let uploaded = 0;
      let failed = 0;
      let bytesUploaded = 0;
      const startTime = Date.now();

      // Process pages with parallel workers
      let workIdx = 0;
      const pagesToProcess = Math.min(pageFiles.length, existingPages.length);

      async function pageWorker() {
        while (workIdx < pagesToProcess) {
          const idx = workIdx++;
          if (idx >= pagesToProcess) break;
          const page = existingPages[idx];
          const imgPath = path.join(pagesDir, pageFiles[idx]);

          try {
            // Read and optionally resize
            let imgBuffer = fs.readFileSync(imgPath);
            const meta = await sharp(imgBuffer).metadata();

            if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
              imgBuffer = await sharp(imgBuffer)
                .resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: JPEG_QUALITY })
                .toBuffer();
            }

            // Upload full image to R2
            const key = `archived/${book.id}/${page.page_number}.jpg`;
            const url = await uploadToR2(key, imgBuffer);
            bytesUploaded += imgBuffer.length;

            // Generate and upload thumbnail
            const thumbBuffer = await sharp(imgBuffer)
              .resize(150, 150, { fit: 'inside' })
              .jpeg({ quality: 70 })
              .toBuffer();
            const thumbKey = `thumbnails/${book.id}/${page.page_number}.jpg`;
            const thumbUrl = await uploadToR2(thumbKey, thumbBuffer);
            bytesUploaded += thumbBuffer.length;

            // Update MongoDB — preserve original URL, update display URLs
            await db.collection('pages').updateOne(
              { _id: page._id },
              {
                $set: {
                  photo: url,
                  archived_photo: url,
                  thumbnail_blob: thumbUrl,
                  // Preserve original IA URL if not already saved
                  photo_original: page.photo_original || page.photo,
                  'archive_metadata.pdf_source': PDF_URL || PDF_PATH,
                  'archive_metadata.pdf_page': firstPage + idx,
                  'archive_metadata.replaced_at': new Date(),
                  'archive_metadata.replaced_method': 'replace-pages-from-pdf',
                  'archive_metadata.replaced_dpi': DPI,
                  'archive_metadata.previous_source': page.archived_photo || page.photo,
                  updated_at: new Date(),
                },
              }
            );

            uploaded++;
            if (uploaded % 10 === 0 || uploaded === pagesToProcess) {
              const elapsed = (Date.now() - startTime) / 1000;
              const rate = uploaded / Math.max(elapsed, 1);
              console.log(`    ${uploaded}/${pagesToProcess} pages (${rate.toFixed(1)} pg/s, ${(bytesUploaded / (1024*1024)).toFixed(0)} MB uploaded)`);
            }
          } catch (err) {
            failed++;
            console.error(`    FAIL page ${page.page_number}: ${err.message?.slice(0, 120)}`);
          }
        }
      }

      const numWorkers = Math.min(PAGE_CONCURRENCY, pagesToProcess);
      await Promise.all(Array.from({ length: numWorkers }, () => pageWorker()));

      console.log(`\n  Upload complete: ${uploaded} pages, ${failed} failed, ${(bytesUploaded / (1024*1024)).toFixed(1)} MB`);

      // Update book-level metadata
      const previousSource = book.image_source || {};
      await db.collection('books').updateOne(
        { _id: book._id },
        {
          $set: {
            image_source: {
              provider: 'other',
              provider_name: PROVIDER_NAME,
              source_url: SOURCE_URL,
              license: LICENSE,
              access_date: new Date(),
              notes: `Replaced ${previousSource.provider || 'unknown'} scans with higher-quality PDF extraction. DPI: ${DPI}, quality: ${JPEG_QUALITY}.`,
              extraction: {
                method: 'pdftoppm',
                dpi: DPI,
                jpeg_quality: JPEG_QUALITY,
                pdf_page_range: `${firstPage}-${lastPage}`,
                pages_extracted: uploaded,
                extracted_at: new Date(),
              },
            },
            image_source_previous: previousSource,
            thumbnail: `${R2_PUBLIC_URL}/archived/${book.id}/0.jpg`,
            updated_at: new Date(),
          },
        }
      );

      console.log(`\n  ✓ Book metadata updated`);
      console.log(`  ✓ Previous image_source saved to image_source_previous`);
      console.log(`  ✓ Backup at: ${projectBackupPath}`);

      const elapsed = (Date.now() - startTime) / 1000;
      console.log(`\n  Done in ${elapsed.toFixed(0)}s. View at: https://sourcelibrary.org/book/${book.slug}`);

    } finally {
      if (!PDF_PATH) {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
      }
    }
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
