#!/usr/bin/env node
/**
 * The Chilam Balam of Calkiní — BYU, MSS 279 (William Gates papers), box 75
 * folder 1A; ContentDM p15999coll16 record 138175. A photostat negative of
 * volume 1 of Princeton's Garrett-Gates Mesoamerican Manuscript no. 5, made (per
 * BYU) by Sylvanus G. Morley.
 *
 * Unlike every other importer here, this one MAKES the page images. The source
 * frames each carry four manuscript pages, so there is nothing to point a page
 * row at: the pages have to be cut out, turned the right way up, inverted, and
 * stored as ours. `pages/{bookId}/…` on R2, written through
 * `validateR2Key`/`assertBookScopedKey` — a page key that does not carry its own
 * book id is the #3362 defect, and a derived-image importer is exactly where it
 * would come back.
 *
 * ## The sheet, and how the page order was established
 *
 * Each frame is a 2x2 of four manuscript pages on a black mount, the TOP ROW
 * ROTATED 180 degrees. Quartered, trimmed, rotated and inverted, they come out
 * as clean legible positives.
 *
 * The order is NOT the layout. It was read off the leaves themselves:
 *
 *  - Each COLUMN of a frame is one leaf, recto above verso after correction. The
 *    recto carries its number at the top RIGHT and the verso the same number at
 *    the top LEFT — standard foliation, and it holds on all twelve leaves here.
 *  - The left column runs TL (recto) then BL (verso). The right column runs the
 *    other way, BR (recto) then TR (verso), because the top row was laid head-down.
 *  - Confirmed by TEXT, not just by the numbers: frame 3's TL (59 recto) ends
 *    "…cate molah uba" and its BL (59 verso, numbered top-left) begins
 *    "Batabob…" — `molah uba batabob`, one phrase across the break. The same
 *    check on the Tizimín sheets splits the word `ubohal` across TL -> BL.
 *  - The frames are NOT in page order, and no rule would have got this right:
 *    frame 1 holds leaves 58 and 55, frame 3 holds 59 and 62, frame 4 holds 61
 *    and 60. Two frames alone would have supported a confident, wrong rule.
 *
 * The twelve leaves come out as 55-66, each exactly once, with no gaps and no
 * duplicates — and 12 leaves is 24 pages, which is precisely the "24 p." on
 * BYU's catalogue record. That agreement is the check on the whole reading: an
 * error anywhere in the table would show up as a repeated or missing leaf.
 *
 * Frame 7 is different and is handled as such: an unnumbered colophon sheet,
 * Spanish, signed and dated "noviembre de 1821", whose four panels are all
 * UPRIGHT — rotating its top row turns them upside down. Its internal order is
 * not established, and the book record says so.
 *
 * Frame 8 in the compound object is a 404 from ContentDM (pointer 138174). Seven
 * usable frames, not eight.
 *
 *   node --env-file=.env.production.local scripts/import/chilam-balam-calkini-byu.mjs [--dry-run]
 */
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { makeBookDoc, makePageDoc } from '../lib/book-docs.mjs';
import { validateR2Key, assertBookScopedKey } from '../lib/r2-key.mjs';

const DRY_RUN = process.argv.includes('--dry-run');
const COLLECTION = 'p15999coll16';
const RECORD = '138175';
const HOST = 'https://contentdm.lib.byu.edu';
const ITEM_URL = `${HOST}/digital/collection/${COLLECTION}/id/${RECORD}`;
const FINGERPRINT = `byu:${COLLECTION}/${RECORD}`;

/**
 * Which leaf sits in which column of which frame, read off the leaves.
 * `left`/`right` are the manuscript's own leaf numbers. `rotateTop: false` marks
 * the colophon sheet, whose panels are already upright.
 */
