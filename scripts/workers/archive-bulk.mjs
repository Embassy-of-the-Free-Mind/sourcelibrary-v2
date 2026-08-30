#!/usr/bin/env node
/**
 * Bulk IA Archive Worker (pipeline-aware)
 *
 * Downloads _jp2.zip per book instead of individual IIIF requests.
 * ~4x faster than per-page IIIF archiving, full original quality.
 *
 * Only handles IA books. Non-IA sources stay on archive-ocr.mjs (IIIF per-page).
 *
 * Priority: first translations > non-English > English
 *
 * Requires: opj_decompress (libopenjp2-tools), sharp, unzip
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/workers/archive-bulk.mjs
 *   node scripts/workers/archive-bulk.mjs --limit=10 --dry-run
 */

import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import { execSync } from 'child_process';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
const execFileAsync = promisify(execFileCb);
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { uploadPageVariants } from './lib/display-image.mjs';
import { shouldBypassPause, hasScope, resolveScopeBookIds } from './lib/selective-unpause.mjs';
import { fetchAccessLeaves, indexJp2FilesByLeaf } from '../lib/ia-access-leaves.mjs';
import { hashBuffer, hammingHex, HASH_MATCH } from '../lib/page-alignment.mjs';
import { fetchToFileWithStallTimeout } from '../lib/fetch-stall-timeout.mjs';

// CLI args
const args = process.argv.slice(2);
const getArg = (name) => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const hasFlag = (name) => args.includes(`--${name}`);

const BOOK_LIMIT = parseInt(getArg('limit') || '20', 10);  // Books per cron run
const BOOK_CONCURRENCY = parseInt(getArg('concurrency') || '2', 10);
const PAGE_CONCURRENCY = parseInt(getArg('page-concurrency') || '8', 10);
const DRY_RUN = hasFlag('dry-run');
const TARGET_BOOK_ID = getArg('book-id') || null;  // one-off: archive a single book, bypassing the queue
const JPEG_QUALITY = 85;
const MAX_DIMENSION = 3000;
// Pages sampled to verify the zip-leaf mapping before writing a book (#3368).
const ALIGN_SAMPLES = parseInt(getArg('align-samples') || '3', 10);
// Escape hatch for backfills over items already proven aligned. Never default
// this on — the check is what stops a silent off-by-one reaching readers.
const SKIP_ALIGN_CHECK = process.argv.includes('--skip-align-check');
const STALE_TMP_AGE_MS = 6 * 60 * 60 * 1000;  // 6h — older sl-bulk-* dirs are leaked, sweep them
const MAX_BULK_FAILURES = 5;  // Circuit-break a book after N consecutive bulk-archive failures

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

// Verify opj_decompress is available (sharp's libvips JP2 support is unreliable)
try { execSync('which opj_decompress', { stdio: 'pipe' }); }
catch { console.error('opj_decompress not found. Install: apt-get install libopenjp2-tools'); process.exit(1); }

const USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
});

const stats = {
  booksProcessed: 0, booksSkipped: 0, booksFailed: 0,
  pagesArchived: 0, pagesFailed: 0,
  bytesDownloaded: 0, bytesUploaded: 0,
  startTime: Date.now(),
};

// Sweep leftover sl-bulk-* tmpdirs older than STALE_TMP_AGE_MS. A SIGKILL
// (OOM, scheduler kill, wrapper teardown) skips the per-book finally block and
// strands the 700MB-2GB JP2 extraction dir on disk.
function cleanupStaleTmpDirs() {
  const tmpRoot = os.tmpdir();
  const cutoff = Date.now() - STALE_TMP_AGE_MS;
  let removed = 0;
  let bytesFreed = 0;
  let entries;
  try { entries = fs.readdirSync(tmpRoot); } catch { return; }
  for (const name of entries) {
    if (!name.startsWith('sl-bulk-')) continue;
    const full = path.join(tmpRoot, name);
    try {
      const st = fs.statSync(full);
      if (!st.isDirectory() || st.mtimeMs >= cutoff) continue;
      let size = 0;
      try { size = parseInt(execSync(`du -sb "${full}" 2>/dev/null | cut -f1`).toString().trim()) || 0; } catch {}
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
      bytesFreed += size;
    } catch {}
  }
  if (removed > 0) {
    console.log(`[archive-bulk] Swept ${removed} stale tmpdirs (${(bytesFreed / (1024 ** 3)).toFixed(2)} GB freed)`);
  }
}

