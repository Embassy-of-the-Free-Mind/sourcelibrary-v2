#!/usr/bin/env node
/**
 * Re-crop old-era BPH split halves with gutter overlap (issue #2898).
 *
 * The old crop-coord BPH splitter cut each spread into two halves at a single
 * shared gutter line with ZERO overlap (`left.xEnd == right.xStart`), shaving
 * off content that reaches the gutter (right-margin numeral columns, catchwords,
 * long line-ends). This re-crops each half from the PRESERVED full spread
 * (`archived_photo`/`photo_original`, immutable) with ~3.5% overlap on the
 * gutter side, keeping page IDs / links / OCR intact.
 *
 * These pages carry a MATERIALIZED `cropped_photo` (and `photo`/`image_thumb`/
 * `thumbnail` point at it). At read time getPageSource() returns cropped_photo
 * and cropRegion() returns undefined (src/lib/page-image-url.ts), so the display
 * serves the pre-cut file — updating `crop` coords alone changes nothing. We must
 * regenerate the cropped half image.
 *
 * NEW R2 PATHS, not overwrite (issue #2898 decision; #1491 lesson #5):
 * every display/thumb/hires request for these pages goes through the /api/image
 * proxy keyed on the cropped_photo URL. Writing to a new key
 * (`cropped/{bookId}/{pageId}-rc{overlap}.jpg`) and repointing the DB fields
 * changes that key → the fix is live instantly with no CDN purge. Overwriting
 * the same key would serve the old clipped crop for up to a week.
 *
 * Non-destructive + idempotent: nothing is deleted; each page is re-cropped from
 * the immutable spread and the ORIGINAL crop is stashed in `recrop_2898.prev_crop`
 * so re-runs never double-widen. Reversible via the stashed provenance.
 *
 * Re-cropping fixes PIXELS, not the stored OCR/translation (text cut at the
 * gutter is missing from OCR that ran on the clipped crop). Re-OCR is a separate,
 * paid, deferred decision (#2898 Phase 4).
 *
 * Run (on Hetzner or any box with R2 + Mongo creds):
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/recrop-bph-gutter.mjs --book-id 69751588a88d83c830d99e16 --dry-run
 *   node scripts/maintenance/recrop-bph-gutter.mjs --book-id 69751588a88d83c830d99e16
 *   node scripts/maintenance/recrop-bph-gutter.mjs --ids-file /tmp/clip-ids.json
 *
 * TWO widen modes:
 *   • BLIND (default) — add a fixed `--overlap` per-mille to the gutter side. Safe
 *     for WIDE-gutter books (Artis auriferae): it recovers clipped content and only
 *     over-includes a sliver of blank gutter. On TIGHT bindings it drags in the
 *     shadow + the facing page, so don't blanket it across the cohort (issue #3088).
 *   • --to-gutter — per-page, DETECT the true gutter (shared scripts/lib/gutter-clip.mjs,
 *     same geometry the audit uses) and set the cut to the gutter centre. This
 *     recovers exactly the content between the old cut and the binding without
 *     guessing an overlap, and self-limits: a page whose cut is already at/past the
 *     gutter is left untouched (no needless reprocess, no facing-page pull-in). This
 *     is the mode for the targeted cohort sweep. Pages where no gutter is found are
 *     skipped (we won't widen blindly into the unknown).
 *
 * Options:
 *   --book-id ID       Process a single book
 *   --ids-file PATH    JSON array of book ids to process
 *   --overlap N        BLIND mode: per-mille (0-1000) added to gutter side (default 35 = 3.5%)
 *   --to-gutter        Per-page gutter-relative widen (recommended for the sweep)
 *   --gutter-margin N  --to-gutter: per-mille past the gutter centre to keep (default 0)
 *   --concurrency N    Pages processed in parallel per book (default 5)
 *   --limit N          Process at most N books (from --ids-file)
 *   --dry-run          Print old→new bounds, write nothing
 */

import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { spreadProfile, findGutter, measureClip, cropSide } from '../lib/gutter-clip.mjs';

// --- Args ---
const argVal = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const BOOK_ID = argVal('--book-id', null);
const IDS_FILE = argVal('--ids-file', null);
const OVERLAP = parseInt(argVal('--overlap', '35'), 10); // per-mille added to gutter side (blind mode)
const TO_GUTTER = process.argv.includes('--to-gutter');
const GUTTER_MARGIN = parseInt(argVal('--gutter-margin', '0'), 10); // ‰ past gutter centre (to-gutter mode)
const CONCURRENCY = parseInt(argVal('--concurrency', '5'), 10);
const LIMIT = parseInt(argVal('--limit', '0'), 10);
const DRY_RUN = process.argv.includes('--dry-run');

// --- Config ---
const CROPPED_MAX_WIDTH = 2000; // matches the modern splitter; improves the magnifier vs the old 1200px
const CROPPED_QUALITY = 90;
const HIGH_FAIL_FRAC = 0.2; // warn (do NOT abort — re-crop is non-destructive and per-page)

