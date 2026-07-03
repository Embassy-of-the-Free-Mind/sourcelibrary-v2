#!/usr/bin/env node
/**
 * Ingest a BPH book or manuscript from the NAS into Source Library.
 *
 * Reads the .jp2 page scans from /Volumes/bph-images/<Schijf N>/<barcode>/,
 * converts them to JPEG with opj_decompress + sharp, uploads three variants
 * (full, display 1200px, thumb 150px) to R2, creates the Mongo book + page
 * records, and updates `bph_works.sl_book_id` in Supabase.
 *
 * The book is created with `visible: false` / `hidden: true` for QA. Flip
 * visibility from the admin once you've reviewed the result.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/bph-nas-ingest.mjs --barcode RIT003000045 [--dry-run]
 *
 * Required env:
 *   MONGODB_URI, SUPABASE_SERVICE_ROLE_KEY,
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 */
import { MongoClient, ObjectId } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, unlinkSync } from 'fs';
import * as readSync from 'fs';
import { execFileSync } from 'child_process';
import { parseArgs } from 'util';
import { join } from 'path';
import sharp from 'sharp';

// --- Config ---
const BPH_TENANT_ID = 'bce03f71-c18d-4460-b8ad-224c817f9aa0';
const SUPABASE_URL = 'https://ykhxaecbbxaaqlujuzde.supabase.co';
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
const MOUNTPOINT = '/Volumes/bph-images';
const TMP_DIR = '/tmp/bph-jp2-ingest';
const DISPLAY_WIDTH = 1200;
const THUMBNAIL_WIDTH = 150;
const DISPLAY_QUALITY = 80;
const FULL_QUALITY = 85;
const THUMBNAIL_QUALITY = 60;
const PARALLEL_PAGES = 4; // local CPU-bound JP2 decode; modest parallelism

// --- Args ---
const { values: args } = parseArgs({ options: {
  barcode: { type: 'string' },
  'dry-run': { type: 'boolean', default: false },
  force: { type: 'boolean', default: false },
  park: { type: 'boolean', default: false },
} });
const BARCODE = args.barcode;
const DRY = args['dry-run'];
const FORCE = args.force;
const PARK = args.park;
if (!BARCODE || !/^RIT00\d{7}$/.test(BARCODE)) {
  console.error('usage: --barcode RIT00X###### [--dry-run] [--force] [--park]');
  process.exit(1);
}

// --- Clients ---
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const mongo = new MongoClient(process.env.MONGODB_URI);

// --- Helpers ---
function slugify(s) {
  return (s || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
}

function findFolder(barcode) {
  // Search every Schijf. Many T-prefix manuscript folders carry a shelfmark
  // suffix on disk (e.g. `RIT004000005 T13`, `RIT004000019 T62-1`), so we
  // accept either the bare barcode or any directory whose name starts with
  // `<barcode>` and either ends or continues with a non-digit. Schijf 6 was
  // previously skipped as "QA workflow only" — incorrect, it also contains
  // RIT004 manuscript folders.
  const { readdirSync, statSync: fsStat } = readSync;
  for (const disk of ['Schijf 1', 'Schijf 2,3 en 4', 'Schijf 5', 'Schijf 6', 'Schijf 7', 'Schijf 8']) {
    const diskPath = join(MOUNTPOINT, disk);
    if (!existsSync(diskPath)) continue;
    // Fast path: exact match.
    const exact = join(diskPath, barcode);
    if (existsSync(exact)) return exact;
    // Suffixed match (e.g. `RIT004000005 T13`).
    let entries;
    try { entries = readdirSync(diskPath); } catch { continue; }
    const prefix = barcode + ' ';
    const hit = entries.find(e => e === barcode || e.startsWith(prefix));
    if (hit) {
      const full = join(diskPath, hit);
      try { if (fsStat(full).isDirectory()) return full; } catch {}
    }
  }
  return null;
}

mkdirSync(TMP_DIR, { recursive: true });

async function convertJp2(jp2Path) {
  const base = jp2Path.split('/').pop().replace(/\.jp2$/i, '');
  const tifPath = join(TMP_DIR, `${base}-${process.pid}-${Math.random().toString(36).slice(2,8)}.tif`);
  try {
    // opj_decompress is very loud on stderr; discard pipes to avoid EPIPE in parallel.
    execFileSync('opj_decompress', ['-i', jp2Path, '-o', tifPath], { stdio: 'ignore' });
    return await sharp(tifPath).jpeg({ quality: FULL_QUALITY }).toBuffer();
  } finally {
    try { unlinkSync(tifPath); } catch {}
  }
}

async function uploadToR2(key, buffer) {
  if (DRY) return `${R2_PUBLIC_URL}/${key}`;
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET, Key: key, Body: buffer,
    ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400',
  }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function parallelMap(items, fn, n) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return results;
}