const FRAMES = [
  { frame: 1, left: 58, right: 55 },
  { frame: 2, left: 56, right: 57 },
  { frame: 3, left: 59, right: 62 },
  { frame: 4, left: 61, right: 60 },
  { frame: 5, left: 63, right: 66 },
  { frame: 6, left: 64, right: 65 },
  // NOT four-up. This sheet holds TWO FULL-WIDTH pages, one above the other,
  // upright. Quartering it cuts each page in half down the middle: the first
  // attempt produced four half-pages whose lines ended mid-word ("…Ah calkiniob
  // J" | "uan de Dios Yuc…"). The lesson is the one this whole importer is
  // about — the layout of a photostat sheet is not a property of the record, it
  // is a property of the sheet, and it has to be looked at.
  { frame: 7, colophon: true, layout: 'two-up' },
];

/** Panel positions within a frame. */
const PANEL = { TL: 0, BL: 1, TR: 2, BR: 3 };

const DISPLAY_WIDTH = 1200;
const THUMB_WIDTH = 150;

const api = (q) => `${HOST}/digital/bl/dmwebservices/index.php?q=${q}/json`;
async function j(u) {
  const r = await fetch(u, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`${r.status} ${u}`);
  return r.json();
}
function collectPages(node, out = []) {
  if (Array.isArray(node)) { for (const v of node) collectPages(v, out); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === 'page') { for (const p of (Array.isArray(v) ? v : [v])) out.push(p); }
      else collectPages(v, out);
    }
  }
  return out;
}

/**
 * Cut one negative frame into its pages, upright and tone-positive.
 *
 * `four-up` (the manuscript sheets): 2x2, top row laid head-down, so it is
 * rotated back. Returns TL, BL, TR, BR.
 * `two-up` (the colophon sheet): two full-width pages stacked, already upright.
 * Returns TOP, BOTTOM.
 */
async function splitFrame(buf, { layout = 'four-up' } = {}) {
  const m = await sharp(buf).metadata();
  const hw = Math.floor(m.width / 2);
  const hh = Math.floor(m.height / 2);
  const spec = layout === 'two-up'
    ? [{ left: 0, top: 0, width: m.width, height: hh, rotate: 0 },
       { left: 0, top: hh, width: m.width, height: hh, rotate: 0 }]
    : [{ left: 0, top: 0, width: hw, height: hh, rotate: 180 },
       { left: 0, top: hh, width: hw, height: hh, rotate: 0 },
       { left: hw, top: 0, width: hw, height: hh, rotate: 180 },
       { left: hw, top: hh, width: hw, height: hh, rotate: 0 }];
  const out = [];
  for (const q of spec) {
    let img = sharp(buf).extract({ left: q.left, top: q.top, width: q.width, height: q.height });
    // Trim BEFORE inverting, while the mount is still the uniform dark that
    // `trim` can find.
    img = sharp(await img.toBuffer()).trim({ threshold: 25 });
    if (q.rotate) img = img.rotate(q.rotate);
    out.push(await img.negate().jpeg({ quality: 92 }).toBuffer());
  }
  return out;
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});
const BUCKET = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const PUBLIC = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';

async function putWithRetry(key, body, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      await r2.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: body, ContentType: 'image/jpeg',
        CacheControl: 'public, max-age=31536000, immutable',
      }));
      return;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 2000 * i)); }
  }
  throw last;
}

async function put(key, body, bookId) {
  // Both guards, deliberately. `validateR2Key` catches an undefined segment;
  // `assertBookScopedKey` catches a key that is well-formed but not this book's
  // — which is the shape that fed 300 books each other's pages (#3362).
  validateR2Key(key, 'calkini-import');
  assertBookScopedKey(key, bookId, 'calkini-import');
  await putWithRetry(key, body);
  return `${PUBLIC}/${key}`;
}

// ── Build the ordered page list ────────────────────────────────────────
const frames = collectPages(await j(api(`dmGetCompoundObjectInfo/${COLLECTION}/${RECORD}`)))
  .map((p) => String(p.pageptr));
console.log(`compound object lists ${frames.length} frames`);

