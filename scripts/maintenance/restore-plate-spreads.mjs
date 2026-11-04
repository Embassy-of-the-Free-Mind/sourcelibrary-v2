#!/usr/bin/env node
/**
 * Put a plate that was cut across the fold back together as ONE page (#8042).
 *
 * PRIOR ART: scripts/maintenance/fix-false-split-portrait-pages.mjs repairs a SINGLE-LEAF frame cut in half (it
 * clears crop/cropped_photo/thumbnail so the full leaf shows); it finds its cases by aspect ratio and keeps both
 * pages, so it cannot retire the second half and cannot join two leaf photos. scripts/maintenance/hide-repeat-
 * captures.mjs retires a page with `repeat_of` (reader drops it, its URL redirects to the kept page, numbering and
 * text stay); this reuses that mechanism for the retired half.
 *
 * Three shapes, each confirmed BY EYE per pair before it goes in the plan (none is found by this script):
 *   join          the source photographed the plate as two leaf images (IA's Piranesi Carceri). The two images are
 *                 composed side by side into a new R2 object pages/<book>/plate-<run>-<NNNN>.jpg.
 *   unsplit-frame split-book.mjs cut a frame it archived as page_type 'archived-spread'; `frame` names that page and
 *                 its whole image is shown again.
 *   unsplit-crop  the Dec-2025 in-app splitter: two pages crop one archived_photo; the kept page's own archived_photo
 *                 is the whole image.
 *
 * In every shape the KEPT page gets `cropped_photo` = the whole image (getPageSource() precedence 1, which also
 * outranks a `crop`) and the RETIRED page gets `repeat_of` = the kept page id. Nothing is deleted or renumbered; no
 * OCR, translation or image field is removed; the before-state of every field written is stored on the page
 * (`plate_whole.before`) and in sweep_log, so `--revert <run>` restores it exactly. Detections on the kept page are
 * remapped onto the whole image (a join unions the two halves' bboxes); the retired page keeps its own.
 *
 * Refuses, per book: a book in --skip-file (page-order-renumber-5699), a book a lane wrote in the last 3 days
 * (lane_job_books), and a book with a tenantId unless --allow-tenant (retiring a page removes it from a partner's
 * reading room: ask first, #8042).
 *
 * The OCR/translation of the kept page described HALF the plate: every touched page with text is written to
 * <out>/needs-read.jsonl for a separate read job. gallery_images rows of both halves are listed in <out>/gallery.jsonl
 * for scripts/maintenance/regen-split-gallery-images.mjs; this script does not write gallery_images.
 *
 * Plan file: JSON array of { book, kind: 'join'|'unsplit-frame'|'unsplit-crop', keep: <page id>, retire: <page id>,
 *   frame?: <page id> (unsplit-frame), note?: string }. keep is the LEFT half for a join.
 *
 * Usage (dry run is the default):
 *   node --env-file=.env.production.local scripts/maintenance/restore-plate-spreads.mjs --plan plan.json \
 *     --out $JOB_SCRATCH/run1 [--skip-file skip.txt] [--allow-tenant] [--apply] [--recount] [--revalidate]
 *   ... --revert <run id> --books a,b [--apply] [--recount] [--revalidate]
 *   ... --sharpen <run id> --books a,b [--apply] [--revalidate]
 *
 * SHARPEN (#8042, Derek 2026-11-04: "image quality looks poor"): a kept page shows its whole image through the
 * display tier, a 1200px proxy resize of a 5000px plate. --sharpen writes, per kept page of the run, a display copy
 * made from that whole image (long side up to 3200px, JPEG q85, never enlarged) to pages/<book>/plate-<page id>-
 * display.jpg, and sets display_photo to it with `plate_whole.display = { url, of: <the whole image>, ... }`;
 * page-image-url.ts serves it only while `of` is still the page's source. A whole image of 4 MP or more also gets
 * `fullres_master` = that image, the input of scripts/workers/deepzoom-tile-pages.mjs. The archived master is never
 * re-encoded and no old file is removed. The fields it replaced are kept in `plate_whole.display.before`, and
 * --revert restores them (display_photo, fullres_master, deepzoom) along with the rest.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { MongoClient } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook, hasOcr, hasTranslation } from '../lib/page-counts.mjs';
import { bboxToJoined, bboxUnion } from '../lib/plate-spread.mjs';
import { getPageSource } from '../lib/page-image-url.mjs';

const SWEEP = 'restore-plate-spreads-8042';
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag('apply');
const REVERT = opt('revert');
const SHARPEN = opt('sharpen');
const DISPLAY_LONG = 3200, DISPLAY_Q = 85, DEEPZOOM_MIN_MP = 4;
const RUN = REVERT || SHARPEN || opt('run') || `plate8042-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;
const OUT = opt('out') || path.join(process.env.JOB_SCRATCH || '/tmp', `restore-plate-spreads-${RUN}`);
const WRITTEN = ['cropped_photo', 'detected_images', 'repeat_of', 'repeat_of_meta'];
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, page_type: 1, photo: 1, photo_original: 1, enhanced_photo: 1, archived_photo: 1, cropped_photo: 1, crop: 1, split_from_spread: 1, split_side: 1, detected_images: 1, repeat_of: 1, repeat_of_meta: 1, plate_whole: 1, ocr: 1, translation: 1, display_photo: 1, fullres_master: 1, deepzoom: 1 };

fs.mkdirSync(OUT, { recursive: true });
const log = (file, row) => fs.appendFileSync(path.join(OUT, file), JSON.stringify(row) + '\n');

const client = await MongoClient.connect(process.env.MONGODB_URI);
const db = client.db('bookstore');
const pages = db.collection('pages');

const r2 = new S3Client({
  region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

const usable = (u) => typeof u === 'string' && /^https?:\/\//.test(u);
/** The image a page shows today, before this repair. */
const shownImage = (p) => getPageSource(p);