// After repeated failures, mark a book as blocked so it stops being selected.
// Resets to 0 on the next successful archive run.
async function recordBulkFailure(db, book, errorMsg) {
  const booksCol = book._booksCol || 'books';
  const prevFailures = book.archive_metadata?.bulk_failures || 0;
  const failures = prevFailures + 1;
  const update = {
    'archive_metadata.bulk_failures': failures,
    'archive_metadata.bulk_last_failed_at': new Date(),
    'archive_metadata.bulk_last_error': (errorMsg || 'unknown').slice(0, 200),
  };
  if (failures >= MAX_BULK_FAILURES) {
    update['archive_metadata.blocked'] = true;
    update['archive_metadata.blocked_at'] = new Date();
    update['archive_metadata.blocked_reason'] = `bulk-archive failed ${failures}x: ${(errorMsg || 'unknown').slice(0, 150)}`;
    console.log(`    [BLOCK] ${book.title?.slice(0, 50)} — ${failures} consecutive failures, marking blocked`);
  }
  await db.collection(booksCol).updateOne({ id: book.id }, { $set: update });
}

async function clearBulkFailures(db, book) {
  if (!book.archive_metadata?.bulk_failures) return;
  const booksCol = book._booksCol || 'books';
  await db.collection(booksCol).updateOne(
    { id: book.id },
    { $unset: { 'archive_metadata.bulk_failures': '', 'archive_metadata.bulk_last_failed_at': '', 'archive_metadata.bulk_last_error': '' } }
  );
}

async function uploadToR2(key, buffer, contentType = 'image/jpeg') {
  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME, Key: key, Body: buffer,
    ContentType: contentType, CacheControl: 'public, max-age=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

// Stall timeout, not a total-duration cap (#3477): a multi-GB _jp2.zip on a
// slow link legitimately outlives a fixed clock. The old 600s total survives
// as the absolute backstop; the abort now asks "is data still arriving?".
const FETCH_STALL_MS = parseInt(process.env.ARCHIVE_STALL_TIMEOUT_MS || '60000', 10);

async function downloadToFile(url, destPath, timeoutMs = 600000) {
  const { res, bytes } = await fetchToFileWithStallTimeout(url, destPath, {
    stallMs: FETCH_STALL_MS,
    maxMs: timeoutMs,
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return bytes;
}

async function resolveDownloadUrl(iaId) {
  const metaRes = await fetch(`https://archive.org/metadata/${iaId}/files`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!metaRes.ok) return null;
  const data = await metaRes.json();
  const files = data.result || data.files || [];

  const jp2Zip = files.find(f => f.name?.endsWith('_jp2.zip'));
  if (jp2Zip) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(jp2Zip.name)}`,
      format: 'jp2', size: parseInt(jp2Zip.size || '0'),
    };
  }

  const pdfs = files.filter(f => f.name?.endsWith('.pdf'));
  const chosenPdf = pdfs.find(f => f.format === 'Image Container PDF') || pdfs.find(f => !f.name.endsWith('_text.pdf')) || pdfs[0];
  if (chosenPdf) {
    return {
      url: `https://archive.org/download/${iaId}/${encodeURIComponent(chosenPdf.name)}`,
      format: 'pdf', size: parseInt(chosenPdf.size || '0'),
    };
  }
  return null;
}

function extractJp2Zip(zipPath, destDir) {
  execSync(`unzip -q -o "${zipPath}" -d "${destDir}"`, { timeout: 300000, stdio: 'pipe' });
  const jp2Files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jp2')) jp2Files.push(full);
    }
  }
  walk(destDir);
  return jp2Files.sort();
}