/** { leaf, side, frame, panel } for every page, then sorted into reading order. */
const plan = [];
for (const f of FRAMES) {
  if (f.colophon) continue;
  plan.push({ leaf: f.left, side: 'r', frame: f.frame, panel: PANEL.TL });
  plan.push({ leaf: f.left, side: 'v', frame: f.frame, panel: PANEL.BL });
  plan.push({ leaf: f.right, side: 'r', frame: f.frame, panel: PANEL.BR });
  plan.push({ leaf: f.right, side: 'v', frame: f.frame, panel: PANEL.TR });
}
plan.sort((a, b) => a.leaf - b.leaf || (a.side === 'r' ? -1 : 1) - (b.side === 'r' ? -1 : 1));

// The check that the reading is self-consistent: leaves must be a complete run,
// each with a recto and a verso. A misread number shows up here as a gap or a
// duplicate rather than as a quietly scrambled book.
const leaves = [...new Set(plan.map((p) => p.leaf))].sort((a, b) => a - b);
const expected = Array.from({ length: leaves[leaves.length - 1] - leaves[0] + 1 }, (_, i) => leaves[0] + i);
if (leaves.join(',') !== expected.join(',')) {
  console.error(`Leaves are not a complete run: ${leaves.join(',')}`);
  process.exit(1);
}
for (const l of leaves) {
  const sides = plan.filter((p) => p.leaf === l).map((p) => p.side).sort().join('');
  if (sides !== 'rv') { console.error(`Leaf ${l} has sides "${sides}", expected one recto and one verso`); process.exit(1); }
}
console.log(`${leaves.length} leaves ${leaves[0]}-${leaves[leaves.length - 1]}, complete, ${plan.length} pages`);

const colophon = FRAMES.find((f) => f.colophon);
if (colophon) {
  // Two pages, top then bottom. The top one is numbered 67 at its top right, so
  // it follows leaf 66 exactly as its number says; the bottom carries the end of
  // the 1821 signatures and the copyist's "Notas del copista".
  plan.push({ leaf: 67, side: 'r', frame: colophon.frame, panel: 0, colophon: true });
  plan.push({ leaf: 67, side: 'v', frame: colophon.frame, panel: 1, colophon: true });
  console.log(`+ 2 colophon pages from frame ${colophon.frame} (leaf 67, two-up sheet)`);
}

if (DRY_RUN) {
  plan.forEach((p, i) => console.log(`  page ${String(i + 1).padStart(3)}  ${p.colophon ? 'colophon' : `leaf ${p.leaf}${p.side}`}  <- frame ${p.frame} panel ${Object.keys(PANEL)[p.panel]}`));
  console.log(`Would create 1 book + ${plan.length} pages, and write ${plan.length * 3} objects to R2.`);
  process.exit(0);
}

// ── Insert ─────────────────────────────────────────────────────────────
const client = new MongoClient(process.env.MONGODB_URI, { maxPoolSize: 3 });
await client.connect();
const db = client.db('bookstore');

// Resume rather than refuse. The pages are inserted in one batch at the end, so
// a run that dies in the upload loop (ContentDM dropped a connection on the
// first attempt here) leaves a book with zero pages — and a plain
// already-imported check would then strand it forever, needing a hand delete.
const existing = await db.collection('books').findOne({ source_fingerprint: FINGERPRINT }, { projection: { id: 1 } });
let resumeBookId = null;
if (existing) {
  const have = await db.collection('pages').countDocuments({ book_id: existing.id });
  if (have > 0) { console.log(`Already imported as ${existing.id} with ${have} pages — nothing to do.`); await client.close(); process.exit(0); }
  console.log(`Resuming ${existing.id} — the book exists with no pages.`);
  resumeBookId = existing.id;
}

let slug = 'chilam-balam-de-calkini';
if (!resumeBookId) {
  for (let i = 2; await db.collection('books').findOne({ slug }, { projection: { id: 1 } }); i++) slug = `chilam-balam-de-calkini-${i}`;
}