// --- Main ---
async function main() {
  console.log(`\n=== Ingest ${BARCODE}${DRY ? ' (DRY RUN)' : ''} ===\n`);

  // 1. Catalog
  // Primary lookup: picturae_barcode column. 90 of the 130 manuscripts have this set.
  // Fallback: for the ~35 T-prefix / un-barcoded rows, derive from memorix_files[0].name
  // (which contains the RIT prefix). Backfill picturae_barcode while we're here.
  let work;
  {
    const { data: byBarcode } = await supabase
      .from('bph_works').select('*').eq('picturae_barcode', BARCODE).maybeSingle();
    if (byBarcode) {
      work = byBarcode;
    } else {
      // Scan rows with null picturae_barcode and match by memorix_files[].name prefix.
      // Supabase REST imposes a default 1000-row limit per page; T-prefix manuscripts
      // sit beyond that without explicit pagination. Page through until we either find
      // the match or exhaust the null-barcode set.
      const PAGE_SIZE = 1000;
      let from = 0;
      while (!work) {
        const { data: page, error: pageErr } = await supabase
          .from('bph_works')
          .select('id, shelf_mark, memorix_files')
          .is('picturae_barcode', null)
          .not('memorix_files', 'is', null)
          .range(from, from + PAGE_SIZE - 1);
        if (pageErr) throw new Error(`Supabase fallback: ${pageErr.message}`);
        if (!page || page.length === 0) break;
        const hit = page.find(r =>
          Array.isArray(r.memorix_files) &&
          r.memorix_files.some(f => f?.name?.startsWith(BARCODE + '_'))
        );
        if (hit) {
          // Re-fetch full row (we only selected id/shelf_mark/memorix_files for paging speed).
          const { data: full } = await supabase
            .from('bph_works').select('*').eq('id', hit.id).single();
          work = full;
          break;
        }
        if (page.length < PAGE_SIZE) break;
        from += PAGE_SIZE;
      }
      if (work) {
        // Citizenship: backfill picturae_barcode into Supabase so future lookups hit the fast path.
        await supabase.from('bph_works').update({ picturae_barcode: BARCODE }).eq('id', work.id);
        console.log(`Backfilled bph_works.picturae_barcode = ${BARCODE} (was null)`);
        work.picturae_barcode = BARCODE;
      }
    }
  }
  if (!work) throw new Error(`No bph_works row for ${BARCODE} (tried picturae_barcode and memorix_files fallback)`);
  console.log(`Catalog: shelf=${work.shelf_mark} | ${work.uniform_title || work.full_title || work.title}`);
  if (work.sl_book_id && !FORCE) {
    console.log(`ALREADY INGESTED: sl_book_id=${work.sl_book_id} (use --force to re-import)`);
    process.exit(0);
  }

  // 2. Folder on disk (prefer local staging dir to avoid SMB stalls)
  const STAGING_DIR = `/tmp/bph-staging/${BARCODE}`;
  const fs = await import('fs/promises');
  let folder = null;
  if (existsSync(STAGING_DIR)) {
    const stagedFiles = (await fs.readdir(STAGING_DIR)).filter(f => /\.jp2$/i.test(f));
    if (stagedFiles.length > 0) {
      folder = STAGING_DIR;
      console.log(`Using local staging at ${STAGING_DIR}`);
    }
  }
  if (!folder) {
    folder = findFolder(BARCODE);
    if (!folder) throw new Error(`Folder not found on NAS — is bph-nas-up.sh run?`);
    console.log(`Reading directly from NAS at ${folder} (consider staging to ${STAGING_DIR} first for reliability)`);
  }
  const files = await fs.readdir(folder);
  const jp2s = files.filter(f => /\.jp2$/i.test(f)).sort();
  if (!jp2s.length) throw new Error(`No .jp2 files in ${folder}`);
  console.log(`Pages: ${jp2s.length} JP2 files, ${(jp2s.reduce((s,f) => s + statSync(join(folder, f)).size, 0) / 1_073_741_824).toFixed(2)} GB total`);

  // 3. Dupe check
  await mongo.connect();
  const db = mongo.db('bookstore');
  const existing = await db.collection('books').findOne({ 'image_source.source_id': BARCODE });
  if (existing && !FORCE) {
    console.log(`SKIP: Mongo already has book id=${existing.id} for this barcode`);
    await mongo.close();
    process.exit(0);
  }

  // 4. Build book record
  const bookId = new ObjectId();
  const bookIdStr = bookId.toHexString();
  const title = work.uniform_title || work.full_title || work.title || work.shelf_mark || `BPH ${BARCODE}`;
  const baseSlug = slugify(title);
  let slug = baseSlug;
  let n = 1;
  while (await db.collection('books').findOne({ slug })) { slug = `${baseSlug}-${++n}`; }

  const now = new Date();
  // Standard provenance stamp for fields lifted from the EFM/BPH Memorix catalog
  // (BPH → Memorix → Supabase `bph_works` → this ingest).
  const provCatalog = {
    source: 'bph-nas-ingest',
    upstream: 'bph_works (Supabase)',
    origin: 'EFM/BPH Memorix cataloging system',
    method: 'bulk-import',
    confidence: 1.0,
    date: now.toISOString(),
  };
  const isManuscript = work.record_type === 'manuscript';

  // Build a per-field provenance entry only when the value is actually present.
  const provIf = (v) => (v === null || v === undefined || v === '' ? undefined : provCatalog);

  // `source_fingerprint` matches the printed-book convention: prefer UBN if the
  // catalog row has it, else fall back to the Picturae barcode. Dedup checks
  // against this string.
  const sourceFingerprint = work.ubn
    ? `dc:${work.ubn}`
    : `bph:${BARCODE}`;

  // `dc_identifier` follows the same logic as the printed ingest: UBN when present.
  const dcIdentifier = work.ubn || BARCODE;

  // `dc_source` cites the catalog (UBN where available) and the Picturae delivery.
  const dcSource = work.ubn
    ? `BPH Catalogue (UBN: ${work.ubn}) / Picturae DAM (${BARCODE})`
    : `BPH Catalogue / Picturae DAM (${BARCODE})`;

  // Park-by-default mode keeps the book out of every cron/orchestrator filter.
  // The orchestrator only matches a known set of pipeline_auto.status values
  // (queued / archiving / archive_complete / images_complete / complete /
  // translate_complete / chapters_complete / enriching / enriched / chapters /
  // summary_indexed). "parked" is intentionally absent from that set.
  const initialStatus = PARK ? 'parked' : 'archive_complete';

  const book = {
    _id: bookId,
    id: bookIdStr,
    slug,
    tenantId: BPH_TENANT_ID,
    tenant: { name: 'ritman', external_id: BARCODE },
    title,
    display_title: title,
    author: work.author || 'Anonymous',
    language: work.language || work.detected_language || 'unknown',
    published: work.year?.toString() || work.ms_date || null,
    publisher: work.publisher || null,
    place_of_publication: work.place || null,
    source_fingerprint: sourceFingerprint,
    image_source: {
      provider: 'bph',
      provider_name: 'Bibliotheca Philosophica Hermetica',
      contributing_library: 'Embassy of the Free Mind (Bibliotheca Philosophica Hermetica)',
      source_id: BARCODE,
      source_url: null, // Memorix has no public per-record URL; left for future curator linking
      identifier: work.ubn || null,
      license: 'unknown', // TODO: confirm with EFM partner agreement; defaults to unknown
      access_date: now,
      shelfmark: work.shelf_mark,
    },
    dublin_core: {
      dc_title: title,
      dc_creator: work.author || null,
      dc_date: work.year?.toString() || work.ms_date || null,
      dc_publisher: work.publisher || null,
      dc_language: work.language || null,
      dc_identifier: dcIdentifier,
      dc_source: dcSource,
    },
    field_provenance: {
      title: provCatalog,
      display_title: provCatalog,
      author: provIf(work.author),
      published: provIf(work.year || work.ms_date),
      publisher: provIf(work.publisher),
      place_published: provIf(work.place),
      language: provIf(work.language),
      categories: provCatalog, // ['manuscripts'] is derived from record_type
      dublin_core: provCatalog,
      metadata: provCatalog,
      contributing_library: provCatalog,
    },
    metadata: {
      // Identification
      shelf_mark: work.shelf_mark,
      ubn: work.ubn,
      memorix_uuid: work.uuid, // EFM Memorix system UUID (separate from bph_works.id Supabase UUID)
      picturae_barcode: BARCODE,
      record_type: work.record_type,
      // Bibliographic
      uniform_title: work.uniform_title,
      full_title: work.full_title,
      // Dating
      ms_date: work.ms_date,
      year: work.year,
      year_raw: work.year_raw,
      // Physical description
      script: work.script,
      scribe: work.scribe,
      binding: work.binding,
      physical_description: work.physical_description,
      object_size_cm: work.object_size_cm,
      illumination_illustration: work.illumination_illustration,
      iconography: work.iconography,
      // Content
      contents: work.contents,
      characterization: work.characterization,
      // Provenance trail
      origin: work.origin,
      provenance: work.provenance,
      acquisition_source: work.acquisition_source,
      acquisition_date: work.acquisition_date,
      // Editorial / scholarly notes
      edition_note: work.edition_note,
      remarks: work.remarks,
      bibliography: work.bibliography,
      annotation: work.annotation,
      // EFM workflow flags (preserved for traceability)
      fully_approved: work.fully_approved,
      publish_scan: work.publish_scan,
      // Catalog file inventory (snapshot from when ingest ran)
      memorix_file_count: work.memorix_file_count,
      memorix_total_file_bytes: work.memorix_total_file_bytes,
      memorix_modified_time: work.memorix_modified_time,
    },
    bph_match: {
      title: 'Direct EFM NAS source',
      year: work.year,
      matched_at: now,
      bph_works_id: work.id, // Supabase bph_works row UUID
      memorix_uuid: work.uuid, // EFM Memorix UUID (the same row's authoritative id at EFM)
    },
    categories: isManuscript ? ['manuscripts'] : [],
    pages_count: jp2s.length,
    pages_ocr: 0,
    pages_translated: 0,
    pages_archived: jp2s.length,
    needs_splitting: null, // populated after pages process based on aspect ratios
    status: 'imported',
    hidden: true,
    visible: false,
    archive_status: 'complete',
    archive_completed_at: now,
    pipeline_auto: {
      status: initialStatus,
      source: 'bph-nas-ingest',
      queued_at: now,
      last_updated: now,
      retry_count: 0,
      ...(PARK ? {
        parked_at: now,
        parked_reason: 'NAS bulk ingest — awaiting design rev (see issue #2165)',
      } : {}),
    },
    acquisition_campaign: 'BPH Manuscripts (NAS)',
    metadata_quality: 'catalog_only',
    contributing_library: 'Bibliotheca Philosophica Hermetica',
    created_at: now,
    updated_at: now,
  };

  console.log(`\nBook: id=${bookIdStr} slug=${slug}`);
  console.log(`  title: ${title}`);
  console.log(`  author: ${book.author}`);
  console.log(`  language: ${book.language}  date: ${book.published}`);
  console.log(`  shelfmark: ${work.shelf_mark}  record_type: ${work.record_type}`);
  console.log(`  visible: false / hidden: true (initial QA)`);

  if (DRY) {
    console.log('\n[DRY RUN] would convert + upload + insert. Sampling page 1 round-trip to verify pipeline…');
    const buf = await convertJp2(join(folder, jp2s[0]));
    const dim = await sharp(buf).metadata();
    console.log(`  page 1: ${(buf.length / 1_048_576).toFixed(2)} MB JPEG, ${dim.width}×${dim.height}`);
    process.exit(0);
  }

  // 5. Convert + upload pages
  console.log(`\nProcessing ${jp2s.length} pages (concurrency=${PARALLEL_PAGES})…`);
  const startTime = Date.now();
  let done = 0, failed = 0;
  const pageDocs = await parallelMap(jp2s, async (jp2Name, idx) => {
    const pageNum = idx + 1;
    const pageNumStr = String(pageNum).padStart(4, '0');
    const base = `pages/${bookIdStr}/${pageNumStr}`;
    try {
      const jp2Path = join(folder, jp2Name);
      const fullBuf = await convertJp2(jp2Path);
      const [displayBuf, thumbBuf] = await Promise.all([
        sharp(fullBuf).resize(DISPLAY_WIDTH).jpeg({ quality: DISPLAY_QUALITY }).toBuffer(),
        sharp(fullBuf).resize(THUMBNAIL_WIDTH).jpeg({ quality: THUMBNAIL_QUALITY }).toBuffer(),
      ]);
      const meta = await sharp(fullBuf).metadata();
      const [fullUrl, displayUrl, thumbUrl] = await Promise.all([
        uploadToR2(`${base}-full.jpg`, fullBuf),
        uploadToR2(`${base}.jpg`, displayBuf),
        uploadToR2(`${base}-thumb.jpg`, thumbBuf),
      ]);
      done++;
      const elapsed = (Date.now() - startTime) / 1000;
      const rate = done / elapsed;
      const eta = Math.round((jp2s.length - done) / rate);
      console.log(`  [${done}/${jp2s.length}] page ${pageNum} (${(fullBuf.length / 1_048_576).toFixed(1)} MB, ${meta.width}×${meta.height}) — ${rate.toFixed(2)}/s ETA ${eta}s`);
      return {
        _id: new ObjectId(),
        id: new ObjectId().toHexString(),
        book_id: bookIdStr,
        tenantId: BPH_TENANT_ID,
        page_number: pageNum,
        photo: displayUrl,
        display_photo: displayUrl,
        archived_photo: fullUrl,
        thumbnail: thumbUrl,
        image_thumb: thumbUrl,
        image_width: meta.width,
        image_height: meta.height,
        width: meta.width,
        height: meta.height,
        ocr: null,
        created_at: now,
        updated_at: now,
      };
    } catch (err) {
      failed++;
      console.error(`  [page ${pageNum}] FAIL: ${err.message}`);
      return null;
    }
  }, PARALLEL_PAGES);

  const validPages = pageDocs.filter(Boolean);
  if (!validPages.length) {
    throw new Error('all pages failed; aborting before inserting book');
  }

  // Detect 2-page spreads via aspect ratio (matches MIN_SPREAD_AR=1.1 in scripts/split-book.mjs).
  // If any page is a spread, the book needs splitting; the pipeline's split-check + spread OCR
  // will handle the actual cropping.
  const spreadCount = validPages.filter(p => p.image_width / p.image_height > 1.1).length;
  book.needs_splitting = spreadCount > 0;
  console.log(`  Spreads detected: ${spreadCount}/${validPages.length} → needs_splitting=${book.needs_splitting}`);

  // 6. Insert book + pages
  console.log(`\nInserting book + ${validPages.length} pages…`);
  await db.collection('books').insertOne(book);
  await db.collection('pages').insertMany(validPages);

  // 7. Set book thumbnail to page 1
  const p1 = validPages.find(p => p.page_number === 1) || validPages[0];
  await db.collection('books').updateOne(
    { _id: bookId },
    { $set: { thumbnail: p1.photo, pages_count: validPages.length, updated_at: new Date() } }
  );

  // 8. Update Supabase bph_works.sl_book_id
  const { error: upErr } = await supabase
    .from('bph_works')
    .update({ sl_book_id: bookIdStr, sl_book_slug: slug })
    .eq('id', work.id);
  if (upErr) console.error(`  WARN: failed to update sl_book_id: ${upErr.message}`);
  else console.log(`  ✓ bph_works.sl_book_id = ${bookIdStr}`);

  await mongo.close();

  console.log(`\n✓ Done. ${validPages.length} pages, ${failed} failed.`);
  console.log(`  Book URL (after visibility flip): https://sourcelibrary.org/book/${slug}`);
  console.log(`  BPH URL:                          https://bph.sourcelibrary.org/book/${slug}`);
  console.log(`  Mongo id: ${bookIdStr}`);
  console.log(`\nNext steps:`);
  console.log(`  1. Review at the URL above with hidden flag flipped (admin tool)`);
  console.log(`  2. Run OCR via the pipeline (gemini-3-flash-preview for BPH)`);
  console.log(`  3. Flip visible:true / hidden:false to publish`);
}

main().catch(async err => {
  console.error('\nFATAL:', err.message);
  console.error(err.stack);
  try { await mongo.close(); } catch {}
  process.exit(1);
});
