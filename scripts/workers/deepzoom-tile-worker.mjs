#!/usr/bin/env node
/**
 * Deep-zoom tile worker (issue #2411, phase 2).
 *
 * Generates a DZI tile pyramid for an artwork's master image and uploads it to
 * R2 under `deepzoom/<book_id>/`, then writes the `deepzoom` manifest on the
 * book doc. The manifest is written LAST, only after the tiles are verified in
 * R2 — it is the single field the viewer branches on, so it can never point at
 * tiles that don't exist (see #2411 "pointer-rot guard").
 *
 * Resolution gate: masters below --gate megapixels (default 4) are not tiled —
 * below that the existing full-image viewer is already at native detail. The
 * skip is recorded on the doc as `deepzoom_gate` so sweeps don't re-download
 * the same small masters every run.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/workers/deepzoom-tile-worker.mjs --book <id>            # one artwork
 *   node scripts/workers/deepzoom-tile-worker.mjs --pre-warm --limit 100 # gated sweep
 *     [--gate 4] [--providers rijksmuseum,nga] [--concurrency 2] [--dry-run]
 *
 * Idempotent: docs with a `deepzoom` manifest are skipped (re-run with --force
 * to re-tile). Interrupted runs leave orphan tiles but no manifest — a re-run
 * overwrites them.
 */
import { MongoClient, ObjectId } from 'mongodb';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? dflt : process.argv[i + 1];
};
const has = (name) => process.argv.includes(name);

const BOOK_ID = arg('--book', null);
const PRE_WARM = has('--pre-warm');
const GATE_MP = parseFloat(arg('--gate', '4'));
const LIMIT = parseInt(arg('--limit', '50'), 10);
const CONCURRENCY = parseInt(arg('--concurrency', '2'), 10); // tiling jobs in flight
const UPLOAD_CONCURRENCY = 24; // tile PUTs per job
const PROVIDERS = arg('--providers', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DRY_RUN = has('--dry-run');
const FORCE = has('--force');

const TILE_SIZE = 256;
const OVERLAP = 1;
const JPEG_QUALITY = 85;
const UA = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org) bot';

if (!BOOK_ID && !PRE_WARM) {
  console.error('Pass --book <id> or --pre-warm. See header for usage.');
  process.exit(1);
}

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

async function pool(items, concurrency, fn) {
  let i = 0;
  const results = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    })
  );
  return results;
}

async function fetchMaster(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`master fetch HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function walkTiles(filesDir) {
  const tiles = [];
  for (const level of fs.readdirSync(filesDir)) {
    const levelDir = path.join(filesDir, level);
    if (!fs.statSync(levelDir).isDirectory()) continue;
    for (const f of fs.readdirSync(levelDir)) tiles.push({ level, file: f, abs: path.join(levelDir, f) });
  }
  return tiles;
}

async function tileOne(books, doc) {
  const id = doc._id.toString();
  const masterUrl = doc.archived_full_url || doc.image_full || doc.commons_full_url;
  if (!masterUrl) return { id, status: 'no-master' };

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `dz-${id}-`));
  try {
    const masterPath = path.join(tmp, 'master');
    await fetchMaster(masterUrl, masterPath);

    const meta = await sharp(masterPath, { limitInputPixels: false }).metadata();
    const mp = (meta.width * meta.height) / 1e6;
    if (mp < GATE_MP && !FORCE) {
      if (!DRY_RUN)
        await books.updateOne(
          { _id: doc._id },
          { $set: { deepzoom_gate: { mp: +mp.toFixed(1), below_gate: true, gate_mp: GATE_MP, checked_at: new Date() } } }
        );
      return { id, status: 'below-gate', mp: +mp.toFixed(1) };
    }

    if (DRY_RUN) return { id, status: 'would-tile', mp: +mp.toFixed(1) };

    // sharp dz layout: out.dzi descriptor + out_files/{level}/{x}_{y}.<ext>
    const outBase = path.join(tmp, 'out');
    await sharp(masterPath, { limitInputPixels: false })
      .jpeg({ quality: JPEG_QUALITY })
      .tile({ size: TILE_SIZE, overlap: OVERLAP, layout: 'dz' })
      .toFile(`${outBase}.dz`);

    const tiles = walkTiles(`${outBase}_files`);
    const format = path.extname(tiles[0].file).slice(1); // what sharp actually produced
    const prefix = `deepzoom/${id}`;

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
    // The descriptor too — handy for non-inline DZI clients; the viewer doesn't need it.
    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: `${prefix}/image.dzi`,
        Body: fs.readFileSync(`${outBase}.dzi`),
        ContentType: 'application/xml',
        CacheControl: 'public, max-age=31536000, immutable',
      })
    );

    // Verify before writing the manifest: the deepest level's first tile must exist.
    const maxLevel = Math.max(...tiles.map((t) => parseInt(t.level, 10)));
    await s3.send(
      new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: `${prefix}/${maxLevel}/0_0.${format}` })
    );

    // Manifest last — the only field the viewer branches on.
    await books.updateOne(
      { _id: doc._id },
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
            source_url: masterUrl,
            generated_at: new Date(),
          },
        },
        $unset: { deepzoom_gate: '' },
      }
    );
    return { id, status: 'tiled', mp: +mp.toFixed(1), tiles: tiles.length };
  } catch (e) {
    return { id, status: 'error', error: e.message };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const books = client.db('bookstore').collection('books');

let targets;
if (BOOK_ID) {
  const doc = await books.findOne({ _id: new ObjectId(BOOK_ID) });
  if (!doc) {
    console.error(`No book ${BOOK_ID}`);
    process.exit(1);
  }
  if (doc.deepzoom && !FORCE) {
    console.log(`${BOOK_ID} already has a deepzoom manifest (use --force to re-tile)`);
    process.exit(0);
  }
  targets = [doc];
} else {
  const q = {
    visible: true,
    content_type: 'artwork',
    deepzoom: { $exists: false },
    'deepzoom_gate.below_gate': { $ne: true },
    $or: [{ archived_full_url: { $type: 'string' } }, { image_full: { $type: 'string' } }],
  };
  if (PROVIDERS.length) q['image_source.provider'] = { $in: PROVIDERS };
  targets = await books
    .find(q, { projection: { archived_full_url: 1, image_full: 1, commons_full_url: 1 } })
    .limit(LIMIT)
    .toArray();
}

console.log(`${DRY_RUN ? '[dry-run] ' : ''}Tiling ${targets.length} artwork(s), gate ${GATE_MP}MP…`);
const results = await pool(targets, CONCURRENCY, async (doc) => {
  const r = await tileOne(books, doc);
  console.log(`  ${r.id} → ${r.status}${r.mp ? ` (${r.mp}MP${r.tiles ? `, ${r.tiles} tiles` : ''})` : ''}${r.error ? `: ${r.error}` : ''}`);
  return r;
});
await client.close();

const tally = {};
for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
console.log('\nDone:', JSON.stringify(tally));