const bookId = resumeBookId ? new ObjectId(resumeBookId) : new ObjectId();
const bookIdStr = bookId.toHexString();
const now = new Date();

const bookDoc = makeBookDoc({
  _id: bookId,
  id: bookIdStr,
  slug,
  title: 'Chilam Balam of Calkiní',
  display_title: 'Chilam Balam de Calkiní',
  author: 'Anonymous Yucatec Maya scribes',
  language: 'Yucatec Maya',
  original_language: 'Yucatec Maya',
  text_role: 'original',
  published: '1595-1821',
  categories: [],
  collections: ['maya', 'mesoamerican', 'americas'],
  pages_count: plan.length,
  pages_ocr: 0,
  pages_translated: 0,
  pages_archived: plan.length,
  needs_splitting: false,
  archive_status: 'archive_complete',
  archive_completed_at: now,
  dublin_core: {
    dc_identifier: [
      'BYU, L. Tom Perry Special Collections, MSS 279 (William Gates papers), Series 9 Subseries 11 Subseries 2, box 75 folder 1A',
      `ContentDM:${COLLECTION}/${RECORD}`,
      'Princeton University Library, Garrett-Gates Mesoamerican Manuscripts no. 5, vol. 1 (the original photostatted)',
    ],
    dc_source: ITEM_URL,
    dc_date: ['colonial manuscript; colophon dated 1821'],
  },
  image_source: {
    provider: 'byu',
    provider_name: 'Brigham Young University, L. Tom Perry Special Collections',
    source_url: ITEM_URL,
    identifier: `${COLLECTION}/${RECORD}`,
    // BYU states "Public Domain" in its own item metadata — a SOURCE claim.
    license: 'Public domain',
    license_url: 'http://lib.byu.edu/about/copyright/special_collections.php',
    contributing_library: 'Brigham Young University, Harold B. Lee Library (MSS 279, William Gates papers)',
    access_date: now,
  },
  page_count_source: 'derived_from_fourup_photostat',
  notes: [
    'One of the Books of Chilam Balam, the Yucatec Maya manuscript books in which Maya scribes kept prophecy, chronicle, ritual, medicine and the calendar in their own language and the Latin alphabet through the colonial period. The Calkiní book is largely a chronicle of the Canul lineage and the founding and boundaries of Calkiní.',
    'HOW THESE PAGE IMAGES WERE MADE: BYU holds this text as a photostat NEGATIVE in which each sheet carries four manuscript pages, the top row laid head-down. The pages here were cut from those sheets, turned upright, and tone-inverted; they are our derivations, not the source files, and the frame each came from is recorded on the page.',
    'PAGE ORDER was read from the manuscript\'s own foliation, not from the layout of the sheets, which does not follow the book: one sheet carries leaves 58 and 55, another 59 and 62. Each column of a sheet is one leaf, recto above verso, the recto numbered at the top right and the verso at the top left. Twelve leaves came out as 55-66 with no gaps and no duplicates, which is the 24 pages BYU\'s catalogue records; leaf 67 is the colophon sheet.',
    'The final sheet is leaf 67: the close of the Maya text with the signatures of the Calkini principals, dated "noviembre de 1821", followed by the copyist\'s own "Notas del copista". Unlike the others it is a TWO-up sheet, two full-width pages stacked upright rather than four quarters.',
    'Held in the William Gates papers, the collection assembled by the Maya scholar and publisher William E. Gates (1863-1940). BYU notes the photostat was probably made by Sylvanus G. Morley.',
  ].join(' '),
  status: 'draft',
  hidden: true,
  visible: false,
  source_fingerprint: FINGERPRINT,
  normalized_title: 'chilam balam of calkini',
  normalized_author: 'anonymous yucatec maya scribes',
  created_at: now,
  updated_at: now,
});
if (!resumeBookId) {
  await db.collection('books').insertOne(bookDoc);
  console.log(`Inserted book ${bookIdStr} slug=${slug}`);
}

