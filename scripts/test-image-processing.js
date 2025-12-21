#!/usr/bin/env node
/**
 * Test image processing with adjustable parameters
 *
 * Usage: node scripts/test-image-processing.js
 *
 * Adjust PARAMS below to experiment with different settings
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// ============================================================
// ADJUSTABLE PARAMETERS - Edit these to experiment
// ============================================================

const PARAMS = {
  // Output dimensions
  width: 600,
  height: 900,

  // JPEG quality (1-100, higher = better quality, larger file)
  quality: 75,

  // Normalize: stretch contrast to full range
  // Set to false to disable, or { lower: 1, upper: 99 } to adjust percentiles
  normalize: true,  // or { lower: 2, upper: 98 }

  // Gamma correction (1.0 = no change, <1 = brighter, >1 = darker)
  gamma: null,  // try: 0.9 for brighter, 1.1 for darker

  // Sharpen (null = disabled)
  // sigma: blur radius, m1: flat areas, m2: edges
  sharpen: null,  // try: { sigma: 0.5, m1: 0, m2: 2 }

  // Linear contrast adjustment (null = disabled)
  // a: multiplier (>1 = more contrast), b: offset (brightness shift)
  linear: null,  // try: { a: 1.1, b: 0 }

  // Modulate brightness/saturation (null = disabled)
  modulate: null,  // try: { brightness: 1.1 } for 10% brighter

  // Convert to grayscale
  grayscale: true,
};

// Sample pages from Drebbel - Tractatus Two (already split single pages)
const SAMPLE_PAGES = [
  {
    number: 1,
    url: 'https://book-translation-data.s3.amazonaws.com/72d6af9c-4368-4ea5-8315-0a3d59161fbd.png',
    description: 'First page'
  },
  {
    number: 35,
    url: 'https://book-translation-data.s3.amazonaws.com/3d930033-0788-4ce7-93ca-d11a9155abfe.png',
    description: 'Middle page'
  },
  {
    number: 65,
    url: 'https://book-translation-data.s3.amazonaws.com/77a36341-f81c-472f-b0af-92294c77450d.png',
    description: 'Late page'
  }
];

// ============================================================
// Processing logic - no need to edit below
// ============================================================

async function processImage(buffer) {
  let pipeline = sharp(buffer)
    .resize(PARAMS.width, PARAMS.height, {
      fit: 'inside',
      withoutEnlargement: true
    });

  // Grayscale
  if (PARAMS.grayscale) {
    pipeline = pipeline.grayscale();
  }

  // Normalize (auto contrast)
  if (PARAMS.normalize) {
    if (typeof PARAMS.normalize === 'object') {
      pipeline = pipeline.normalize(PARAMS.normalize);
    } else {
      pipeline = pipeline.normalize();
    }
  }

  // Gamma
  if (PARAMS.gamma) {
    pipeline = pipeline.gamma(PARAMS.gamma);
  }

  // Linear contrast
  if (PARAMS.linear) {
    pipeline = pipeline.linear(PARAMS.linear.a, PARAMS.linear.b);
  }

  // Modulate
  if (PARAMS.modulate) {
    pipeline = pipeline.modulate(PARAMS.modulate);
  }

  // Sharpen
  if (PARAMS.sharpen) {
    pipeline = pipeline.sharpen(PARAMS.sharpen);
  }

  return pipeline
    .jpeg({ quality: PARAMS.quality, mozjpeg: true })
    .toBuffer();
}

async function processOriginal(buffer) {
  return sharp(buffer)
    .resize(PARAMS.width, PARAMS.height, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function fetchImage(url) {
  console.log(`  Fetching: ${url.split('/').pop()}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function main() {
  const outputDir = path.join(__dirname, '..', 'public', 'test-images');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  console.log('=== Image Processing Test ===\n');
  console.log('Book: Drebbel - Tractatus Two (single pages)\n');

  console.log('Current parameters:');
  console.log(JSON.stringify(PARAMS, null, 2));
  console.log('\n');

  for (const page of SAMPLE_PAGES) {
    console.log(`Processing Page ${page.number}: ${page.description}`);

    try {
      const originalBuffer = await fetchImage(page.url);
      const originalMeta = await sharp(originalBuffer).metadata();
      console.log(`  Original: ${originalMeta.width}x${originalMeta.height}, ${(originalBuffer.length / 1024).toFixed(0)}KB`);

      // Original (just resized)
      const origProcessed = await processOriginal(originalBuffer);
      const origPath = path.join(outputDir, `page-${page.number}-original.jpg`);
      fs.writeFileSync(origPath, origProcessed);
      console.log(`  original: ${(origProcessed.length / 1024).toFixed(0)}KB`);

      // Processed with current params
      const processed = await processImage(originalBuffer);
      const processedPath = path.join(outputDir, `page-${page.number}-processed.jpg`);
      fs.writeFileSync(processedPath, processed);
      console.log(`  processed: ${(processed.length / 1024).toFixed(0)}KB`);
      console.log();

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
    }
  }

  console.log('✓ Done!\n');
  console.log('View: http://localhost:3000/test-images/compare.html');
  console.log('\nTo adjust, edit PARAMS in scripts/test-image-processing.js and re-run');
}

main().catch(console.error);