/**
 * Confirm the resolved zip file for a page really is the page IIIF serves (#3368).
 *
 * Samples interior work items, decodes each one, and compares it by perceptual
 * hash against a small render of the page's own IIIF URL. A book only passes if
 * every sample that could be checked matches; anything else is refused, because
 * writing a shifted sequence is far more expensive than skipping a book (it is
 * invisible until a reader reports it, and by then the OCR may have been keyed
 * to the wrong images too).
 *
 * @returns {Promise<{ok:boolean|null, detail:string}>} ok:null = couldn't check
 */
async function verifyLeafMapping(workItems) {
  const interior = workItems.filter(w => (w.page.photo_original || w.page.photo || '').match(/\/page\/n\d+/));
  if (interior.length < 2) return { ok: null, detail: 'too-few-checkable-pages' };

  const picks = [];
  for (let i = 1; i <= ALIGN_SAMPLES; i++) {
    const w = interior[Math.floor(interior.length * (i / (ALIGN_SAMPLES + 1)))];
    if (w && !picks.includes(w)) picks.push(w);
  }

  let matched = 0, checked = 0;
  for (const w of picks) {
    try {
      const iiifUrl = String(w.page.photo_original || w.page.photo)
        .replace(/\/full\/pct:\d+\//, '/full/pct:12/');
      const res = await fetch(iiifUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) continue;
      const [srcHash, zipHash] = await Promise.all([
        hashBuffer(Buffer.from(await res.arrayBuffer())),
        jp2ToJpeg(w.srcFile).then(hashBuffer),
      ]);
      checked++;
      if (hammingHex(srcHash, zipHash) <= HASH_MATCH) matched++;
    } catch { /* no vote */ }
  }

  if (checked === 0) return { ok: null, detail: 'all-verification-fetches-failed' };
  if (matched === checked) return { ok: true, detail: `aligned ${matched}/${checked}` };
  return { ok: false, detail: `only ${matched}/${checked} sampled pages matched IIIF` };
}

async function jp2ToJpeg(jp2Path) {
  // opj_decompress → BMP → sharp → JPEG
  // Sharp's libvips JP2 support is unreliable on some builds, so use opj_decompress
  // Use -threads 1: PAGE_CONCURRENCY already runs N decodes in parallel; letting
  // each opj_decompress also try to grab all cores caused load avg 23 on 8 cores
  // with 0% idle, because parallel decodes were trampling each other.
  const bmpPath = jp2Path + '.out.tif';
  try {
    await execFileAsync('opj_decompress', ['-i', jp2Path, '-o', bmpPath, '-threads', '1'], { timeout: 120000 });
  } catch (err) {
    if (!fs.existsSync(bmpPath)) throw new Error(`opj_decompress failed: ${err.stderr?.slice(0, 200) || err.message}`);
  }
  let sharpPipeline = sharp(bmpPath);
  const meta = await sharpPipeline.metadata();
  if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
    sharpPipeline = sharp(bmpPath).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
  }
  const jpegBuffer = await sharpPipeline.jpeg({ quality: JPEG_QUALITY }).toBuffer();
  try { fs.unlinkSync(bmpPath); } catch {}
  return jpegBuffer;
}

