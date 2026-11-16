#!/usr/bin/env node
/**
 * split-pecha.mjs — split vertically-stacked multi-leaf Tibetan/Bhutanese pecha
 * composites into single leaves (geometry B; see .claude/docs/multi-leaf-scan-splitting.md).
 *
 * Pipeline per composite page:
 *   1. flash bounding-box → N leaf regions (Gemini 3.8 Flash low through the agy CLI, on the subscription:
 *      the paid API allows flash-lite only since 2026-10-08; tested 80/80 leaf counts, #5771)
 *   2. deterministic gap-snap → cut at the true row-brightness minimum in each inter-leaf zone
 *   3. validate → 1..3 non-overlapping leaves of plausible height covering the content
 *      (N==1 = single leaf, kept as-is; no split)
 *   4. crop each leaf full-res (sharp) → upload to R2 (same key scheme as split-book-v2)
 *   5. child page records (split_from_pecha: <parentId>, leaf_index) ; archive original (negative page_number)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/split-pecha.mjs <bookId|slug> --dry-run [--pages=1-20] [--out=DIR]
 *        detect + report, no writes. Writes DIR/<bookId>-plan.json (every cut) and DIR/<bookId>-sheet-NN.jpg
 *        contact sheets (each frame with its cuts drawn) so the cuts can be checked by eye.
 *   node scripts/split-pecha.mjs <bookId|slug> --plan=DIR/<bookId>-plan.json
 *        apply EXACTLY the reviewed cuts in that plan (no re-detection). Applying without a plan is refused:
 *        what gets written must be what was looked at.
 *   node scripts/split-pecha.mjs --all --limit=5 --dry-run   # batch dry-run over needs_splitting pecha books
 *
 * SAFETY: dry-run writes nothing to Mongo or R2. Apply archives each parent (negative page_number,
 * split_into) and never deletes. Aborts a book if >20% of pages fail detection.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { markDisplay } from './workers/lib/display-image.mjs';
import { withdrawPageVectors } from './lib/withdraw-page-vectors.mjs';
import { gatedImageCall, firstJson } from './lib/agy-cli.mjs';
import { assertBookScopedKey } from './lib/r2-key.mjs';

const args = process.argv.slice(2);
const arg = (n) => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const LIMIT = parseInt(arg('limit') || '1', 10);
const BOOK_ARG = args.find(a => !a.startsWith('--'));
const PLAN = arg('plan');
const OUT_DIR = arg('out') || 'scripts/output/split-pecha';
const PAGES = arg('pages') ? arg('pages').split('-').map(Number) : null; // inclusive page_number range
if (!DRY_RUN && !PLAN) { console.error('Refusing to apply without --plan=<reviewed plan.json>. Run --dry-run first and check the sheets.'); process.exit(1); }
if (!DRY_RUN && ALL) { console.error('--all is dry-run only; apply one book at a time with its reviewed --plan.'); process.exit(1); }
const BBOX_MODEL = 'gemini-3.8-flash-low';
const FAILURE_ABORT_PCT = 0.2;
const MIN_LEAF_FRAC = 0.12;   // a leaf must be ≥12% of image height (reject slivers)

const MONGODB_URI = process.env.MONGODB_URI;
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'sourcelibrary-images';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://images.sourcelibrary.org';
if (!MONGODB_URI) { console.error('Missing MONGODB_URI'); process.exit(1); }
if (!R2_ACCOUNT_ID && !DRY_RUN) { console.error('Missing R2_ACCOUNT_ID'); process.exit(1); }

const r2 = R2_ACCOUNT_ID ? new S3Client({
  region: 'auto', endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
}) : null;
async function uploadToR2(key, buf, bookId, ct = 'image/jpeg') {
  assertBookScopedKey(key, bookId, 'split-pecha');
  // Network blips (a DNS miss stopped the first apply mid-book) get a slower retry than the SDK's own.
  for (let t = 1; t < 5; t++) {
    try { return await putOnce(key, buf, ct); } catch (e) { console.log(`  R2 retry ${t}: ${e.code || e.message}`); await new Promise(z => setTimeout(z, 5000 * t)); }
  }
  return putOnce(key, buf, ct);
}
async function putOnce(key, buf, ct) {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: buf, ContentType: ct, CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC_URL}/${key}`;
}

async function download(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(25000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch {}
    await new Promise(z => setTimeout(z, 800 * (t + 1)));
  }
  throw new Error('download failed');
}

// --- 1. flash bounding boxes (one per leaf, normalized 0-1000, top→bottom) ---
const BBOX_PROMPT = (f) => `This image shows one or more loose Tibetan manuscript leaves (pecha folios) — wide horizontal strips — photographed stacked vertically on a board/background: @./${f}
Return ONLY a JSON array of bounding boxes, one per DISTINCT physical leaf (not the background, not the whole plate, not individual lines of text). Each box: {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000, top to bottom order. Do not use any tool other than viewing the attached image.`;
async function detectLeaves(buf) {
  // The CLI reads a ≤2000px copy; boxes are normalized, so they apply to the full-resolution image unchanged.
  const small = await sharp(buf).resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88 }).toBuffer();
  const r = await gatedImageCall(BBOX_PROMPT, small, { model: BBOX_MODEL });
  if (r.cls === 'quota') { console.error(`agy quota: ${r.err || r.text}`.slice(0, 200)); process.exit(75); }
  if (r.cls) throw new Error(`agy ${r.cls}`);
  const boxes = (firstJson(r.text, '[') || []).map(b => b.box_2d).filter(b => Array.isArray(b) && b.length === 4);
  return boxes.sort((a, b) => a[0] - b[0]); // top→bottom by ymin
}

// --- 2. row-brightness profile (downsampled) for gap-snapping ---
async function rowBrightness(buf, H) {
  const W = 64;
  const { data, info } = await sharp(buf).resize({ width: W, height: H, fit: 'fill' }).grayscale().raw().toBuffer({ resolveWithObject: true });
  const rows = new Array(info.height).fill(0);
  for (let y = 0; y < info.height; y++) { let s = 0; for (let x = 0; x < info.width; x++) s += data[y * info.width + x]; rows[y] = s / info.width; }
  return rows; // index = row (0..H-1), value = mean brightness
}
// darkest row in [a,b] (the true inter-leaf gap)
function darkestRow(rows, a, b) { a = Math.max(0, a); b = Math.min(rows.length - 1, b); let mi = a, mv = Infinity; for (let y = a; y <= b; y++) if (rows[y] < mv) { mv = rows[y]; mi = y; } return mi; }

// --- 3+4. detect → snap → validate → crop ---
async function splitComposite(buf) {
  const meta = await sharp(buf).metadata();
  const H = meta.height, W = meta.width;
  const boxes = await detectLeaves(buf);
  if (boxes.length <= 1) return { leaves: [], reason: boxes.length === 1 ? 'single-leaf' : 'no-leaves' };

  const rows = await rowBrightness(buf, Math.min(H, 800));
  const scale = rows.length / H; // downsample factor
  const toPx = v => Math.round((v / 1000) * H);

  // cut points between adjacent leaves = darkest row in the inter-box zone
  const cuts = [];
  for (let i = 0; i < boxes.length - 1; i++) {
    const lo = toPx(boxes[i][2]) - Math.round(0.02 * H);
    const hi = toPx(boxes[i + 1][0]) + Math.round(0.02 * H);
    const dr = darkestRow(rows, Math.round(lo * scale), Math.round(hi * scale));
    cuts.push(Math.round(dr / scale));
  }
  // leaf y-bounds: outer edges from boxes (snapped to content), inner from cuts
  const bounds = [];
  for (let i = 0; i < boxes.length; i++) {
    // Outer edges get a 1.5% margin: the model's boxes can sit tight on the leaf edge, and a margin of
    // background costs nothing while a clipped first or last line costs text.
    const top = i === 0 ? toPx(boxes[0][0]) - Math.round(0.015 * H) : cuts[i - 1];
    const bot = i === boxes.length - 1 ? toPx(boxes[boxes.length - 1][2]) + Math.round(0.015 * H) : cuts[i];
    bounds.push([Math.max(0, top), Math.min(H, bot)]);
  }
  // x-range: union of box x (trim dark side borders), clamped
  const x0 = Math.max(0, Math.min(...boxes.map(b => toPx(b[1]) * (W / H) >= 0 ? Math.round((b[1] / 1000) * W) : 0)));
  const x1 = Math.min(W, Math.max(...boxes.map(b => Math.round((b[3] / 1000) * W))));
  const cx0 = Math.max(0, Math.min(x0, Math.round(0.05 * W)));
  const cx1 = Math.max(x1, Math.round(0.95 * W));

  // validate
  const leaves = [];
  for (let i = 0; i < bounds.length; i++) {
    const [t, b] = bounds[i];
    const h = b - t;
    if (h < MIN_LEAF_FRAC * H) return { leaves: [], reason: `leaf ${i} too thin (${(h / H * 100).toFixed(0)}%)` };
    if (i > 0 && t < bounds[i - 1][1] - 2) return { leaves: [], reason: 'overlap after snap' };
    leaves.push({ left: cx0, top: t, width: cx1 - cx0, height: h });
  }
  return { leaves, W, H, boxes };
}

// crop + upload one leaf (same R2 scheme as split-book-v2)
async function processLeaf(buf, rect, bookId) {
  const id = new ObjectId().toHexString();
  const leafBuf = await sharp(buf).extract(rect).jpeg({ quality: 92, progressive: true }).toBuffer();
  const lm = await sharp(leafBuf).metadata();
  const fullUrl = await uploadToR2(`cropped/${bookId}/${id}.jpg`, leafBuf, bookId);
  const displayBuf = lm.width > 2000 ? await sharp(leafBuf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 88, progressive: true }).toBuffer() : leafBuf;
  const displayUrl = await uploadToR2(`pages/${bookId}/lf${id}.jpg`, await markDisplay(displayBuf, { bookId, pageNumber: id }), bookId);
  const thumbUrl = await uploadToR2(`pages/${bookId}/lf${id}-thumb.jpg`, await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer(), bookId);
  return { id, photo: displayUrl, display_photo: displayUrl, archived_photo: fullUrl, thumbnail: thumbUrl, image_width: lm.width, image_height: lm.height };
}

// Contact sheet: each frame shrunk to 300px wide with its leaf rectangles drawn (red) and numbered,
// 6 frames per row, 24 per sheet. The reviewer looks for a cut through a line of text, a dropped
// leaf, or a clipped margin.
async function writeSheets(bookId, frames) {
  const TW = 300, PER = 24, COLS = 6;
  for (let s = 0; s * PER < frames.length; s++) {
    const batch = frames.slice(s * PER, (s + 1) * PER);
    const tiles = [];
    let rowH = 0;
    for (const f of batch) {
      const k = TW / f.W, th = Math.round(f.H * k);
      rowH = Math.max(rowH, th + 22);
      const rects = (f.leaves || []).map((l, i) => `<rect x="${l.left * k}" y="${l.top * k}" width="${l.width * k}" height="${l.height * k}" fill="none" stroke="red" stroke-width="2"/><text x="${l.left * k + 4}" y="${l.top * k + 14}" fill="yellow" font-size="13" font-family="sans-serif">${i + 1}</text>`).join('');
      const label = `p${f.page_number} ${f.leaves?.length ? f.leaves.length + ' leaves' : 'KEPT ' + (f.reason || '')}`;
      const svg = Buffer.from(`<svg width="${TW}" height="${th + 22}" xmlns="http://www.w3.org/2000/svg">${rects}<text x="4" y="${th + 16}" fill="${f.leaves?.length ? 'white' : 'orange'}" font-size="14" font-family="sans-serif">${label}</text></svg>`);
      const img = await sharp(f.buf).resize({ width: TW }).toBuffer();
      tiles.push(await sharp({ create: { width: TW, height: th + 22, channels: 3, background: '#222' } }).composite([{ input: img, top: 0, left: 0 }, { input: svg, top: 0, left: 0 }]).jpeg().toBuffer());
    }
    const rows = Math.ceil(tiles.length / COLS);
    const comp = tiles.map((t, i) => ({ input: t, left: (i % COLS) * (TW + 6), top: Math.floor(i / COLS) * (rowH + 6) }));
    const file = path.join(OUT_DIR, `${bookId}-sheet-${String(s + 1).padStart(2, '0')}.jpg`);
    await sharp({ create: { width: COLS * (TW + 6), height: rows * (rowH + 6), channels: 3, background: '#000' } }).composite(comp).jpeg({ quality: 80 }).toFile(file);
    console.log(`  sheet: ${file}`);
  }
}

async function processBook(db, book) {
  if (!DRY_RUN) return applyPlan(db, book, JSON.parse(fs.readFileSync(PLAN, 'utf8')));
  const pageFilter = { book_id: book.id, page_number: { $gt: 0 }, split_from_pecha: { $exists: false } };
  if (PAGES) pageFilter.page_number = { $gte: PAGES[0], $lte: PAGES[1] ?? PAGES[0] };
  return detectBook(db.collection('pages'), book, pageFilter);
}

async function detectBook(Pages, book, pageFilter) {
  const pages = await Pages.find(pageFilter).sort({ page_number: 1 }).toArray();
  console.log(`\n[${book.id}] "${(book.title || '').slice(0, 40)}" — ${pages.length} candidate pages (DRY)`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  let split = 0, single = 0, fail = 0;
  const frames = [];
  for (const page of pages) {
    const src = page.archived_photo || page.display_photo || page.photo;
    if (!src) { single++; continue; }
    try {
      const buf = await download(src);
      const res = await splitComposite(buf);
      const meta = await sharp(buf).metadata();
      frames.push({ page_id: page.id, page_number: page.page_number, src, W: meta.width, H: meta.height, leaves: res.leaves, reason: res.reason, boxes: res.boxes, buf });
      if (!res.leaves.length) { single++; console.log(`  p${page.page_number}: kept (${res.reason})`); continue; }
      console.log(`  p${page.page_number}: ${res.leaves.length} leaves [${res.leaves.map(l => `${l.top}-${l.top + l.height}`).join(', ')}]`);
      split++;
    } catch (e) { fail++; console.log(`  p${page.page_number}: FAIL ${e.message?.slice(0, 60)}`); }
  }
  const counts = {}; for (const f of frames) { const n = f.leaves.length || 1; counts[n] = (counts[n] || 0) + 1; }
  console.log(`  -> ${split} split, ${single} single/kept, ${fail} failed; leaves per frame: ${JSON.stringify(counts)}`);
  const planFile = path.join(OUT_DIR, `${book.id}-plan.json`);
  fs.writeFileSync(planFile, JSON.stringify({ book_id: book.id, model: BBOX_MODEL, made_at: new Date().toISOString(), pages: PAGES, failed: fail, candidates: pages.length,
    frames: frames.map(({ buf, ...f }) => f) }, null, 1));
  console.log(`  plan: ${planFile}`);
  await writeSheets(book.id, frames);
}

async function applyPlan(db, book, plan) {
  const Pages = db.collection('pages');
  if (plan.book_id !== book.id) throw new Error(`plan is for ${plan.book_id}, not ${book.id}`);
  if (plan.failed / Math.max(1, plan.candidates) > FAILURE_ABORT_PCT) { console.log(`  ABORT: >${FAILURE_ABORT_PCT * 100}% failed in the plan`); return; }
  const todo = plan.frames.filter(f => f.leaves?.length > 1);
  console.log(`\n[${book.id}] applying reviewed plan: ${todo.length} frames to split`);
  let newPages = 0; const parents = [];
  for (const f of todo) {
    const page = await Pages.findOne({ id: f.page_id, book_id: book.id });
    // A resumed run skips frames an interrupted run already split, but still counts them as parents so their
    // vectors are withdrawn and the book is renumbered below.
    if (page?.split_into) { parents.push(page.id); console.log(`  p${f.page_number}: already split`); continue; }
    if (!page || page.page_number <= 0) { console.log(`  p${f.page_number}: skipped (gone or archived)`); continue; }
    const buf = await download(f.src);
    const meta = await sharp(buf).metadata();
    if (meta.width !== f.W || meta.height !== f.H) { console.log(`  p${f.page_number}: skipped (image is ${meta.width}x${meta.height}, plan says ${f.W}x${f.H})`); continue; }
    const now = new Date();
    const origPn = page.page_number;
    const children = [];
    for (let i = 0; i < f.leaves.length; i++) {
      const lf = await processLeaf(buf, f.leaves[i], book.id);
      children.push({
        _id: new ObjectId(lf.id), book_id: book.id, ...(book.tenantId ? { tenantId: book.tenantId } : {}),
        ...lf, page_number: 0, // placeholder; renumbered below
        split_from_pecha: page.id, leaf_index: i, _orig_pn: origPn,
        photo_original: page.photo_original || page.archived_photo || page.photo, // image-pick-ok: the parent is an unsplit frame (split_into checked above), so its own image is the whole frame
        ...(page.script_type ? { script_type: page.script_type } : {}),
        field_provenance: { photo: { source: 'r2', method: 'split-pecha-flashbbox-snap', engine: `agy:${BBOX_MODEL}`, plan: path.basename(PLAN), date: now } },
        created_at: now, updated_at: now,
      });
    }
    await Pages.insertMany(children);
    await Pages.updateOne({ id: page.id }, { $set: { page_number: -origPn, split_into: children.map(c => c.id), updated_at: now } });
    parents.push(page.id); newPages += children.length;
    console.log(`  p${origPn}: ${children.length} leaves`);
  }
  if (!parents.length) return;
  // The archived originals must stop being served by semantic search (#6270).
  await withdrawPageVectors(parents, { reason: 'archived', writer: 'split-pecha' });
  // A plan over a page range leaves the rest of the book unsplit, so the book is not marked done.
  await renumber(db, book, newPages, !plan.pages);
}

// Renumber: unsplit pages and leaves from earlier runs keep their place (their page_number is current);
// new leaves (placeholder 0) take their parent's slot, in leaf order. The parent left that slot when it
// was archived, so nothing collides.
async function renumber(db, book, newPages, complete) {
  const Pages = db.collection('pages');
  const all = await Pages.find({ book_id: book.id, $or: [{ page_number: { $gt: 0 } }, { split_from_pecha: { $exists: true }, page_number: 0 }] })
    .project({ _id: 1, page_number: 1, split_from_pecha: 1, leaf_index: 1, _orig_pn: 1 }).toArray();
  const key = (p) => (p.split_from_pecha && p.page_number === 0 ? p._orig_pn + (p.leaf_index || 0) / 100 : p.page_number);
  all.sort((a, b) => key(a) - key(b));
  let pn = 1; const bulk = all.map(p => ({ updateOne: { filter: { _id: p._id }, update: { $set: { page_number: pn++, updated_at: new Date() } } } }));
  if (bulk.length) await Pages.bulkWrite(bulk);
  const done = complete ? { split_completed: true, needs_splitting: false } : { needs_splitting: true };
  await db.collection('books').updateOne({ id: book.id }, { $set: { pages_count: all.length, ...done, split_geometry: 'pecha-vertical-multileaf', updated_at: new Date() } });
  console.log(`  applied: +${newPages} leaf pages; book pages_count=${all.length}, split_completed=${!!complete}`);
}

async function main() {
  const client = new MongoClient(MONGODB_URI, { maxPoolSize: 5 });
  await client.connect(); const db = client.db('bookstore');
  let books;
  if (ALL) {
    books = await db.collection('books').find({ needs_splitting: true, split_geometry: 'pecha-vertical-multileaf', split_completed: { $ne: true } }).project({ id: 1, title: 1, tenantId: 1 }).limit(LIMIT).toArray();
  } else if (BOOK_ARG) {
    books = await db.collection('books').find({ $or: [{ id: BOOK_ARG }, { slug: BOOK_ARG }] }).project({ id: 1, title: 1, tenantId: 1 }).toArray();
  } else { console.error('Usage: split-pecha.mjs <bookId|slug> [--dry-run] | --all --limit=N [--dry-run]'); process.exit(1); }
  console.log(`split-pecha: ${books.length} book(s)${DRY_RUN ? ' DRY RUN' : ''}`);
  for (const b of books) await processBook(db, b);
  await client.close();
}
main().catch(e => { console.error(e); process.exit(1); });