async function fetchBuf(url) {
  for (let t = 1; t <= 3; t++) {
    const r = await fetch(url);
    if (r.ok) return Buffer.from(await r.arrayBuffer());
    if (t === 3) throw new Error(`${r.status} ${url}`);
    await new Promise((res) => setTimeout(res, 2000 * t));
  }
}

async function joinImages(bookId, leftUrl, rightUrl, pageNumber) {
  const [lb, rb] = await Promise.all([fetchBuf(leftUrl), fetchBuf(rightUrl)]);
  const [lm, rm] = await Promise.all([sharp(lb).metadata(), sharp(rb).metadata()]);
  const H = Math.min(lm.height, rm.height);
  const l = await sharp(lb).resize({ height: H }).toBuffer({ resolveWithObject: true });
  const r = await sharp(rb).resize({ height: H }).toBuffer({ resolveWithObject: true });
  const W = l.info.width + r.info.width;
  const buf = await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([{ input: l.data, left: 0, top: 0 }, { input: r.data, left: l.info.width, top: 0 }])
    .jpeg({ quality: 90 }).toBuffer();
  const key = `pages/${bookId}/plate-${RUN}-${String(pageNumber).padStart(4, '0')}.jpg`;
  assertBookScopedKey(key, bookId, SWEEP);
  if (APPLY) await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
  return { url: `${R2_PUBLIC}/${key}`, wLeft: l.info.width, wRight: r.info.width, W, H, bytes: buf.length };
}

/** Detections for the kept page, measured on the whole image. */
function remapDetections(kind, keep, retire, geo) {
  const dk = Array.isArray(keep.detected_images) ? keep.detected_images : [];
  if (!dk.length) return undefined;
  if (kind === 'join') {
    const dr = Array.isArray(retire.detected_images) ? retire.detected_images : [];
    return dk.map((d, i) => {
      if (!d?.bbox) return d;
      let bbox = bboxToJoined(d.bbox, 'left', geo.wLeft, geo.wRight);
      if (i === 0 && dr.length === 1 && dr[0]?.bbox) bbox = bboxUnion(bbox, bboxToJoined(dr[0].bbox, 'right', geo.wLeft, geo.wRight));
      return { ...d, bbox };
    });
  }
  // unsplit: a leaf's bbox is 0–1 of its half; the half's side says where it sits in the whole.
  const side = keep.split_side === 'right' ? 'right' : 'left';
  return dk.map((d) => (d?.bbox ? { ...d, bbox: bboxToJoined(d.bbox, side, 1, 1) } : d));
}

