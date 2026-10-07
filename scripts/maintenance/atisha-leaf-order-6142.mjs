#!/usr/bin/env node
/**
 * atisha-leaf-order-6142.mjs — one page per leaf side, in folio order, for the BL EAP039
 * Atiśa biography (Jo bo rje'i rnam thar, 69e77a1f0fc6fc955e35dde9). Issue #6142.
 *
 * PRIOR ART: scripts/split-pecha.mjs — the geometry-B (vertically stacked pecha) splitter. Its
 * child-page shape and soft-hide of the parent are reused here, but it does not fit as-is: it
 * finds leaves with a Gemini bbox call (we already hold the exact cut the OCR was read from), it
 * orders children by parent slot (this board alternates rectos/versos across TWO photos, so folio
 * order interleaves pairs of photos), it carries no text across (the Yigdzin OCR and the Flash
 * English both carry a `<leaf-break/>` and split cleanly), and it writes `lf<id>` keys that the
 * page-image resolver cannot match to a variant. scripts/split-book-v2.mjs supplies the
 * `split_from_spread` + `pages/<book>/sp<id>.jpg` shape the resolver already serves.
 *
 * THE BOARD (verified by script + eye, #6142): photo 2k−1 holds the rectos of folios 2k−1 (top)
 * and 2k (bottom); photo 2k holds their versos in the same positions, k = 1…63. Photos 127/128
 * hold one leaf (folio 127 r/v) and are only renumbered. Reading order per pair:
 *   (2k−1 top) → (2k top) → (2k−1 bottom) → (2k bottom).
 *
 * THE CUT: on photos read by Yigdzin, the leaf run's own span (`leaf-run-logs/pages.jsonl`), so
 * the image is cut exactly where the transcription was read; elsewhere the middle of the dark band
 * between the leaves (measured, `--gaps`). Both are passed in as JSON so this script does no
 * detection of its own.
 *
 * TEXT: Yigdzin photos → OCR and English split at their single `<leaf-break/>`. Gemini-only photos
 * are already `ocr.unreadable` (invented reads, p1/p41 among them) → children get NO text and stay
 * `ocr.unreadable`. The parent keeps everything and is soft-hidden (page_number −n, split_into).
 *
 * Nothing is deleted. Before the first write: a JSON snapshot of the book's pages + book doc, a
 * page_revisions copy of every parent's ocr + translation (reason 'spread_split'), and a sweep_log
 * row carrying the folio map. `--revert` puts the parents back and moves the children to negative
 * page numbers (it does not delete them).
 *
 * Usage (Hetzner; book stays HELD — this script refuses a book that is not):
 *   node --env-file=/root/sourcelibrary/.env.production.local scripts/maintenance/atisha-leaf-order-6142.mjs \
 *     --leafrun=/root/atisha-6142/leafrun-pages.jsonl --gaps=/root/atisha-6142/gaps.json \
 *     --photos=27-32 [--execute]          # pilot (dry run without --execute)
 *     --photos=all --chapters [--execute] # the rest; --chapters backs up + unsets books.chapters
 *     --revert --execute                  # undo
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { saveRevisionsBeforeOverwrite } from '../lib/page-revisions.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { recountBook } from '../lib/page-counts.mjs';
import { contentHash } from '../lib/write-provenance.mjs';

const BOOK_ID = '69e77a1f0fc6fc955e35dde9';
const SWEEP = 'atisha-leaf-order-6142';
const ISSUE = 6142;
const PAIRS = 63;                 // photos 1..126 are 63 recto/verso pairs
const SINGLE_LEAF = [127, 128];   // folio 127 recto / verso
const LEAF_BREAK = /<leaf-break\s*\/?>/i;
// Leaves carrying a drawing (opened by eye, #6142): photo → leaf index.
const ILLUSTRATION_LEAVES = { 63: [1], 64: [0], 93: [0] };

const args = process.argv.slice(2);
const arg = (n, d = null) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=') ?? d;
const EXECUTE = args.includes('--execute');
const REVERT = args.includes('--revert');
const CHAPTERS = args.includes('--chapters');
const OUT = arg('out', '/root/atisha-6142');
const RUN = `${SWEEP}/${new Date().toISOString().slice(0, 19)}`;

function parsePhotos(s) {
  if (!s) return [];
  if (s === 'all') return Array.from({ length: PAIRS * 2 }, (_, i) => i + 1);
  const [a, b] = s.split('-').map(Number);
  const out = [];
  for (let n = a; n <= (b || a); n++) out.push(n);
  return out;
}

const pairOf = (n) => Math.ceil(n / 2);                       // pair k holds photos 2k−1, 2k
const folioOf = (n, leaf) => 2 * pairOf(n) - 1 + leaf;         // top leaf = odd folio
const sideOf = (n) => (n % 2 === 1 ? 'a' : 'b');               // odd photo = rectos

// ── R2 ──
const r2 = new S3Client({
  region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});
const R2_BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
async function put(key, buf) {
  assertBookScopedKey(key, BOOK_ID, SWEEP);
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, Body: buf, ContentType: 'image/jpeg', CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC}/${key}`;
}
async function download(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch {}
    await new Promise(z => setTimeout(z, 1000 * (t + 1)));
  }
  throw new Error(`download failed: ${url}`);
}

/** Where to cut photo n, in pixels of the archived image, and why. */
function cutFor(n, page, H, leafrun, gaps) {
  const lr = leafrun[n];
  if (page.ocr?.model === 'bdrc-yigdzin-v1') {
    if (!lr || lr.nb !== 2) throw new Error(`p${n}: Yigdzin page without a two-leaf span`);
    if (lr.w !== page.image_width || lr.h !== page.image_height) throw new Error(`p${n}: leaf-run image ${lr.w}x${lr.h} ≠ page ${page.image_width}x${page.image_height}`);
    const cut = Math.round(lr.spans[0][1] * H);
    const g = gaps[n].gap;
    if (cut < g[0] - 8 || cut > g[1] + 8) throw new Error(`p${n}: leaf-run cut ${cut} outside measured gap ${g}`);
    return { cut, method: 'leaf-run-span' };
  }
  return { cut: gaps[n].mid, method: 'gap-mid' };
}

