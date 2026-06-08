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
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

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
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org) bot';

if (!PROVIDERS.length && !BOOK_ID) {
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