function before(p) { const b = {}; for (const f of WRITTEN) b[f] = p[f] === undefined ? null : p[f]; return b; }
const hasText = (p) => hasOcr(p) || hasTranslation(p);

async function revalidate(bookId) {
  const secret = process.env.REVALIDATE_SECRET || process.env.CRON_SECRET;
  if (!secret) return 'no-secret';
  const r = await fetch(`https://sourcelibrary.org/api/admin/revalidate-book/${bookId}`, { method: 'POST', headers: { 'x-revalidate-secret': secret } });
  return r.status;
}

async function afterBook(bookId) {
  if (!APPLY) return;
  if (flag('recount')) console.log(`  recount ${bookId}:`, JSON.stringify(await recountBook(db, bookId, { reason: SWEEP })).slice(0, 200));
  if (flag('revalidate')) console.log(`  revalidate ${bookId}: ${await revalidate(bookId)}`);
}

async function bookRefusal(bookId, skip) {
  if (skip.has(bookId)) return 'on the page-order-renumber-5699 list';
  const since = new Date(Date.now() - 3 * 86400e3);
  const lane = await db.collection('lane_job_books').findOne({ book_id: bookId, $or: [{ updated_at: { $gte: since } }, { created_at: { $gte: since } }] });
  if (lane) return `lane_job_books row ${lane._id} in the last 3 days`;
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { tenantId: 1, title: 1 } });
  if (!book) return 'book not found';
  if (book.tenantId && !flag('allow-tenant')) return `tenant book (${book.tenantId}): retiring a page removes it from a partner reading room — ask first`;
  return null;
}