/** Split one stored text at its single leaf-break; null when it has not exactly one. */
function splitLeaves(text) {
  const parts = (text || '').split(LEAF_BREAK);
  return parts.length === 2 ? parts.map(s => s.trim()) : null;
}

async function buildChildren(n, page, buf, leafrun, gaps, now) {
  const meta = await sharp(buf).metadata();
  const W = meta.width, H = meta.height;
  if (W !== page.image_width || H !== page.image_height) throw new Error(`p${n}: downloaded ${W}x${H} ≠ stored ${page.image_width}x${page.image_height}`);
  const { cut, method } = cutFor(n, page, H, leafrun, gaps);
  const yig = page.ocr?.model === 'bdrc-yigdzin-v1';
  const ocrLeaves = yig ? splitLeaves(page.ocr.data) : null;
  const trLeaves = yig && page.translation?.data ? splitLeaves(page.translation.data) : null;
  if (yig && !ocrLeaves) throw new Error(`p${n}: Yigdzin OCR without exactly one leaf-break`);
  if (yig && page.translation?.data && !trLeaves) throw new Error(`p${n}: translation without exactly one leaf-break`);
  if (!yig && page.ocr?.unreadable !== true) throw new Error(`p${n}: non-Yigdzin page is not marked unreadable — refusing to guess`);

  const children = [];
  for (const leaf of [0, 1]) {
    const top = leaf === 0 ? 0 : cut, height = leaf === 0 ? cut : H - cut;
    const leafBuf = await sharp(buf).extract({ left: 0, top, width: W, height }).jpeg({ quality: 92, progressive: true }).toBuffer();
    const thumbBuf = await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer();
    const id = new ObjectId().toHexString();
    const folio = folioOf(n, leaf), side = sideOf(n);
    const keys = { full: `cropped/${BOOK_ID}/${id}.jpg`, display: `pages/${BOOK_ID}/sp${id}.jpg`, thumb: `pages/${BOOK_ID}/sp${id}-thumb.jpg` };
    for (const k of Object.values(keys)) assertBookScopedKey(k, BOOK_ID, `p${n} leaf ${leaf}`);
    const leafSplit = { from_page: page.id, from_photo: n, leaf, cut_px: cut, method, run: RUN, issue: ISSUE };

    let ocr, translation;
    if (yig) {
      const data = ocrLeaves[leaf];
      const { leaf_seams, ...engine } = page.ocr.engine || {};
      ocr = { ...page.ocr, data, content_hash: contentHash(data), engine, leaf_split: leafSplit };
      if (trLeaves) {
        const tdata = trLeaves[leaf];
        translation = { ...page.translation, data: tdata, content_hash: contentHash(tdata), leaf_split: leafSplit };
      }
    } else {
      // The parent's read is invented; the child carries the verdict, never the text.
      ocr = { unreadable: true, unreadable_reason: page.ocr.unreadable_reason, verdict: page.ocr.verdict, language: page.ocr.language, leaf_split: leafSplit };
    }
    const illus = (ILLUSTRATION_LEAVES[n] || []).includes(leaf);
    children.push({
      leafBuf, thumbBuf, keys,
      doc: {
        _id: new ObjectId(id), id, book_id: BOOK_ID,
        ...(page.tenantId ? { tenantId: page.tenantId } : {}),
        page_number: 0, // assigned by the renumber pass
        photo: `${R2_PUBLIC}/${keys.display}`, display_photo: `${R2_PUBLIC}/${keys.display}`,
        archived_photo: `${R2_PUBLIC}/${keys.full}`, image_thumb: `${R2_PUBLIC}/${keys.thumb}`, thumbnail: `${R2_PUBLIC}/${keys.thumb}`,
        photo_original: page.archived_photo || page.photo_original || page.photo,
        image_width: W, image_height: height,
        split_from_spread: page.id, split_side: leaf === 0 ? 'top' : 'bottom', split_position: cut, split_method: method,
        printed_page: { label: `${folio}${side}`, numbering: 'folio', rate: 0.5, method: 'interpolated' },
        page_type: illus ? 'illustration' : 'text',
        ...(page.script_type ? { script_type: page.script_type } : {}),
        ocr, ...(translation ? { translation } : {}),
        field_provenance: { photo: { source: 'r2', method: `${SWEEP}:${method}`, date: now } },
        created_at: now, updated_at: now,
      },
    });
  }
  return children;
}