// --- R2 (ALL env values are sanitized. Some .env files store R2_PUBLIC_URL /
// R2_ACCOUNT_ID with a trailing "\n" — as a real newline (dotenv expands it) or
// a LITERAL backslash-n (bash `source` keeps it verbatim). Either corrupts the
// endpoint hostname (the URL parser turns "\" into "/" and truncates the host) →
// DNS failure. Strip both defensively.) ---
const env = (k, def) => (process.env[k] || def || '').trim().replace(/\\n$/, '').trim();
const R2_BUCKET = env('R2_BUCKET_NAME', 'sourcelibrary');
const R2_PUBLIC = env('R2_PUBLIC_URL', 'https://images.sourcelibrary.org');
function getR2() {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKeyId = env('R2_ACCESS_KEY_ID');
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)');
  }
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}
async function uploadToR2(r2, key, buffer) {
  await r2.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: 'image/jpeg',
    // Content-addressed by overlap in the key → safe to cache long.
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${R2_PUBLIC}/${key}`;
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Fetch ${res.status}: ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// The UNCROPPED full spread — never cropped_photo/photo (those are the half).
function fullSpreadSource(page) {
  const a = page.archived_photo;
  if (typeof a === 'string' && a.startsWith('http')) return a;
  const o = page.photo_original;
  if (typeof o === 'string' && o.startsWith('http')) return o;
  return null;
}

// BLIND widen: add OVERLAP per-mille to the gutter side. Returns null if the side
// can't be determined (not a clean left/right half).
function blindWiden(base) {
  if (base.xStart === 0 && base.xEnd < 1000) {
    return { xStart: 0, xEnd: Math.min(1000, base.xEnd + OVERLAP) }; // left half
  }
  if (base.xEnd === 1000 && base.xStart > 0) {
    return { xStart: Math.max(0, base.xStart - OVERLAP), xEnd: 1000 }; // right half
  }
  return null;
}

// GUTTER-RELATIVE widen: move the cut to the detected gutter centre so all content
// between the old cut and the binding is recovered — no overlap guess. Only touches
// pages the AUDIT would flag as clipping (same measureClip, so recrop ⇔ audit agree):
// binding shadow / facing-page bleed / a cut already at-or-past the gutter all yield a
// {status:'skip'} sentinel — the page is left untouched (no needless reprocess).
function gutterWiden(base, profile) {
  const sc = cropSide(base);
  if (!sc) return { status: 'skip', reason: `undetermined side ${JSON.stringify(base)}` };
  const m = measureClip(profile, base);
  if (!m || !m.clipped) return { status: 'skip', reason: `no clip (${m?.gutterKind ?? 'na'}, recover ${m?.recoverWidth ?? 0}‰)` };
  const g = findGutter(profile, sc.cut);
  const target = Math.round(g.mid);
  if (sc.side === 'L') return { crop: { xStart: 0, xEnd: Math.min(1000, target + GUTTER_MARGIN) }, gutter: g };
  return { crop: { xStart: Math.max(0, target - GUTTER_MARGIN), xEnd: 1000 }, gutter: g };
}

// --- Concurrency limiter ---
async function parallelMap(items, fn, concurrency) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function processPage(r2, db, page) {
  // Idempotent base: always widen from the ORIGINAL crop, never a prior re-crop.
  const base = page.recrop_2898?.prev_crop || page.crop;
  const prevCropped = page.recrop_2898?.prev_cropped_photo || page.cropped_photo;

  const src = fullSpreadSource(page);
  if (!src) return { status: 'skip', reason: 'no full-spread source' };

  // Compute the new crop. --to-gutter detects the gutter per page (needs the
  // spread buffer up front, even for a dry-run); BLIND mode is pure arithmetic.
  let newCrop, buf = null, gutter = null, keyTag;
  if (TO_GUTTER) {
    buf = await fetchImage(src);
    const profile = await spreadProfile(buf);
    const w = gutterWiden(base, profile);
    if (w.status === 'skip') return w;
    newCrop = w.crop; gutter = w.gutter;
    keyTag = `g${gutter.kind[0]}${base.xStart === 0 ? newCrop.xEnd : newCrop.xStart}`;
  } else {
    newCrop = blindWiden(base);
    if (!newCrop) return { status: 'skip', reason: `undetermined side ${JSON.stringify(base)}` };
    keyTag = `rc${OVERLAP}`;
  }

  if (DRY_RUN) {
    return { status: 'dry', side: base.xStart === 0 ? 'L' : 'R', from: base, to: newCrop, gutter: gutter && { kind: gutter.kind, mid: gutter.mid } };
  }

  if (!buf) buf = await fetchImage(src);
  const meta = await sharp(buf).metadata();
  const W = meta.width || 1000;
  const H = meta.height || 1000;
  const left = Math.round((newCrop.xStart / 1000) * W);
  const width = Math.round(((newCrop.xEnd - newCrop.xStart) / 1000) * W);

  const outBuf = await sharp(buf)
    .extract({ left, top: 0, width: Math.min(width, W - left), height: H })
    .resize(CROPPED_MAX_WIDTH, null, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: CROPPED_QUALITY, progressive: true })
    .toBuffer();

  // New unique key → fresh /api/image cache key, no CDN purge needed. The key
  // encodes the new bound so a re-run with the same detection reuses it (idempotent).
  const key = `cropped/${page.book_id}/${page.id}-${keyTag}.jpg`;
  const newUrl = await uploadToR2(r2, key, outBuf);

  await db.collection('pages').updateOne(
    { id: page.id },
    {
      $set: {
        cropped_photo: newUrl,
        photo: newUrl,
        image_thumb: newUrl,
        thumbnail: newUrl,
        crop: newCrop,
        recrop_2898: {
          at: new Date(),
          mode: TO_GUTTER ? 'to-gutter' : 'blind',
          overlap: TO_GUTTER ? null : OVERLAP,
          gutter: gutter ? { kind: gutter.kind, mid: gutter.mid } : null,
          prev_crop: base,
          prev_cropped_photo: prevCropped,
        },
        updated_at: new Date(),
      },
    },
  );
  return { status: 'ok', url: newUrl };
}

async function processBook(r2, db, bookId) {
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookId }, { slug: bookId }] },
    { projection: { id: 1, title: 1 } },
  );
  if (!book) { console.log(`  ${bookId}: book not found`); return { notFound: true }; }

  // Old-era crop halves: crop present, materialized cropped_photo, NOT split_from_spread.
  const pages = await db.collection('pages').find(
    {
      book_id: book.id,
      'crop.xStart': { $exists: true },
      cropped_photo: { $exists: true, $ne: null },
      split_from_spread: { $ne: true },
    },
    { projection: {
      id: 1, book_id: 1, page_number: 1, crop: 1,
      archived_photo: 1, photo_original: 1, cropped_photo: 1, recrop_2898: 1,
    } },
  ).sort({ page_number: 1 }).toArray();

  if (pages.length === 0) { console.log(`  ${book.id}: no old-era crop pages`); return { empty: true }; }

  let ok = 0, skip = 0, err = 0;
  const results = await parallelMap(pages, async (page) => {
    try { return await processPage(r2, db, page); }
    catch (e) { return { status: 'error', msg: e.message, page: page.page_number }; }
  }, CONCURRENCY);

  for (const r of results) {
    if (r.status === 'ok') ok++;
    else if (r.status === 'dry') ok++;
    else if (r.status === 'skip') skip++;
    else { err++; if (err <= 5) console.error(`    FAIL p${r.page}: ${r.msg}`); }
  }

  if (DRY_RUN) {
    const sample = results.filter(r => r.status === 'dry').slice(0, 5);
    for (const s of sample) {
      const g = s.gutter ? `  gutter ${s.gutter.mid}(${s.gutter.kind})` : '';
      console.log(`    [${s.side}] ${JSON.stringify(s.from)} → ${JSON.stringify(s.to)}${g}`);
    }
    // In to-gutter mode a "skip" means the page doesn't clip (cut already at/past
    // the gutter) — that's expected and healthy, so report how many were touched.
    console.log(`    would re-crop ${ok}/${pages.length} pages (${skip} left as-is)`);
  }

  const failFrac = pages.length ? err / pages.length : 0;
  const flag = failFrac > HIGH_FAIL_FRAC ? '  ⚠ HIGH FAILURE RATE' : '';
  console.log(`  ${book.id} "${(book.title || '').slice(0, 50)}": ${pages.length} pages → ok ${ok}, skip ${skip}, err ${err}${flag}`);
  return { pages: pages.length, ok, skip, err };
}

async function main() {
  let bookIds = [];
  if (BOOK_ID) bookIds = [BOOK_ID];
  else if (IDS_FILE) bookIds = JSON.parse(readFileSync(IDS_FILE, 'utf8'));
  else { console.error('Provide --book-id or --ids-file'); process.exit(1); }
  if (LIMIT > 0) bookIds = bookIds.slice(0, LIMIT);

  console.log(`Re-crop BPH gutter (issue #2898/#3088)`);
  const modeStr = TO_GUTTER ? `to-gutter (margin ${GUTTER_MARGIN}‰)` : `blind +${OVERLAP}‰`;
  console.log(`Books: ${bookIds.length}, mode: ${modeStr}, concurrency: ${CONCURRENCY}, dry-run: ${DRY_RUN}\n`);

  const r2 = getR2();
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('bookstore');

  const totals = { books: 0, pages: 0, ok: 0, skip: 0, err: 0 };
  const startedAt = Date.now();
  for (let i = 0; i < bookIds.length; i++) {
    console.log(`[${i + 1}/${bookIds.length}]`);
    const res = await processBook(r2, db, bookIds[i]);
    if (res.pages) {
      totals.books++;
      totals.pages += res.pages; totals.ok += res.ok; totals.skip += res.skip; totals.err += res.err;
    }
  }

  const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\nDone in ${mins} min. Books: ${totals.books}, pages: ${totals.pages}, ok: ${totals.ok}, skip: ${totals.skip}, err: ${totals.err}`);
  if (!DRY_RUN && totals.ok > 0) {
    console.log(`\nNext: revalidate ISR for each book (tenant + non-tenant) so readers see the re-cropped halves.`);
  }
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