// Cache each frame once — every frame supplies four pages.
const frameCache = new Map();
/** Retry a flaky call. ContentDM drops the connection mid-body on full-res
 *  frames often enough that one attempt is not a strategy. */
async function withRetry(label, fn, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      console.log(`\n  ${label} attempt ${i}/${attempts} failed: ${e.name}: ${String(e.message).slice(0, 90)}`);
      if (i < attempts) await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw last;
}

async function frameBuffer(n) {
  if (!frameCache.has(n)) {
    const ptr = frames[n - 1];
    const buf = await withRetry(`frame ${n}`, async () => {
      const res = await fetch(`${HOST}/digital/iiif/${COLLECTION}/${ptr}/full/full/0/default.jpg`, { signal: AbortSignal.timeout(120000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const b = Buffer.from(await res.arrayBuffer());
      // A truncated body decodes as a broken JPEG later, a long way from here.
      await sharp(b).metadata();
      return b;
    });
    frameCache.set(n, buf);
  }
  return frameCache.get(n);
}
const panelCache = new Map();
async function panels(n, layout) {
  if (!panelCache.has(n)) panelCache.set(n, await splitFrame(await frameBuffer(n), { layout }));
  return panelCache.get(n);
}

const pageDocs = [];
for (const [i, p] of plan.entries()) {
  const pageNumber = i + 1;
  const spec = FRAMES.find((f) => f.frame === p.frame);
  const full = (await panels(p.frame, spec.layout || 'four-up'))[p.panel];
  const num = String(pageNumber).padStart(4, '0');
  const keys = {
    full: `pages/${bookIdStr}/${num}-full.jpg`,
    display: `pages/${bookIdStr}/${num}.jpg`,
    thumb: `pages/${bookIdStr}/${num}-thumb.jpg`,
  };
  const [fullUrl, displayUrl, thumbUrl] = await Promise.all([
    put(keys.full, full, bookIdStr),
    put(keys.display, await sharp(full).resize({ width: DISPLAY_WIDTH, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer(), bookIdStr),
    put(keys.thumb, await sharp(full).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(), bookIdStr),
  ]);
  const meta = await sharp(full).metadata();
  const pid = new ObjectId();
  pageDocs.push(makePageDoc({
    _id: pid,
    id: pid.toHexString(),
    book_id: bookIdStr,
    page_number: pageNumber,
    photo: fullUrl,
    archived_photo: fullUrl,
    display_photo: displayUrl,
    image_thumb: thumbUrl,
    thumbnail_blob: thumbUrl,
    thumbnail: thumbUrl,
    // Provenance of a DERIVED image: which source frame and which quarter of it.
    // Without this the page cannot be checked against the sheet it came from.
    photo_original: `${HOST}/digital/iiif/${COLLECTION}/${frames[p.frame - 1]}/full/full/0/default.jpg`,
    archive_metadata: {
      derived: 'fourup-photostat-split',
      source_frame: p.frame,
      source_panel: spec.layout === 'two-up' ? ['TOP', 'BOTTOM'][p.panel] : Object.keys(PANEL)[p.panel],
      source_layout: spec.layout || 'four-up',
      rotated_180: (spec.layout || 'four-up') === 'four-up' && (p.panel === PANEL.TL || p.panel === PANEL.TR),
      tone_inverted: true,
      manuscript_leaf: p.colophon ? null : `${p.leaf}${p.side}`,
    },
    image_width: meta.width,
    image_height: meta.height,
    created_at: now,
    updated_at: now,
  }));
  process.stdout.write(`\r  page ${pageNumber}/${plan.length} (${p.colophon ? 'colophon' : `leaf ${p.leaf}${p.side}`})   `);
}
process.stdout.write('\n');

const r = await db.collection('pages').insertMany(pageDocs, { ordered: false });
console.log(`Inserted ${r.insertedCount} pages. https://sourcelibrary.org/book/${bookIdStr}`);
console.log('Hidden and un-OCR\'d. QA the page order against the leaf numbers in archive_metadata before making it visible.');
await client.close();