try {
  if (REVERT) {
    const books = (opt('books') || '').split(',').filter(Boolean);
    if (!books.length) throw new Error('--revert needs --books (per-book, so the query uses the book_id index)');
    for (const bookId of books) {
      const touched = await pages.find({ book_id: bookId, 'plate_whole.run': RUN }, { projection: PROJ }).toArray();
      console.log(`${bookId}: ${touched.length} page(s) from run ${RUN}`);
      for (const p of touched) {
        const b = p.plate_whole.before || {};
        const $set = {}, $unset = { plate_whole: '' };
        for (const f of WRITTEN) { if (b[f] == null) $unset[f] = ''; else $set[f] = b[f]; }
        // --sharpen's fields: back to what they were before it ran (the tiles and the copy stay on R2, unreferenced).
        const db4 = p.plate_whole.display?.before;
        if (db4) for (const f of ['display_photo', 'fullres_master', 'deepzoom']) { if (db4[f] == null) $unset[f] = ''; else $set[f] = db4[f]; }
        console.log(`  p.${p.page_number} ${p.id}: restore ${JSON.stringify(Object.keys($set))} unset ${JSON.stringify(Object.keys($unset))}`);
        if (!APPLY) continue;
        await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'revert-plate-whole', detail: { page_id: p.id, page_number: p.page_number, run: RUN, restored: b } });
        await pages.updateOne({ id: p.id, book_id: bookId, 'plate_whole.run': RUN }, { ...(Object.keys($set).length ? { $set } : {}), $unset });
      }
      await afterBook(bookId);
    }
  } else if (SHARPEN) {
    const books = (opt('books') || '').split(',').filter(Boolean);
    if (!books.length) throw new Error('--sharpen needs --books (per-book, so the query uses the book_id index)');
    const tally = { pages: 0, written: 0, skipped: 0, fullres: 0 };
    for (const bookId of books) {
      const kept = await pages.find({ book_id: bookId, 'plate_whole.run': RUN, 'plate_whole.role': 'kept' }, { projection: PROJ }).toArray();
      console.log(`${bookId}: ${kept.length} kept page(s) from run ${RUN}`);
      for (const p of kept) {
        tally.pages++;
        const whole = p.cropped_photo;
        const skip = (why) => { console.log(`  SKIP p.${p.page_number} ${p.id}: ${why}`); tally.skipped++; };
        if (!usable(whole) || !whole.includes(bookId)) { skip(`whole image not usable/book-scoped (${whole})`); continue; }
        if (p.plate_whole.display?.of === whole && p.display_photo === p.plate_whole.display.url) { skip('already sharpened'); continue; }
        const buf = await fetchBuf(whole);
        const meta = await sharp(buf, { limitInputPixels: false }).metadata();
        const out = await sharp(buf, { limitInputPixels: false })
          .resize({ width: DISPLAY_LONG, height: DISPLAY_LONG, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: DISPLAY_Q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
        const key = `pages/${bookId}/plate-${p.id}-display.jpg`;
        assertBookScopedKey(key, bookId, SWEEP);
        const url = `${R2_PUBLIC}/${key}`;
        const mp = (meta.width * meta.height) / 1e6;
        const at = new Date();
        const display = { url, of: whole, width: out.info.width, height: out.info.height, bytes: out.data.length, quality: DISPLAY_Q, at, by: `system:${SWEEP}`,
          // image-pick-ok: a revert snapshot of the stored fields, never read to fetch or crop an image
          before: { display_photo: p.display_photo ?? null, fullres_master: p.fullres_master ?? null, deepzoom: p.deepzoom ?? null } };
        const $set = { display_photo: url, 'plate_whole.display': display };
        // Deep zoom: the whole image IS the master (on R2 already); the tiler reads fullres_master.url.
        if (mp >= DEEPZOOM_MIN_MP && !p.fullres_master) { $set.fullres_master = { url: whole, width: meta.width, height: meta.height, source_url: whole, harvested_at: at, by: `system:${SWEEP}`, issue: 8042 }; tally.fullres++; }
        console.log(`  p.${p.page_number} ${p.id}: ${meta.width}x${meta.height} (${mp.toFixed(1)} MP) → ${out.info.width}x${out.info.height} ${(out.data.length / 1024).toFixed(0)} KB${$set.fullres_master ? ' + fullres_master' : ''}`);
        log('sharpen.jsonl', { run: RUN, apply: APPLY, book: bookId, page_id: p.id, page_number: p.page_number, whole, master: { w: meta.width, h: meta.height }, display: { ...display, at: at.toISOString() }, fullres_master: !!$set.fullres_master });
        if (!APPLY) continue;
        await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: out.data, ContentType: 'image/jpeg', CacheControl: 'public, max-age=31536000, immutable' }));
        const head = await fetch(url, { method: 'HEAD' });
        if (!head.ok) throw new Error(`display copy not served after upload: ${head.status} ${url}`);
        await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'plate-sharpen', detail: { run: RUN, page_id: p.id, page_number: p.page_number, url, of: whole, before: display.before, fullres_master: !!$set.fullres_master } });
        await pages.updateOne({ id: p.id, book_id: bookId, 'plate_whole.run': RUN, cropped_photo: whole }, { $set });
        tally.written++;
      }
      if (APPLY && flag('revalidate')) console.log(`  revalidate ${bookId}: ${await revalidate(bookId)}`);
    }
    console.log(JSON.stringify({ run: RUN, apply: APPLY, ...tally }));
  } else {
    const plan = JSON.parse(fs.readFileSync(opt('plan'), 'utf8'));
    const skip = new Set(opt('skip-file') ? fs.readFileSync(opt('skip-file'), 'utf8').split(/\s+/).filter(Boolean) : []);
    const byBook = new Map();
    for (const e of plan) { if (!byBook.has(e.book)) byBook.set(e.book, []); byBook.get(e.book).push(e); }
    const summary = { run: RUN, apply: APPLY, books: 0, refused: 0, pairs: 0, skippedPairs: 0, needsRead: 0 };
    for (const [bookId, entries] of byBook) {
      const why = await bookRefusal(bookId, skip);
      if (why) { console.log(`REFUSE ${bookId}: ${why} (${entries.length} pair(s) listed, not touched)`); log('refused.jsonl', { book: bookId, why, entries }); summary.refused++; continue; }
      summary.books++;
      console.log(`${bookId}: ${entries.length} pair(s)`);
      for (const e of entries) {
        const ids = [e.keep, e.retire, e.frame].filter(Boolean);
        const docs = await pages.find({ book_id: bookId, id: { $in: ids } }, { projection: PROJ }).toArray();
        const get = (id) => docs.find((d) => d.id === id);
        const keep = get(e.keep), retire = get(e.retire), frame = e.frame ? get(e.frame) : null;
        const bad = !keep ? 'keep page missing' : !retire ? 'retire page missing' : e.kind === 'unsplit-frame' && !frame ? 'frame page missing'
          : keep.plate_whole || retire.plate_whole ? 'already restored (plate_whole set)' : keep.repeat_of || retire.repeat_of ? 'a page is already a repeat_of' : null;
        if (bad) { console.log(`  SKIP ${e.keep}/${e.retire}: ${bad}`); summary.skippedPairs++; continue; }

        let whole, geo = null;
        if (e.kind === 'join') { geo = await joinImages(bookId, shownImage(keep), shownImage(retire), keep.page_number); whole = geo.url; }
        else if (e.kind === 'unsplit-frame') whole = frame.archived_photo;
        else if (e.kind === 'unsplit-crop') whole = keep.archived_photo;
        else throw new Error(`unknown kind ${e.kind}`);
        if (!usable(whole)) { console.log(`  SKIP ${e.keep}: no usable whole image (${whole})`); summary.skippedPairs++; continue; }
        if (!whole.includes(bookId)) throw new Error(`whole image ${whole} is not scoped to book ${bookId}`);

        const at = new Date();
        const dets = remapDetections(e.kind, keep, retire, geo);
        const keepSet = { cropped_photo: whole, plate_whole: { run: RUN, at, by: `system:${SWEEP}`, issue: 8042, kind: e.kind, role: 'kept', pair: retire.id, frame: frame?.id || null, before: before(keep), note: e.note || null } };
        if (dets) keepSet.detected_images = dets;
        const retireSet = { repeat_of: keep.id, repeat_of_meta: { by: `system:${SWEEP}`, at, issue: 8042, method: `plate-${e.kind}`, run: RUN }, plate_whole: { run: RUN, at, by: `system:${SWEEP}`, issue: 8042, kind: e.kind, role: 'retired', pair: keep.id, frame: frame?.id || null, before: before(retire), note: e.note || null } };

        console.log(`  ${e.kind} p.${keep.page_number}+p.${retire.page_number}: keep ${keep.id} → ${whole}${geo ? ` (${geo.W}x${geo.H})` : ''}; retire ${retire.id} → repeat_of ${keep.id}`);
        log('actions.jsonl', { run: RUN, apply: APPLY, book: bookId, ...e, whole, geo, keep_before: before(keep), retire_before: before(retire) });
        for (const p of [keep, retire]) if (hasText(p)) { log('needs-read.jsonl', { book: bookId, page_id: p.id, page_number: p.page_number, role: p === keep ? 'kept' : 'retired', has_ocr: hasOcr(p), has_translation: hasTranslation(p) }); if (p === keep) summary.needsRead++; }
        const gal = await db.collection('gallery_images').find({ page_id: { $in: [keep.id, retire.id] } }, { projection: { _id: 0, id: 1, page_id: 1 } }).toArray();
        for (const g of gal) log('gallery.jsonl', { book: bookId, ...g, role: g.page_id === keep.id ? 'kept' : 'retired' });
        summary.pairs++;
        if (!APPLY) continue;
        await recordSweepAction(db, { sweep: SWEEP, book_id: bookId, action: 'plate-whole', detail: { run: RUN, kind: e.kind, keep: keep.id, retire: retire.id, frame: frame?.id || null, whole, keep_before: before(keep), retire_before: before(retire) } });
        await pages.updateOne({ id: keep.id, book_id: bookId, plate_whole: { $exists: false } }, { $set: keepSet });
        await pages.updateOne({ id: retire.id, book_id: bookId, plate_whole: { $exists: false }, repeat_of: null }, { $set: retireSet });
      }
      await afterBook(bookId);
    }
    console.log(JSON.stringify(summary));
    console.log(`out: ${OUT}`);
  }
} finally {
  await client.close();
}