/** Final order: unsplit photos keep their slot; a split pair expands to folio order. */
function orderBook(pages) {
  const parents = pages.filter(p => p.page_number > 0 && !p.split_from_spread || (p.page_number < 0 && p.split_into));
  const children = pages.filter(p => p.split_from_spread && p.ocr?.leaf_split);
  const units = [];
  // Keyed by PHOTO, never by page_number: an earlier run has already shifted the numbers.
  for (const p of parents) if (!p.split_into) units.push({ key: p._photo, page: p });
  for (const c of children) {
    const { from_photo: n, leaf } = c.ocr.leaf_split;
    if (c.page_number < 0 && !c._new) continue; // reverted children stay out
    // pair k: (2k−1 top) (2k top) (2k−1 bottom) (2k bottom)
    const k = pairOf(n), slot = leaf * 2 + (n % 2 === 1 ? 0 : 1);
    units.push({ key: 2 * k - 1 + slot * 0.1, page: c });
  }
  units.sort((a, b) => a.key - b.key);
  return units.map((u, i) => ({ page: u.page, page_number: i + 1 }));
}

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 5 });
  await client.connect();
  const db = client.db('bookstore');
  const Pages = db.collection('pages'), Books = db.collection('books');
  const book = await Books.findOne({ id: BOOK_ID });
  if (!book) throw new Error('book not found');
  if (book.pipeline_auto?.status !== 'held') throw new Error(`book is not held (${book.pipeline_auto?.status}) — refusing`);
  const pages = await Pages.find({ book_id: BOOK_ID }).toArray();
  console.log(`${SWEEP} — ${EXECUTE ? 'EXECUTE' : 'DRY RUN'} — ${pages.length} page records`);

  if (REVERT) {
    const parents = pages.filter(p => p.page_number < 0 && p.split_into);
    const kids = pages.filter(p => p.split_from_spread && p.ocr?.leaf_split && p.page_number > 0);
    console.log(`  revert: ${parents.length} parents back to +n, ${kids.length} children to −n`);
    if (EXECUTE) {
      const ops = [
        ...parents.map(p => ({ updateOne: { filter: { _id: p._id }, update: { $set: { page_number: -p.page_number, updated_at: new Date() }, $unset: { split_into: '' } } } })),
        ...kids.map((c, i) => ({ updateOne: { filter: { _id: c._id }, update: { $set: { page_number: -(10000 + i), updated_at: new Date() } } } })),
      ];
      // Unsplit photos: their number IS their photo number again.
      for (const p of pages.filter(p => p.page_number > 0 && !p.split_from_spread)) {
        const n = Number(p.photo_original?.match(/\/(\d+)\.jp2\//)?.[1]);
        if (n && n !== p.page_number) ops.push({ updateOne: { filter: { _id: p._id }, update: { $set: { page_number: n, updated_at: new Date() } } } });
      }
      if (ops.length) await Pages.bulkWrite(ops, { ordered: true });
      await recordSweepAction(db, { sweep: SWEEP, book_id: BOOK_ID, action: 'reverted', detail: { run: RUN, parents: parents.length, children: kids.length } });
      console.log('  recount:', JSON.stringify((await recountBook(db, BOOK_ID, { reason: SWEEP })).after));
    }
    await client.close();
    return;
  }

  const leafrun = Object.fromEntries(fs.readFileSync(arg('leafrun'), 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [Number(r.id.slice(-5)), r]));
  const gaps = JSON.parse(fs.readFileSync(arg('gaps'), 'utf8'));
  const want = parsePhotos(arg('photos'));
  for (const n of want) if (!want.includes(n % 2 ? n + 1 : n - 1)) throw new Error(`photo ${n} selected without its pair`);

  // A photo is identified by its IIIF filename, never by page_number (which this script rewrites).
  const photoOf = (p) => Number((p.photo_original || '').match(/EAP039_1_4_162\/(\d+)\.jp2\//)?.[1]);
  for (const p of pages) p._photo = photoOf(p);
  const unsplit = new Map(pages.filter(p => p.page_number > 0 && !p.split_from_spread).map(p => [p._photo, p]));
  if (pages.filter(p => !p.split_from_spread).some(p => !p._photo)) throw new Error('a parent page has no photo number in photo_original');
  const todo = want.filter(n => unsplit.has(n));
  console.log(`  photos requested ${want.length}, still to split ${todo.length}`);

  // Folio map (whole book, deterministic).
  const map = [];
  for (let n = 1; n <= PAIRS * 2; n++) for (const leaf of [0, 1]) map.push({ photo: n, position: leaf ? 'bottom' : 'top', folio: folioOf(n, leaf), side: sideOf(n) === 'a' ? 'recto' : 'verso' });
  for (const n of SINGLE_LEAF) map.push({ photo: n, position: 'whole', folio: 127, side: n === 127 ? 'recto' : 'verso' });
  fs.writeFileSync(`${OUT}/folio-map.json`, JSON.stringify(map, null, 1));

  const now = new Date();
  const built = [];
  for (const n of todo) {
    const page = unsplit.get(n);
    const buf = await download(page.archived_photo);
    const kids = await buildChildren(n, page, buf, leafrun, gaps, now);
    built.push({ n, page, kids });
    console.log(`  p${n} → ${kids.map(k => `${k.doc.printed_page.label}[${k.doc.split_side} ${k.doc.image_height}px ${k.doc.ocr.data ? k.doc.ocr.data.length + 'c' : 'unreadable'}${k.doc.translation ? ' tr' + k.doc.translation.data.length : ''}]`).join(' ')} (${kids[0].doc.split_method} @${kids[0].doc.split_position})`);
    if (!EXECUTE) for (const k of kids) fs.writeFileSync(`${OUT}/dry-${k.doc.printed_page.label}.jpg`, k.leafBuf);
  }

  // Order preview over the whole book as it will stand after this run.
  const futureChildren = built.flatMap(b => b.kids.map(k => ({ ...k.doc, _new: true })));
  const futureParents = pages.map(p => (built.some(b => b.page.id === p.id) ? { ...p, page_number: -p._photo, split_into: [] } : p));
  const order = orderBook([...futureParents, ...futureChildren]);
  const label = (p) => p.printed_page?.label || `photo${p._photo ?? '?'}`;
  console.log(`  book after this run: ${order.length} pages. First 12: ${order.slice(0, 12).map(o => `${o.page_number}=${label(o.page)}`).join(' ')}`);
  const pilotSpan = order.filter(o => o.page.ocr?.leaf_split);
  if (pilotSpan.length) console.log(`  split leaves: ${pilotSpan.slice(0, 16).map(o => `${o.page_number}=${label(o.page)}`).join(' ')}${pilotSpan.length > 16 ? ' …' : ''}`);

  // Gallery rows on the photos being split: move to the leaf holding the bbox, bbox renormalised.
  const gallery = await db.collection('gallery_images').find({ book_id: BOOK_ID, page_id: { $in: built.map(b => b.page.id) } }).toArray();
  const galleryOps = [];
  for (const g of gallery) {
    const b = built.find(x => x.page.id === g.page_id);
    const H = b.page.image_height, cut = b.kids[0].doc.split_position;
    const y0 = g.bbox.y * H, y1 = (g.bbox.y + g.bbox.height) * H;
    const leaf = y1 <= cut + 6 ? 0 : y0 >= cut - 6 ? 1 : null;
    if (leaf == null) { console.log(`  gallery ${g.id}: bbox straddles the cut — left on the parent`); continue; }
    const kid = b.kids[leaf].doc, top = leaf ? cut : 0, lh = kid.image_height;
    const ny0 = Math.max(0, (y0 - top) / lh), ny1 = Math.min(1, (y1 - top) / lh);
    galleryOps.push({ g, kid, set: { page_id: kid.id, bbox: { ...g.bbox, y: +ny0.toFixed(4), height: +(ny1 - ny0).toFixed(4) }, image_url: kid.archived_photo } });
    console.log(`  gallery ${g.id}: photo ${b.n} → ${kid.printed_page.label}`);
  }

  if (!EXECUTE) { console.log('\nDRY RUN — nothing written. Crops in', OUT); await client.close(); return; }

  // ── 1. snapshots ──
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  fs.writeFileSync(`${OUT}/snapshot-pages-${stamp}.json`, JSON.stringify(pages));
  fs.writeFileSync(`${OUT}/snapshot-book-${stamp}.json`, JSON.stringify(book));
  fs.writeFileSync(`${OUT}/snapshot-gallery-${stamp}.json`, JSON.stringify(gallery));
  const parentIds = built.map(b => b.page.id);
  const nOcr = await saveRevisionsBeforeOverwrite(db, parentIds, 'ocr', { reason: 'spread_split', jobId: RUN, keepMeta: true });
  const nTr = await saveRevisionsBeforeOverwrite(db, parentIds, 'translation', { reason: 'spread_split', jobId: RUN, keepMeta: true });
  console.log(`  snapshots: ${OUT}/snapshot-*-${stamp}.json; page_revisions ocr=${nOcr} translation=${nTr}`);

  // ── 2. images ──
  for (const b of built) for (const k of b.kids) {
    await put(k.keys.full, k.leafBuf);
    await put(k.keys.display, k.leafBuf); // 1536 px wide: the full crop IS the display image
    await put(k.keys.thumb, k.thumbBuf);
  }

  // ── 3. pages: insert children, soft-hide parents, renumber the book ──
  const ops = [];
  for (const b of built) {
    for (const k of b.kids) ops.push({ insertOne: { document: k.doc } });
    ops.push({ updateOne: { filter: { _id: b.page._id }, update: { $set: { page_number: -b.n, split_into: b.kids.map(k => k.doc.id), updated_at: now } } } });
  }
  for (const o of order) {
    if (o.page._new) { ops.find(x => x.insertOne?.document.id === o.page.id).insertOne.document.page_number = o.page_number; continue; }
    if (o.page.page_number !== o.page_number) ops.push({ updateOne: { filter: { _id: o.page._id }, update: { $set: { page_number: o.page_number, updated_at: now } } } });
  }
  const res = await Pages.bulkWrite(ops, { ordered: true });
  console.log(`  pages: inserted ${res.insertedCount}, modified ${res.modifiedCount}`);

  // ── 4. gallery rows ──
  for (const { g, set } of galleryOps) await db.collection('gallery_images').updateOne({ _id: g._id }, { $set: { ...set, page_number: (await Pages.findOne({ id: set.page_id }, { projection: { page_number: 1 } })).page_number, updated_at: now } });

  // ── 5. chapters (derived from the pre-Yigdzin reads; none of their titles occurs in the served text) ──
  let chaptersCleared = null;
  if (CHAPTERS && Array.isArray(book.chapters) && book.chapters.length) {
    chaptersCleared = book.chapters;
    await Books.updateOne({ id: BOOK_ID }, { $unset: { chapters: '' }, $set: { updated_at: now } });
    console.log(`  chapters: ${chaptersCleared.length} unset (copy in sweep_log + snapshot-book)`);
  }

  // ── 6. counters + log ──
  const rc = await recountBook(db, BOOK_ID, { reason: SWEEP });
  console.log('  recount:', JSON.stringify(rc.after), 'changed', rc.changed.join(','));
  await recordSweepAction(db, {
    sweep: SWEEP, book_id: BOOK_ID, action: 'split-two-leaf-photos',
    detail: {
      run: RUN, issue: ISSUE, photos: built.map(b => b.n),
      children: built.flatMap(b => b.kids.map(k => ({ id: k.doc.id, folio: k.doc.printed_page.label, from_page: b.page.id }))),
      gallery_moved: galleryOps.map(x => ({ id: x.g.id, from: x.g.page_id, to: x.kid.id, old_bbox: x.g.bbox })),
      ...(chaptersCleared ? { chapters_unset: chaptersCleared } : {}),
      snapshot: `${OUT}/snapshot-pages-${stamp}.json`, folio_map: map,
    },
  });
  await client.close();
}

main().catch(e => { console.error(e); process.exit(1); });