async function processBook(book, db) {
  const iaId = book.ia_identifier || book.image_source?.identifier;
  if (!iaId) { stats.booksSkipped++; return; }

  const pagesCol = book._pagesCol || 'pages';
  const booksCol = book._booksCol || 'books';

  const pages = await db.collection(pagesCol)
    .find({ book_id: book.id, $or: [{ archived_photo: { $exists: false } }, { archived_photo: null }, { archived_photo: '' }] },
      { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1 } })
    .sort({ page_number: 1 }).toArray();

  if (pages.length === 0) { stats.booksSkipped++; return; }

  const allPages = await db.collection(pagesCol)
    .find({ book_id: book.id }, { projection: { _id: 1, id: 1, book_id: 1, page_number: 1, photo: 1, photo_original: 1 } })
    .sort({ page_number: 1 }).toArray();

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `sl-bulk-${iaId.slice(0, 20)}-`));

  try {
    const download = await resolveDownloadUrl(iaId);
    if (!download) {
      console.log(`  [SKIP] ${book.title?.slice(0, 50)} — no JP2 zip or PDF, marking bulk_unsuitable`);
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: {
          'archive_metadata.bulk_unsuitable': true,
          'archive_metadata.bulk_unsuitable_at': new Date(),
          'archive_metadata.bulk_unsuitable_reason': 'IA exposes no JP2 zip or PDF download',
          updated_at: new Date(),
        }}
      );
      stats.booksSkipped++;
      return;
    }

    const sizeMb = download.size ? `${(download.size / (1024 * 1024)).toFixed(0)}MB` : '?MB';
    console.log(`  [${download.format.toUpperCase()}] ${book.title?.slice(0, 50)} — ${pages.length} pages, ${sizeMb}`);

    const downloadPath = path.join(tmpDir, `book.${download.format === 'jp2' ? 'zip' : 'pdf'}`);
    const downloadSize = await downloadToFile(download.url, downloadPath);
    stats.bytesDownloaded += downloadSize;

    let pageFiles;
    if (download.format === 'jp2') {
      pageFiles = extractJp2Zip(downloadPath, tmpDir);
      fs.unlinkSync(downloadPath);
    } else {
      const outPrefix = path.join(tmpDir, 'page');
      execSync(`pdftoppm -jpeg -r 200 "${downloadPath}" "${outPrefix}"`, { timeout: 600000, stdio: 'pipe' });
      fs.unlinkSync(downloadPath);
      pageFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith('page-') && f.endsWith('.jpg')).sort().map(f => path.join(tmpDir, f));
    }

    if (pageFiles.length === 0) {
      console.log(`    [WARN] No page files extracted`);
      stats.booksFailed++;
      await recordBulkFailure(db, book, 'no page files extracted');
      return;
    }

    const needsArchiveIds = new Set(pages.map(p => (p.id || p._id.toString())));
    const workItems = [];
    let skippedNoLeaf = 0;
    let skippedOutOfRange = 0;
    let skippedMissingFile = 0;

    // IIIF /page/nN is NOT the same sequence as the *_jp2.zip leaf ordinals:
    // leaves marked addToAccessFormats=false (Color/White Card, Delete) are in
    // the zip but skipped by IIIF. Treating them as one sequence archived every
    // page its neighbour's scan on affected items (#3368). Resolve the real
    // mapping from the item's scandata; null means unknown, and the alignment
    // verification below is what keeps an unknown mapping from being written.
    let accessLeaves = null;
    let byLeaf = null;
    if (download.format === 'jp2') {
      accessLeaves = await fetchAccessLeaves(iaId);
      byLeaf = indexJp2FilesByLeaf(pageFiles);
      if (accessLeaves) {
        const skipped = pageFiles.length - accessLeaves.length;
        if (skipped > 0) console.log(`    [LEAFMAP] scandata: ${accessLeaves.length} access leaves of ${pageFiles.length} files (${skipped} excluded)`);
      } else {
        console.log(`    [LEAFMAP] no parseable scandata — falling back to positional mapping, will verify before writing`);
      }
    }

    // Resolve one page's IIIF leaf number to a file in the extracted zip.
    const resolveSrcFile = leafNum => {
      if (download.format !== 'jp2') {
        return leafNum < pageFiles.length ? pageFiles[leafNum] : null;
      }
      if (accessLeaves) {
        if (leafNum >= accessLeaves.length) return null;
        // Prefer the filename-keyed map; a sparse zip otherwise shifts every
        // later page when indexed positionally.
        return byLeaf.get(accessLeaves[leafNum]) ?? null;
      }
      return leafNum < pageFiles.length ? pageFiles[leafNum] : null;
    };

    for (const page of allPages) {
      const pageId = page.id || page._id.toString();
      if (!needsArchiveIds.has(pageId)) continue;
      const photoUrl = page.photo_original || page.photo || '';
      // IA URLs encode the access-sequence position as /page/nN. If the page has
      // no photo URL or a non-IA URL, we can't map it to a file in the zip.
      const leafMatch = photoUrl.match(/\/page\/n(\d+)/);
      if (!leafMatch) { skippedNoLeaf++; continue; }
      const leafNum = parseInt(leafMatch[1]);
      const srcFile = resolveSrcFile(leafNum);
      // Leaves past the end of the access sequence have no source file — normal
      // for partial scans. Count them so the worker doesn't silently no-op.
      if (!srcFile) { skippedOutOfRange++; continue; }
      if (!fs.existsSync(srcFile)) { skippedMissingFile++; continue; }
      workItems.push({ page, srcFile, format: download.format });
    }

    const totalSkipped = skippedNoLeaf + skippedOutOfRange + skippedMissingFile;
    if (totalSkipped > 0) {
      console.log(`    [SKIP-PAGES] ${totalSkipped}/${pages.length}: ${skippedNoLeaf} no-leaf, ${skippedOutOfRange} leaf-out-of-range (zip has ${pageFiles.length}), ${skippedMissingFile} missing-file`);
    }

    // If JP2 zip is sparser than the candidate pages (or none match), bulk archive
    // can't recover this book. Mark it bulk_unsuitable so we don't re-download the
    // JP2 every cron round, and let archive-ocr pick it up via per-page IIIF.
    if (workItems.length === 0 && pages.length > 0) {
      const reason = skippedOutOfRange > 0
        ? `JP2 zip sparser than page count (${pageFiles.length} leaves, ${pages.length} pages unarchived)`
        : skippedNoLeaf > 0
        ? `pages have no /page/nN photo URL (${skippedNoLeaf} of ${pages.length})`
        : 'no work items after filtering';
      console.log(`    [FAIL-BOOK] ${reason} — marking bulk_unsuitable, routing to archive-ocr`);
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: {
          'archive_metadata.bulk_unsuitable': true,
          'archive_metadata.bulk_unsuitable_at': new Date(),
          'archive_metadata.bulk_unsuitable_reason': reason,
          updated_at: new Date(),
        }, $unset: {
          // Clear stale bulk_failures so the book isn't double-blocked. The
          // bulk_unsuitable flag is the new source of truth for "skip in bulk".
          'archive_metadata.bulk_failures': '',
          'archive_metadata.bulk_last_error': '',
          'archive_metadata.bulk_last_failed_at': '',
        }}
      );
      stats.booksFailed++;
      return;
    }

    // ── Alignment verification (fail closed) — #3368 ──
    //
    // The scandata mapping above fixes the known cause, but the archiver must
    // not depend on having parsed it correctly for every IA vintage: a silent
    // off-by-one is invisible in the output and only surfaces months later as
    // reader feedback. So before writing anything, confirm that the file we
    // resolved for a page really is the page IIIF serves for it.
    //
    // Compares a decoded sample against the page's own IIIF URL by perceptual
    // hash. Mismatch skips the whole book rather than writing a shifted
    // sequence — same posture as the re-archive guard (#3359).
    if (download.format === 'jp2' && workItems.length > 0 && !SKIP_ALIGN_CHECK) {
      const verdict = await verifyLeafMapping(workItems);
      // ok:null means verification couldn't run. That's tolerable when scandata
      // gave us a principled mapping, but combined with the positional fallback
      // it means writing a mapping nothing has checked — exactly how #3368 got
      // in. Refuse that combination.
      const unverifiableGuess = verdict.ok === null && !accessLeaves;
      if (verdict.ok === false || unverifiableGuess) {
        const reason = unverifiableGuess
          ? `no scandata and mapping unverifiable (${verdict.detail}) — refusing to write an unchecked sequence`
          : `leaf mapping failed verification (${verdict.detail}) — refusing to write a possibly shifted sequence`;
        console.log(`    [FAIL-BOOK] ${reason}`);
        await db.collection(booksCol).updateOne(
          { id: book.id },
          { $set: {
            'archive_metadata.bulk_unsuitable': true,
            'archive_metadata.bulk_unsuitable_at': new Date(),
            'archive_metadata.bulk_unsuitable_reason': reason,
            'archive_metadata.bulk_align_failed': true,
            updated_at: new Date(),
          }}
        );
        stats.booksFailed++;
        return;
      }
      console.log(`    [ALIGN] ${verdict.detail}`);
    }

    let workIdx = 0;
    let archived = 0;
    let failed = 0;

    async function pageWorker() {
      while (workIdx < workItems.length) {
        const idx = workIdx++;
        if (idx >= workItems.length) break;
        const { page, srcFile, format } = workItems[idx];
        try {
          let jpegBuffer;
          if (format === 'jp2') {
            jpegBuffer = await jp2ToJpeg(srcFile);
          } else {
            let sharpInst = sharp(srcFile);
            const meta = await sharpInst.metadata();
            if (meta.width > MAX_DIMENSION || meta.height > MAX_DIMENSION) {
              sharpInst = sharp(srcFile).resize(MAX_DIMENSION, MAX_DIMENSION, { fit: 'inside', withoutEnlargement: true });
            }
            jpegBuffer = await sharpInst.jpeg({ quality: JPEG_QUALITY }).toBuffer();
          }

          // Upload full-res + generate and upload display (1200px) + thumbnail (150px)
          const urls = await uploadPageVariants(jpegBuffer, page.book_id, page.page_number, uploadToR2);
          stats.bytesUploaded += jpegBuffer.length;

          const dimFields = {};
          if (urls.width) dimFields.image_width = urls.width;
          if (urls.height) dimFields.image_height = urls.height;

          await db.collection(pagesCol).updateOne(
            { _id: page._id },
            { $set: {
              archived_photo: urls.archived,
              display_photo: urls.display,
              thumbnail_blob: urls.thumb,
              ...dimFields,
              'archive_metadata.archived_at': new Date(),
              'archive_metadata.source': 'bulk_jp2',
              'archive_metadata.bytes': jpegBuffer.length,
            }}
          );
          archived++;
        } catch (err) {
          failed++;
          if (failed <= 3) console.log(`    [FAIL] page ${page.page_number}: ${err.message?.slice(0, 100)}`);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(PAGE_CONCURRENCY, workItems.length) }, () => pageWorker()));
    stats.pagesArchived += archived;
    stats.pagesFailed += failed;
    stats.booksProcessed++;
    console.log(`    ${archived} archived, ${failed} failed`);

    if (archived > 0) await clearBulkFailures(db, book);

    // Smoke test: verify page 1's display_photo actually resolves
    if (archived > 0) {
      const check = await db.collection(pagesCol).findOne(
        { book_id: book.id, display_photo: { $exists: true, $ne: null } },
        { projection: { display_photo: 1 }, sort: { page_number: 1 }, maxTimeMS: 5000 }
      );
      if (check?.display_photo) {
        try {
          const res = await fetch(check.display_photo, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
          if (!res.ok) console.log(`    [SMOKE] display_photo returned ${res.status}: ${check.display_photo}`);
        } catch (e) {
          console.log(`    [SMOKE] display_photo unreachable: ${e.message?.slice(0, 80)}`);
        }
      }
    }

    // Sync pages_archived counter on this book (#497)
    if (archived > 0) {
      const archivedCount = await db.collection(pagesCol).countDocuments(
        { book_id: book.id, archived_photo: { $exists: true, $nin: [null, ''] } },
        { maxTimeMS: 10000 }
      );
      const archiveStatus = archivedCount >= book.pages_count ? 'archive_complete' : 'archive_partial';
      const update = { pages_archived: archivedCount, archive_status: archiveStatus, updated_at: new Date() };
      // Stamp completion time when a book reaches archive_complete. Lets
      // downstream queries bucket archival throughput by day/week without
      // scanning the pages collection (which is too large for ad-hoc aggregates).
      // The worker already filters out books with all pages archived, so this
      // gets written essentially once per book at first completion.
      if (archiveStatus === 'archive_complete') {
        update.archive_completed_at = new Date();
      }
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: update }
      );
    }

  } catch (err) {
    console.log(`  [ERROR] ${book.title?.slice(0, 50)}: ${err.message?.slice(0, 100)}`);
    stats.booksFailed++;

    const msg = err.message || '';
    // 401/403: auth at source — can't be fixed by retry, block immediately.
    // ETIMEDOUT / spawnSync timeouts: opj_decompress hangs on a malformed JP2
    //   leaf. The whole zip can't be processed by bulk, but archive-ocr can
    //   still fetch the pages one at a time over HTTP. Same routing as the
    //   sparse-JP2 case in processBook.
    // Everything else: transient — record a strike and try again next round.
    if (msg.includes('HTTP 401') || msg.includes('HTTP 403')) {
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: {
          'archive_metadata.blocked': true,
          'archive_metadata.blocked_at': new Date(),
          'archive_metadata.blocked_reason': msg.slice(0, 200),
        }}
      );
    } else if (msg.includes('ETIMEDOUT') || msg.includes('spawnSync')) {
      console.log(`    [FAIL-BOOK] opj_decompress timeout — marking bulk_unsuitable, routing to archive-ocr`);
      await db.collection(booksCol).updateOne(
        { id: book.id },
        { $set: {
          'archive_metadata.bulk_unsuitable': true,
          'archive_metadata.bulk_unsuitable_at': new Date(),
          'archive_metadata.bulk_unsuitable_reason': `opj_decompress timeout: ${msg.slice(0, 160)}`,
          updated_at: new Date(),
        }, $unset: {
          'archive_metadata.bulk_failures': '',
          'archive_metadata.bulk_last_error': '',
          'archive_metadata.bulk_last_failed_at': '',
        }}
      );
    } else {
      await recordBulkFailure(db, book, msg);
    }
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function main() {
  const start = Date.now();
  console.log(`[archive-bulk] Bulk JP2 archiver — ${BOOK_LIMIT} books, ${BOOK_CONCURRENCY} concurrent`);

  cleanupStaleTmpDirs();

  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 10, serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const db = client.db('bookstore');

  // Check processing_control pause. A targeted one-off (--book-id) bypasses it: it's an
  // explicit manual archive of a single specified book, not queue auto-dispatch, so it
  // should run regardless of the queue-level pause (matching the "bypassing the queue"
  // intent of --book-id). The pause only gates the automatic queue path.
  const control = await db.collection('system_config').findOne({ _id: 'processing_control' });
  if (!shouldBypassPause(control, { bookOverride: !!TARGET_BOOK_ID })) {
    console.log(`[archive-bulk] Pipeline paused. Exiting.`);
    await client.close();
    process.exit(0);
  }
  // Selective unpause: when globally paused but a scope is configured (and this
  // isn't an explicit --book-id one-off), proceed but confine archiving to the
  // scoped books — mirrors what the orchestrator does for the paid path (#2616),
  // so the free archiving step doesn't strand scoped books at `queued` with no
  // images on R2. SCOPE_IDS stays null in normal operation (full queue) and for
  // a --book-id run (TARGET_BOOK_ID already confines).
  let SCOPE_IDS = null;
  if (control?.paused && !TARGET_BOOK_ID && hasScope(control)) {
    SCOPE_IDS = [...await resolveScopeBookIds(db, control)];
    console.log(`[archive-bulk] PAUSED globally, selective-unpause scope active — confining to ${SCOPE_IDS.length} allowlisted book(s).`);
  }

  // Find IA books with pages that may need archiving (regardless of pipeline status).
  // Priority: first translations > non-English > English
  const ENGLISH_VARIANTS = ['english', 'eng', 'en'];
  const matchStage = TARGET_BOOK_ID
    ? { $match: { id: TARGET_BOOK_ID } }
    : { $match: {
        pages_count: { $gt: 0 },
        $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] },
        'archive_metadata.blocked': { $ne: true },
        // bulk_unsuitable books have IA JP2 zips that don't align with photo URLs
        // (archive drift, #1504) — leave them to archive-ocr's per-page IIIF path.
        'archive_metadata.bulk_unsuitable': { $ne: true },
        $or: [
          { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
          { 'image_source.provider': 'internet_archive' },
        ],
        // Selective-unpause scope: confine to allowlisted books while paused.
        ...(SCOPE_IDS ? { id: { $in: SCOPE_IDS } } : {}),
      }};
  const iaBooks = await db.collection('books')
    .aggregate([
      matchStage,
      { $addFields: {
        _priority: {
          $switch: {
            branches: [
              { case: { $eq: ['$is_first_translation', true] }, then: 0 },
              { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS] }, then: 2 },
            ],
            default: 1,
          },
        },
      }},
      { $sort: { _priority: 1, hidden: 1, _id: -1 } },
      { $project: { id: 1, title: 1, ia_identifier: 1, image_source: 1, pages_count: 1, language: 1, archive_metadata: 1 } },
      { $limit: BOOK_LIMIT },
    ])
    .toArray();

  // Also include warehouse IA books — prioritize likely first translations.
  // When targeting a single book by --book-id, only the live books collection
  // is consulted (the live id is the canonical surface).
  const warehouseIaBooks = TARGET_BOOK_ID ? [] : await db.collection('books_warehouse')
    .aggregate([
      { $match: {
        pages_count: { $gt: 0 },
        $expr: { $lt: [{ $ifNull: ['$pages_archived', 0] }, '$pages_count'] },
        'archive_metadata.blocked': { $ne: true },
        'archive_metadata.bulk_unsuitable': { $ne: true },
        $or: [
          { ia_identifier: { $exists: true, $ne: null, $ne: '' } },
          { 'image_source.provider': 'internet_archive' },
        ],
        ...(SCOPE_IDS ? { id: { $in: SCOPE_IDS } } : {}),
      }},
      { $addFields: {
        _priority: {
          $switch: {
            branches: [
              { case: { $eq: ['$is_first_translation', true] }, then: 0 },
              { case: { $in: [{ $toLower: { $ifNull: ['$language', ''] } }, ENGLISH_VARIANTS] }, then: 2 },
            ],
            default: 1,
          },
        },
      }},
      { $sort: { _priority: 1, _id: -1 } },
      { $project: { id: 1, title: 1, ia_identifier: 1, image_source: 1, pages_count: 1, language: 1, archive_metadata: 1 } },
      { $limit: BOOK_LIMIT },
    ])
    .toArray()
    .catch(() => []);

  // Tag warehouse books with their collection names
  warehouseIaBooks.forEach(b => { b._pagesCol = 'pages_warehouse'; b._booksCol = 'books_warehouse'; });
  iaBooks.push(...warehouseIaBooks);

  console.log(`[archive-bulk] Found ${iaBooks.length - warehouseIaBooks.length} live + ${warehouseIaBooks.length} warehouse IA books to archive`);

  if (DRY_RUN) {
    iaBooks.forEach((b, i) => console.log(`  ${i + 1}. ${b._booksCol === 'books_warehouse' ? '[WH] ' : ''}${b.title?.slice(0, 60)} (${b.pages_count || '?'} pages, ${b.language || '?'})`));
    await client.close();
    return;
  }

  let bookIndex = 0;
  async function worker() {
    while (bookIndex < iaBooks.length) {
      const idx = bookIndex++;
      const book = iaBooks[idx];
      console.log(`\n[${idx + 1}/${iaBooks.length}] ${book.title?.slice(0, 60)} (${book.pages_count || '?'} pages)`);
      await processBook(book, db);
    }
  }

  await Promise.all(Array.from({ length: Math.min(BOOK_CONCURRENCY, iaBooks.length) }, () => worker()));

  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n[archive-bulk] Done in ${Math.round(elapsed)}s`);
  console.log(`  Books: ${stats.booksProcessed} processed, ${stats.booksFailed} failed, ${stats.booksSkipped} skipped`);
  console.log(`  Pages: ${stats.pagesArchived} archived, ${stats.pagesFailed} failed`);
  console.log(`  Data: ${(stats.bytesDownloaded / (1024 * 1024 * 1024)).toFixed(1)}GB down, ${(stats.bytesUploaded / (1024 * 1024 * 1024)).toFixed(1)}GB up`);

  // Log to cron_runs
  await db.collection('cron_runs').insertOne({
    cron: 'archive-bulk',
    source: 'hetzner',
    started_at: new Date(start),
    finished_at: new Date(),
    duration_ms: Date.now() - start,
    status: stats.booksFailed === 0 ? 'success' : 'partial',
    actions: { ...stats },
  });

  await client.close();
}

main().catch(err => { console.error('[archive-bulk] Fatal:', err); process.exit(1); });
