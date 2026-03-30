#!/usr/bin/env node
/**
 * Precompute grid-snapped positions for PixPlot visualization.
 * Adds `gx` and `gy` fields to each image in the constellation JSON
 * so the browser doesn't have to run the expensive snap algorithm.
 *
 * Usage: node scripts/precompute-grid-positions.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_PATH = path.join(ROOT, 'src', 'data', 'image-constellation.json');

const WORLD_SIZE = 8000;
const PADDING = 400;
const CELL_SIZE = 20;

console.log('Loading constellation data...');
const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
const images = data.images;
console.log(`${images.length} images`);

const usable = WORLD_SIZE - 2 * PADDING;
const gridW = Math.ceil(usable / CELL_SIZE);
const occupied = new Uint8Array(gridW * gridW);

// Sort by distance to centroid (central images get priority)
const cx = images.reduce((s, im) => s + im.x, 0) / images.length;
const cy = images.reduce((s, im) => s + im.y, 0) / images.length;
const order = images.map((im, i) => ({
  i,
  d: (im.x - cx) ** 2 + (im.y - cy) ** 2,
}));
order.sort((a, b) => a.d - b.d);

console.log(`Grid: ${gridW}x${gridW} = ${gridW * gridW} cells (${(images.length / (gridW * gridW) * 100).toFixed(1)}% fill)`);

let maxRadius = 0;
const start = Date.now();

for (const { i } of order) {
  const im = images[i];
  const idealCol = Math.round(im.x * (gridW - 1));
  const idealRow = Math.round(im.y * (gridW - 1));

  let placed = false;
  for (let r = 0; r < 300 && !placed; r++) {
    const startC = Math.max(0, idealCol - r);
    const endC = Math.min(gridW - 1, idealCol + r);
    const startR = Math.max(0, idealRow - r);
    const endR = Math.min(gridW - 1, idealRow + r);

    for (let row = startR; row <= endR && !placed; row++) {
      for (let col = startC; col <= endC && !placed; col++) {
        if (r > 0 && row > startR && row < endR && col > startC && col < endC) continue;
        const key = row * gridW + col;
        if (!occupied[key]) {
          occupied[key] = 1;
          im.gx = +(PADDING + col * CELL_SIZE + CELL_SIZE / 2).toFixed(1);
          im.gy = +(PADDING + row * CELL_SIZE + CELL_SIZE / 2).toFixed(1);
          placed = true;
          if (r > maxRadius) maxRadius = r;
        }
      }
    }
  }

  if (!placed) {
    im.gx = +(PADDING + im.x * usable).toFixed(1);
    im.gy = +(PADDING + im.y * usable).toFixed(1);
    console.warn(`  Warning: image ${i} not placed, using raw position`);
  }
}

const elapsed = Date.now() - start;
console.log(`Grid snap complete in ${elapsed}ms (max spiral radius: ${maxRadius})`);

// Write back
fs.writeFileSync(DATA_PATH, JSON.stringify(data));
const stat = fs.statSync(DATA_PATH);
console.log(`Wrote ${DATA_PATH} (${(stat.size / 1024 / 1024).toFixed(1)}MB)`);
