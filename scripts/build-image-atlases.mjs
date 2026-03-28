#!/usr/bin/env node
/**
 * Build texture atlases for the Image PixPlot visualization.
 *
 * Downloads all ~40K gallery thumbnails, resizes to 64x64,
 * packs into 4096x4096 JPEG atlas sheets.
 *
 * At 64x64 per thumb, each atlas holds 64x64 = 4,096 images.
 * ~40K images = 10 atlases, each ~2-4MB JPEG.
 *
 * Output:
 *   public/atlases/atlas-{N}.jpg  — texture atlas sheets
 *   public/atlases/manifest.json  — metadata for the component
 *
 * Usage: node scripts/build-image-atlases.mjs
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const THUMB_SIZE = 64;       // pixels per thumbnail
const ATLAS_SIZE = 4096;     // atlas dimensions
const GRID = ATLAS_SIZE / THUMB_SIZE; // 64 thumbs per row/col
const PER_ATLAS = GRID * GRID;       // 4096 images per atlas
const JPEG_QUALITY = 80;
const CONCURRENCY = 20;
const RETRY_ATTEMPTS = 2;
const OUTPUT_DIR = path.join(ROOT, 'public', 'atlases');

// Load constellation data
const dataPath = path.join(ROOT, 'src', 'data', 'image-constellation.json');
console.log('Loading constellation data...');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const images = data.images;
console.log(`Total images: ${images.length}`);

const totalAtlases = Math.ceil(images.length / PER_ATLAS);
console.log(`Will generate ${totalAtlases} atlases (${GRID}x${GRID} = ${PER_ATLAS} per atlas)`);

// Ensure output directory
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function downloadWithRetry(url, attempts = RETRY_ATTEMPTS) {
  for (let i = 0; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (i === attempts) throw e;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

async function downloadAndResize(url) {
  try {
    const buf = await downloadWithRetry(url);
    return await sharp(buf)
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: JPEG_QUALITY })
      .toBuffer();
  } catch (e) {
    // Return a dark placeholder on failure
    return await sharp({
      create: { width: THUMB_SIZE, height: THUMB_SIZE, channels: 3, background: { r: 30, g: 30, b: 40 } }
    }).jpeg({ quality: 50 }).toBuffer();
  }
}

// Process with concurrency limit
async function processWithConcurrency(items, fn, limit) {
  const results = new Array(items.length);
  let idx = 0;
  let completed = 0;
  const startTime = Date.now();

  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
      completed++;
      if (completed % 500 === 0 || completed === items.length) {
        const elapsed = (Date.now() - startTime) / 1000;
        const rate = completed / elapsed;
        const eta = Math.round((items.length - completed) / rate);
        process.stdout.write(`\r  ${completed}/${items.length} (${rate.toFixed(0)}/s, ~${eta}s remaining)    `);
      }
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  console.log('');
  return results;
}

async function buildAtlas(atlasIndex, imageSlice) {
  console.log(`\nAtlas ${atlasIndex}: downloading ${imageSlice.length} thumbnails...`);

  // Download and resize all thumbnails for this atlas
  const thumbBuffers = await processWithConcurrency(
    imageSlice,
    (img) => downloadAndResize(img.thumbnail),
    CONCURRENCY
  );

  console.log(`  Compositing atlas ${atlasIndex}...`);

  // Build composite operations
  const composites = thumbBuffers.map((buf, i) => ({
    input: buf,
    left: (i % GRID) * THUMB_SIZE,
    top: Math.floor(i / GRID) * THUMB_SIZE,
  }));

  // Create atlas canvas and composite all thumbs
  const atlas = sharp({
    create: {
      width: ATLAS_SIZE,
      height: ATLAS_SIZE,
      channels: 3,
      background: { r: 8, g: 8, b: 13 }, // Match viz background
    }
  });

  const outputPath = path.join(OUTPUT_DIR, `atlas-${atlasIndex}.jpg`);
  await atlas
    .composite(composites)
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toFile(outputPath);

  const stat = fs.statSync(outputPath);
  console.log(`  Saved ${outputPath} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
  return stat.size;
}

async function main() {
  const overallStart = Date.now();
  let totalSize = 0;

  for (let a = 0; a < totalAtlases; a++) {
    const start = a * PER_ATLAS;
    const end = Math.min(start + PER_ATLAS, images.length);
    const slice = images.slice(start, end);
    totalSize += await buildAtlas(a, slice);
  }

  // Write manifest (imageIds maps atlas position → image ID for click lookup)
  const manifest = {
    thumbSize: THUMB_SIZE,
    atlasSize: ATLAS_SIZE,
    grid: GRID,
    perAtlas: PER_ATLAS,
    totalImages: images.length,
    totalAtlases,
    atlases: Array.from({ length: totalAtlases }, (_, i) => `atlas-${i}.jpg`),
    imageIds: images.map(img => img.id),
    generatedAt: new Date().toISOString(),
  };

  const manifestPath = path.join(OUTPUT_DIR, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`\nManifest: ${manifestPath}`);

  const elapsed = ((Date.now() - overallStart) / 1000 / 60).toFixed(1);
  console.log(`Total: ${totalAtlases} atlases, ${(totalSize / 1024 / 1024).toFixed(1)}MB, ${elapsed} min`);
}

main().catch(e => { console.error(e); process.exit(1); });
