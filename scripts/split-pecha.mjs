#!/usr/bin/env node
/**
 * split-pecha.mjs — split vertically-stacked multi-leaf Tibetan/Bhutanese pecha
 * composites into single leaves (geometry B; see .claude/docs/multi-leaf-scan-splitting.md).
 *
 * Pipeline per composite page:
 *   1. flash bounding-box → N leaf regions (gemini-3-flash-preview, robust incl. tape-bridged gaps)
 *   2. deterministic gap-snap → cut at the true row-brightness minimum in each inter-leaf zone
 *   3. validate → 1..3 non-overlapping leaves of plausible height covering the content
 *      (N==1 = single leaf, kept as-is; no split)
 *   4. crop each leaf full-res (sharp) → upload to R2 (same key scheme as split-book-v2)
 *   5. child page records (split_from_pecha: <parentId>, leaf_index) ; archive original (negative page_number)
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/split-pecha.mjs <bookId|slug> --dry-run     # detect+report, no writes
 *   node scripts/split-pecha.mjs <bookId|slug>               # apply
 *   node scripts/split-pecha.mjs --all --limit=5 --dry-run   # batch over needs_splitting pecha books
 *
 * SAFETY: --dry-run by default does nothing destructive. Aborts a book if >20% of pages fail.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const ALL = args.includes('--all');
const LIMIT = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '1', 10);
const BOOK_ARG = args.find(a => !a.startsWith('--'));
const BBOX_MODEL = 'gemini-3-flash-preview';
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
async function uploadToR2(key, buf, ct = 'image/jpeg') {
  await r2.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key, Body: buf, ContentType: ct, CacheControl: 'public, max-age=86400, s-maxage=86400' }));
  return `${R2_PUBLIC_URL}/${key}`;
}

function geminiKeys() { const k = []; for (const [n, v] of Object.entries(process.env)) if (/^GEMINI_API_KEY/.test(n) && v) k.push(v); return k; }
const KEYS = geminiKeys(); let ki = 0;

async function download(url) {
  for (let t = 0; t < 3; t++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(25000) }); if (r.ok) return Buffer.from(await r.arrayBuffer()); } catch {}
    await new Promise(z => setTimeout(z, 800 * (t + 1)));
  }
  throw new Error('download failed');
}

// --- 1. flash bounding boxes (one per leaf, normalized 0-1000, top→bottom) ---
const BBOX_PROMPT = `This image shows one or more loose Tibetan manuscript leaves (pecha folios) — wide horizontal strips — photographed stacked vertically on a board/background. Return ONLY a JSON array of bounding boxes, one per DISTINCT physical leaf (not the background, not the whole plate, not individual lines of text). Each box: {"box_2d":[ymin,xmin,ymax,xmax]} normalized 0-1000, top to bottom order.`;
async function detectLeaves(buf) {
  const key = KEYS[ki++ % KEYS.length];
  const body = { contents: [{ parts: [{ inline_data: { mime_type: 'image/jpeg', data: buf.toString('base64') } }, { text: BBOX_PROMPT }] }], generationConfig: { temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingBudget: -1, includeThoughts: false } } };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${BBOX_MODEL}:generateContent?key=${key}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j.error?.message || j).slice(0, 120));
  const t = (j.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
  const m = t.match(/\[[\s\S]*\]/);
  const boxes = (m ? JSON.parse(m[0]) : []).map(b => b.box_2d).filter(b => Array.isArray(b) && b.length === 4);
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
    const top = i === 0 ? toPx(boxes[0][0]) : cuts[i - 1];
    const bot = i === boxes.length - 1 ? toPx(boxes[boxes.length - 1][2]) : cuts[i];
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
  const fullUrl = await uploadToR2(`cropped/${bookId}/${id}.jpg`, leafBuf);
  const displayBuf = lm.width > 2000 ? await sharp(leafBuf).resize({ width: 2000, withoutEnlargement: true }).jpeg({ quality: 88, progressive: true }).toBuffer() : leafBuf;
  const displayUrl = await uploadToR2(`pages/${bookId}/lf${id}.jpg`, displayBuf);
  const thumbUrl = await uploadToR2(`pages/${bookId}/lf${id}-thumb.jpg`, await sharp(leafBuf).resize({ width: 150 }).jpeg({ quality: 60 }).toBuffer());
  return { id, photo: displayUrl, display_photo: displayUrl, archived_photo: fullUrl, thumbnail: thumbUrl, image_width: lm.width, image_height: lm.height };
}

async function processBook(db, book) {
  const Pages = db.collection('pages');
  const pages = await Pages.find({ book_id: book.id, page_number: { $gt: 0 }, split_from_pecha: { $exists: false } }).sort({ page_number: 1 }).toArray();
  console.log(`\n[${book.id}] "${(book.title || '').slice(0, 40)}" — ${pages.length} candidate pages${DRY_RUN ? ' (DRY)' : ''}`);
  let split = 0, single = 0, fail = 0;
  const ops = []; // {parent, leaves:[rect...] , bufs}
  for (const page of pages) {
    const src = page.archived_photo || page.display_photo || page.photo;
    if (!src) { single++; continue; }
    try {
      const buf = await download(src);
      const res = await splitComposite(buf);
      if (!res.leaves.length) { single++; if (res.reason && res.reason !== 'single-leaf') console.log(`  p${page.page_number}: kept (${res.reason})`); continue; }
      console.log(`  p${page.page_number}: ${res.leaves.length} leaves` + (DRY_RUN ? ` [${res.leaves.map(l => `${l.top}-${l.top + l.height}`).join(', ')}]` : ''));
      split++;
      ops.push({ page, buf, leaves: res.leaves });
    } catch (e) { fail++; console.log(`  p${page.page_number}: FAIL ${e.message?.slice(0, 60)}`); }
  }
  console.log(`  -> ${split} split, ${single} single/kept, ${fail} failed`);
  if (DRY_RUN || !ops.length) return;
  if (fail / Math.max(1, pages.length) > FAILURE_ABORT_PCT) { console.log(`  ABORT: >${FAILURE_ABORT_PCT * 100}% failed`); return; }

  // apply: create child leaf pages, archive originals (negative page_number)
  let newPages = 0;
  for (const { page, buf, leaves } of ops) {
    const now = new Date();
    const origPn = Math.abs(page.page_number || 1);
    const children = [];
    for (let i = 0; i < leaves.length; i++) {
      const lf = await processLeaf(buf, leaves[i], book.id);
      children.push({
        _id: new ObjectId(), book_id: book.id, ...(book.tenantId ? { tenantId: book.tenantId } : {}),
        ...lf, id: lf.id, page_number: 0, // placeholder; renumbered below
        split_from_pecha: page.id, leaf_index: i, _orig_pn: origPn,
        photo_original: page.archived_photo || page.photo,
        field_provenance: { photo: { source: 'r2', method: 'split-pecha-flashbbox-snap', date: now } },
        created_at: now, updated_at: now,
      });
    }
    await Pages.insertMany(children);
    await Pages.updateOne({ id: page.id }, { $set: { page_number: -origPn, split_into: children.map(c => c.id), updated_at: now } });
    newPages += children.length;
  }
  // renumber: interleave unsplit pages (by page_number) with new leaves (by parent slot + leaf_index)
  const all = await Pages.find({ book_id: book.id, $or: [{ page_number: { $gt: 0 } }, { split_from_pecha: { $exists: true } }] })
    .project({ _id: 1, page_number: 1, split_from_pecha: 1, leaf_index: 1, _orig_pn: 1 }).toArray();
  all.sort((a, b) => {
    const ka = a.split_from_pecha ? a._orig_pn + (a.leaf_index || 0) / 100 : a.page_number;
    const kb = b.split_from_pecha ? b._orig_pn + (b.leaf_index || 0) / 100 : b.page_number;
    return ka - kb;
  });
  let pn = 1; const bulk = all.map(p => ({ updateOne: { filter: { _id: p._id }, update: { $set: { page_number: pn++, updated_at: new Date() } } } }));
  if (bulk.length) await Pages.bulkWrite(bulk);
  await db.collection('books').updateOne({ id: book.id }, { $set: { pages_count: all.length, split_completed: true, needs_splitting: false, updated_at: new Date() } });
  console.log(`  applied: +${newPages} leaf pages; book pages_count=${all.length}, split_completed=true`);
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
