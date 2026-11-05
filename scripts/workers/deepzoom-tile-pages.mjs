#!/usr/bin/env node
/**
 * Deep-zoom: tile illustrated book-page masters (#2411).
 *
 * Sibling of scripts/workers/deepzoom-tile-worker.mjs (which tiles artwork masters
 * on the `books` collection). This one tiles a PAGE's `fullres_master` — the
 * native-res master harvested by deepzoom-harvest-page-masters.mjs — into a DZI
 * pyramid on R2 under `deepzoom/page/<book_id>/<page_number>/`, then writes the
 * `deepzoom` manifest on the page doc. The book reader mounts OpenSeadragon when
 * the page it's showing has that manifest.
 *
 * Manifest is written LAST, after a HEAD-verify of the deepest tile — it is the
 * only field the reader branches on, so it can never reference missing tiles.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/deepzoom-tile-pages.mjs --providers bodleian --limit 200
 *     [--book-id <id>] [--concurrency 2] [--dry-run] [--force]
 *
 * Idempotent: pages with a `deepzoom` manifest are skipped unless --force.
 *
 * --own-leaf --tenant <id> (#8096): tile the page's OWN image instead of `fullres_master`. For split-from-spread
 * scans `fullres_master` (from `photo_original`) is the whole spread, so a reader would zoom into two pages. The
 * source is picked by scripts/lib/deepzoom-own-leaf.mjs (geometry + a signature match against the reader's image,
 * largest survivor wins, ambiguity refused). Targets: the tenant's visible books, pages whose best
 * `gallery_images.gallery_quality` clears the gate (joined by `page_id`), page_number >= 0, not hidden, not a
 * `repeat_of`, and not owned by the plate job (`plate_whole` / `fullres_master` set — #8042 tiles those). Tiles are
 * keyed by page ID, `deepzoom/page/<book_id>/<page id>/`, so a renumber (#5699) can never point a manifest at
 * another page's tiles; the manifest write is conditional on the source field still holding the URL we tiled.
 *   node scripts/workers/deepzoom-tile-pages.mjs --own-leaf --tenant <id> [--page-ids f.txt] [--limit N]
 *     [--min-mp 4] [--out ledger.jsonl] [--revalidate] [--dry-run]
 * --revalidate evicts each tiled page's reader URL on the apex and in the tenant's embed (ISR + Cloudflare, 24h each),
 * in batches, so the Deep zoom button shows the same day instead of up to two days later.
 * Books go in reader order (books.human_read_count, then most qualifying pages). Default mode is unchanged.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { assertBookScopedKey } from '../lib/r2-key.mjs';
import { chooseOwnLeaf } from '../lib/deepzoom-own-leaf.mjs';
import { recordSweepAction } from '../lib/sweep-log.mjs';
import { revalidatePaths } from '../lib/revalidate.mjs';

const arg = (n, d = null) => {
  const i = process.argv.indexOf(n);
  return i === -1 ? d : process.argv[i + 1];
};
const has = (n) => process.argv.includes(n);

const PROVIDERS = (arg('--providers', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const BOOK_ID = arg('--book-id', null);
// Deep-zoom is a "lean in and admire the illustration" feature, so only tile pages
// whose best detected illustration clears this gallery_quality bar (0.7 = real
// illustrations, dropping musical scores + the 0.6–0.7 marginal tier). 0 = no gate.
const MIN_GALLERY_QUALITY = parseFloat(arg('--min-gallery-quality', '0.7'));
const LIMIT = parseInt(arg('--limit', '200'), 10);
const CONCURRENCY = parseInt(arg('--concurrency', '2'), 10);
const UPLOAD_CONCURRENCY = 24;
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');

const TILE_SIZE = 256;
const OVERLAP = 1;
const JPEG_QUALITY = 85;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

const OWN_LEAF = has('--own-leaf');
const TENANT = arg('--tenant', null);
// --own-leaf only: below this the reader's own 4000px render already shows every pixel (harvester's gate).
const MIN_MP = parseFloat(arg('--min-mp', '4'));
// A page is ours to tile only while all of these hold; re-checked on the fresh doc and on the manifest write.
const OWN_LEAF_ELIGIBLE = {
  page_number: { $gte: 0 },
  hidden: { $ne: true },
  repeat_of: null,
  plate_whole: { $exists: false },
  fullres_master: { $exists: false },
};

if (OWN_LEAF && !TENANT) {
  console.error('--own-leaf needs --tenant <id>.');
  process.exit(1);
}
if (!OWN_LEAF && !PROVIDERS.length && !BOOK_ID) {
  console.error('Pass --providers <a,b> or --book-id <id>.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
});

async function pool(items, n, fn) {
  let i = 0;
  const out = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    })
  );
  return out;
}

function walkTiles(filesDir) {
  const tiles = [];
  for (const level of fs.readdirSync(filesDir)) {
    const lvl = path.join(filesDir, level);
    if (!fs.statSync(lvl).isDirectory()) continue;
    for (const f of fs.readdirSync(lvl)) tiles.push({ level, file: f, abs: path.join(lvl, f) });
  }
  return tiles;
}

async function tilePage(pages, page) {
  const master = page.fullres_master?.url;
  if (!master) return { id: page._id, status: 'no-master' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dzp-${page._id}-`));
  try {
    const res = await fetch(master, { headers: { 'User-Agent': UA } });
    if (!res.ok) return { id: page._id, status: 'fetch-fail', error: `HTTP ${res.status}` };
    const masterPath = path.join(tmp, 'master');
    fs.writeFileSync(masterPath, Buffer.from(await res.arrayBuffer()));

    const meta = await sharp(masterPath, { limitInputPixels: false }).metadata();
    if (DRY_RUN) return { id: page._id, status: 'would-tile', w: meta.width, h: meta.height };

    const outBase = path.join(tmp, 'out');
    await sharp(masterPath, { limitInputPixels: false })
      .jpeg({ quality: JPEG_QUALITY })
      .tile({ size: TILE_SIZE, overlap: OVERLAP, layout: 'dz' })
      .toFile(`${outBase}.dz`);

    const tiles = walkTiles(`${outBase}_files`);
    const format = path.extname(tiles[0].file).slice(1);
    const prefix = `deepzoom/page/${page.book_id}/${page.page_number}`;

    await pool(tiles, UPLOAD_CONCURRENCY, (t) =>
      s3.send(
        new PutObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: `${prefix}/${t.level}/${t.file}`,
          Body: fs.readFileSync(t.abs),
          ContentType: 'image/jpeg',
          CacheControl: 'public, max-age=31536000, immutable',
        })
      )
    );

    const maxLevel = Math.max(...tiles.map((t) => parseInt(t.level, 10)));
    await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: `${prefix}/${maxLevel}/0_0.${format}` })
    );

    await pages.updateOne(
      { _id: page._id },
      {
        $set: {
          deepzoom: {
            width: meta.width,
            height: meta.height,
            tile_size: TILE_SIZE,
            overlap: OVERLAP,
            format,
            prefix,
            tile_count: tiles.length,
            source_url: master,
            generated_at: new Date(),
          },
        },
      }
    );
    return { id: page._id, status: 'tiled', w: meta.width, h: meta.height, tiles: tiles.length };
  } catch (e) {
    return { id: page._id, status: 'error', error: e.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');
const books = db.collection('books');
const pages = db.collection('pages');

if (OWN_LEAF) {
  await runOwnLeaf();
  await client.close();
  process.exit(0);
}

const pageFilter = { fullres_master: { $exists: true } };
if (!FORCE) pageFilter.deepzoom = { $exists: false };
if (BOOK_ID) {
  pageFilter.book_id = BOOK_ID;
} else {
  const ids = (
    await books.find({ visible: true, 'image_source.provider': { $in: PROVIDERS } }, { projection: { _id: 1 } }).toArray()
  ).map((b) => b._id.toString());
  pageFilter.book_id = { $in: ids };
}

let targets = await pages
  .find(pageFilter, { projection: { book_id: 1, page_number: 1, fullres_master: 1 } })
  .toArray();

// Gallery-quality gate: keep only pages whose best illustration clears the bar.
if (MIN_GALLERY_QUALITY > 0 && targets.length) {
  const gallery = db.collection('gallery_images');
  const bookIds = [...new Set(targets.map((t) => t.book_id))];
  const qualified = new Set();
  const rows = await gallery
    .aggregate([
      { $match: { book_id: { $in: bookIds } } },
      { $group: { _id: { b: '$book_id', p: '$page_number' }, maxq: { $max: '$gallery_quality' } } },
      { $match: { maxq: { $gte: MIN_GALLERY_QUALITY } } },
    ])
    .toArray();
  for (const r of rows) qualified.add(`${r._id.b}:${r._id.p}`);
  const before = targets.length;
  targets = targets.filter((t) => qualified.has(`${t.book_id}:${t.page_number}`));
  console.log(`Gallery-quality gate ≥${MIN_GALLERY_QUALITY}: ${targets.length}/${before} pages qualify.`);
}
targets = targets.slice(0, LIMIT);

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Tiling ${targets.length} page master(s)…`);
const results = await pool(targets, CONCURRENCY, async (p) => {
  const r = await tilePage(pages, p);
  console.log(`  ${p.book_id}/${p.page_number} → ${r.status}${r.w ? ` (${r.w}×${r.h}${r.tiles ? `, ${r.tiles} tiles` : ''})` : ''}${r.error ? `: ${r.error}` : ''}`);
  return r;
});
await client.close();

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log('\nDone:', JSON.stringify(tally));

// ─── --own-leaf (#8096) ─────────────────────────────────────────────────────────────────────────────────────────

async function fetchImage(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 404 || res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
  }
  return null;
}

async function ownLeafTargets() {
  const bookDocs = await books
    .find({ tenantId: TENANT, visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 1, id: 1, slug: 1, human_read_count: 1 } })
    .toArray();
  const canon = new Map(); // any id form -> book doc
  for (const b of bookDocs) {
    canon.set(String(b._id), b);
    if (b.id) canon.set(b.id, b);
  }
  const rows = await db
    .collection('gallery_images')
    .aggregate(
      [
        { $match: { book_id: { $in: [...canon.keys()] } } },
        { $group: { _id: '$page_id', maxq: { $max: '$gallery_quality' } } },
        { $match: { _id: { $ne: null }, maxq: { $gte: MIN_GALLERY_QUALITY } } },
      ],
      { allowDiskUse: true }
    )
    .toArray();
  let ids = rows.map((r) => r._id);
  const PAGE_IDS = arg('--page-ids', null);
  if (PAGE_IDS) {
    const want = new Set(fs.readFileSync(PAGE_IDS, 'utf8').split(/\s+/).filter(Boolean));
    ids = ids.filter((x) => want.has(x));
  }
  const q = { id: { $in: ids }, ...OWN_LEAF_ELIGIBLE };
  if (!FORCE) q.deepzoom = { $exists: false };
  const docs = await pages.find(q, { projection: { id: 1, book_id: 1, page_number: 1 } }).toArray();
  const perBook = new Map();
  for (const d of docs) if (canon.has(d.book_id)) perBook.set(d.book_id, (perBook.get(d.book_id) || 0) + 1);
  const rank = (bid) => canon.get(bid)?.human_read_count || 0;
  return docs
    .filter((d) => canon.has(d.book_id))
    .map((d) => ({ ...d, slug: canon.get(d.book_id).slug || d.book_id }))
    .sort((a, b) => rank(b.book_id) - rank(a.book_id) || perBook.get(b.book_id) - perBook.get(a.book_id) || (a.book_id < b.book_id ? -1 : a.book_id > b.book_id ? 1 : 0) || a.page_number - b.page_number);
}

async function tileOwnLeaf(target) {
  const t0 = Date.now();
  const page = await pages.findOne({ id: target.id, book_id: target.book_id, ...OWN_LEAF_ELIGIBLE }, { projection: { ocr: 0, translation: 0, detected_images: 0 } });
  if (!page) return { status: 'no-longer-eligible' };
  if (page.deepzoom && !FORCE) return { status: 'already-tiled' };

  const pick = await chooseOwnLeaf(page, fetchImage);
  if (!pick.ok) return { status: `refused:${pick.reason}`, considered: pick.considered };
  const mp = (pick.width * pick.height) / 1e6;
  const base = { field: pick.field, ref: pick.refField, corr: +pick.corr.toFixed(3), w: pick.width, h: pick.height, mp: +mp.toFixed(1), considered: pick.considered };
  if (mp < MIN_MP) return { status: 'below-gate', ...base };
  if (DRY_RUN) return { status: 'would-tile', ...base };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dzo-${page.id}-`));
  try {
    const outBase = path.join(tmp, 'out');
    let img = sharp(pick.buf, { limitInputPixels: false });
    if (pick.region) img = img.extract(pick.region);
    await img.jpeg({ quality: JPEG_QUALITY }).tile({ size: TILE_SIZE, overlap: OVERLAP, layout: 'dz' }).toFile(`${outBase}.dz`);
    pick.buf = null;

    const tiles = walkTiles(`${outBase}_files`);
    const format = path.extname(tiles[0].file).slice(1);
    const prefix = `deepzoom/page/${page.book_id}/${page.id}`;
    assertBookScopedKey(`${prefix}/0/0_0.${format}`, page.book_id, 'deepzoom-tile-pages --own-leaf');
    let bytes = 0;
    await pool(tiles, UPLOAD_CONCURRENCY, async (t) => {
      const body = fs.readFileSync(t.abs);
      bytes += body.length;
      for (let attempt = 0; ; attempt++) {
        try {
          return await s3.send(
            new PutObjectCommand({
              Bucket: process.env.R2_BUCKET_NAME,
              Key: `${prefix}/${t.level}/${t.file}`,
              Body: body,
              ContentType: 'image/jpeg',
              CacheControl: 'public, max-age=31536000, immutable',
            })
          );
        } catch (e) {
          if (attempt >= 3) throw e;
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    });

    // Verify the deepest level's first AND last tile before the manifest exists.
    const maxLevel = Math.max(...tiles.map((t) => parseInt(t.level, 10)));
    const deepest = tiles.filter((t) => parseInt(t.level, 10) === maxLevel).map((t) => t.file).sort();
    for (const f of new Set([`0_0.${format}`, deepest[deepest.length - 1]])) {
      await s3.send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: `${prefix}/${maxLevel}/${f}` }));
    }

    const srcField = pick.field.replace(/[~+].*$/, '');
    const manifest = {
      width: pick.width,
      height: pick.height,
      tile_size: TILE_SIZE,
      overlap: OVERLAP,
      format,
      prefix,
      tile_count: tiles.length,
      source_url: pick.url,
      source_field: pick.field,
      ...(pick.region ? { source_crop: pick.region } : {}),
      page_id: page.id,
      issue: 8096,
      generated_at: new Date(),
    };
    // Conditional: still eligible, still no manifest, and the field we picked from still holds the URL we tiled.
    const res = await pages.updateOne(
      { _id: page._id, id: page.id, book_id: page.book_id, ...OWN_LEAF_ELIGIBLE, deepzoom: { $exists: false }, [srcField]: page[srcField] },
      { $set: { deepzoom: manifest } }
    );
    if (res.modifiedCount !== 1) return { status: 'changed-under-us', ...base, tiles: tiles.length, bytes, prefix };
    await recordSweepAction(db, {
      sweep: 'deepzoom-own-leaf-8096',
      book_id: page.book_id,
      action: 'deepzoom-tiled',
      detail: { page_id: page.id, page_number: page.page_number, prefix, tiles: tiles.length, bytes, source_url: pick.url, source_field: pick.field, region: pick.region || null },
    });
    return { status: 'tiled', ...base, tiles: tiles.length, bytes, prefix, ms: Date.now() - t0 };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runOwnLeaf() {
  const OUT = arg('--out', null);
  let targets = await ownLeafTargets();
  console.log(`own-leaf: ${targets.length} eligible page(s) at gallery_quality ≥${MIN_GALLERY_QUALITY}${FORCE ? '' : ', untiled'}.`);
  targets = targets.slice(0, LIMIT);
  const tally = {};
  let tilesSum = 0, bytesSum = 0;
  const REVALIDATE = has('--revalidate') && !DRY_RUN;
  const tenantSlug = REVALIDATE ? (await db.collection('tenants').findOne({ id: TENANT }, { projection: { slug: 1 } }))?.slug : null;
  let pending = [];
  const flush = async () => {
    const batch = pending;
    pending = [];
    if (!batch.length) return;
    try {
      await revalidatePaths(batch, { quiet: true });
    } catch (e) {
      console.warn(`  revalidate failed for ${batch.length} path(s): ${e.message}`);
      if (OUT) fs.appendFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), status: 'revalidate-failed', paths: batch }) + '\n');
    }
  };
  await pool(targets, CONCURRENCY, async (t) => {
    let r;
    try {
      r = await tileOwnLeaf(t);
    } catch (e) {
      r = { status: 'error', error: e.message };
    }
    tally[r.status] = (tally[r.status] ?? 0) + 1;
    tilesSum += r.tiles || 0;
    bytesSum += r.bytes || 0;
    if (REVALIDATE && r.status === 'tiled') {
      pending.push(`/book/${t.slug}/page/${t.id}`);
      if (tenantSlug) pending.push(`/embed/${tenantSlug}/book/${t.slug}/page/${t.id}`);
      if (pending.length >= 40) await flush();
    }
    const line = { at: new Date().toISOString(), id: t.id, book_id: t.book_id, page_number: t.page_number, ...r };
    if (OUT) fs.appendFileSync(OUT, JSON.stringify(line) + '\n');
    console.log(`  ${t.book_id}/${t.page_number} ${t.id} → ${r.status}${r.w ? ` ${r.field} ${r.w}×${r.h}` : ''}${r.tiles ? ` ${r.tiles} tiles ${(r.bytes / 1e6).toFixed(1)}MB ${(r.ms / 1000).toFixed(0)}s` : ''}${r.error ? `: ${r.error}` : ''}`);
  });
  await flush();
  console.log('\nDone:', JSON.stringify(tally), `tiles=${tilesSum} MB=${(bytesSum / 1e6).toFixed(1)}`);
}
