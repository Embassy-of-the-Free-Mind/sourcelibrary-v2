#!/usr/bin/env node
/**
 * Direct test of auto-split detection (bypasses local DB)
 * Fetches page data from production API, runs detection locally
 */

const sharp = require('sharp');

const API_BASE = 'https://sourcelibrary.org';

// Import detection logic (inline for testing)
function analyzeColumns(pixelData, width, height, darkThreshold = 180) {
  const columns = [];
  for (let x = 0; x < width; x++) {
    const pixels = [];
    for (let y = 0; y < height; y++) {
      pixels.push(pixelData[y * width + x]);
    }
    const sorted = [...pixels].sort((a, b) => a - b);
    const sum = pixels.reduce((a, b) => a + b, 0);
    const mean = sum / height;

    let maxDarkRun = 0, currentRun = 0;
    for (const p of pixels) {
      if (p < darkThreshold) { currentRun++; maxDarkRun = Math.max(maxDarkRun, currentRun); }
      else { currentRun = 0; }
    }

    let transitions = 0;
    for (let i = 1; i < pixels.length; i++) {
      if ((pixels[i-1] < darkThreshold) !== (pixels[i] < darkThreshold)) transitions++;
    }

    const darkPixels = sorted.slice(0, Math.floor(height * 0.25));
    const darkMean = darkPixels.reduce((a, b) => a + b, 0) / darkPixels.length;
    const darkVariance = darkPixels.reduce((sum, v) => sum + Math.pow(v - darkMean, 2), 0) / darkPixels.length;

    columns.push({
      x, mean, min: sorted[0],
      p10: sorted[Math.floor(height * 0.1)],
      maxDarkRun: (maxDarkRun / height) * 100,
      transitions,
      darkStdDev: Math.sqrt(darkVariance),
    });
  }
  return columns;
}

function findGutterPosition(columns) {
  const searchStart = Math.floor(columns.length * 0.35);
  const searchEnd = Math.floor(columns.length * 0.65);
  let bestScore = -Infinity, bestIdx = Math.floor(columns.length / 2);

  for (let i = searchStart; i < searchEnd; i++) {
    const col = columns[i];
    const score = (255 - col.p10) / 2.55 * 0.3 + col.maxDarkRun * 0.35 +
      Math.max(0, 100 - col.transitions / 5) * 0.2 + Math.max(0, 50 - col.darkStdDev) * 0.15;
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return { position: bestIdx, score: bestScore, stats: columns[bestIdx] };
}

function detectTextAtPosition(columns, position) {
  const start = Math.max(0, position - 3);
  const end = Math.min(columns.length, position + 4);
  const window = columns.slice(start, end);
  const avgTransitions = window.reduce((sum, c) => sum + c.transitions, 0) / window.length;
  const avgMaxDarkRun = window.reduce((sum, c) => sum + c.maxDarkRun, 0) / window.length;
  const avgDarkStdDev = window.reduce((sum, c) => sum + c.darkStdDev, 0) / window.length;
  const splitCol = columns[position];

  const hasHighTransitions = splitCol.transitions > 30 && avgTransitions > 40;
  const hasLowDarkRun = splitCol.maxDarkRun < 40 && avgMaxDarkRun < 50;
  const hasHighVariance = avgDarkStdDev > 30;
  const textSignals = [hasHighTransitions, hasLowDarkRun, hasHighVariance].filter(Boolean).length;

  return { hasText: textSignals >= 2, avgTransitions, avgMaxDarkRun, avgDarkStdDev };
}

async function detectSplit(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(1000, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const aspectRatio = info.width / info.height;
  if (aspectRatio < 0.9) {
    return { isTwoPageSpread: false, confidence: 'high', splitPosition: 500 };
  }

  const columns = analyzeColumns(data, info.width, info.height);
  const gutter = findGutterPosition(columns);
  const textCheck = detectTextAtPosition(columns, gutter.position);

  let confidence = 'medium';
  if (aspectRatio > 1.1 && gutter.score > 50 && !textCheck.hasText) confidence = 'high';
  else if (aspectRatio < 1.0 || gutter.score < 30 || textCheck.hasText) confidence = 'low';

  return {
    isTwoPageSpread: aspectRatio > 1.0,
    confidence,
    splitPosition: Math.round((gutter.position / columns.length) * 1000),
    splitPercent: (gutter.position / columns.length * 100).toFixed(1),
    hasTextAtSplit: textCheck.hasText,
    metrics: {
      aspectRatio: aspectRatio.toFixed(3),
      gutterScore: gutter.score.toFixed(1),
      maxDarkRun: gutter.stats.maxDarkRun.toFixed(1),
      transitions: gutter.stats.transitions,
    }
  };
}

async function main() {
  const bookId = process.argv[2] || '6909cfe3cf28baa1b4caff19';
  const pageNum = parseInt(process.argv[3]) || 50;

  console.log(`Fetching book ${bookId}...`);
  const bookRes = await fetch(`${API_BASE}/api/books/${bookId}`);
  const book = await bookRes.json();

  const page = book.pages.find(p => p.page_number === pageNum);
  if (!page) { console.error(`Page ${pageNum} not found`); process.exit(1); }

  console.log(`\nTesting page ${pageNum}...`);
  const imageUrl = page.photo_original || page.photo;
  console.log(`Fetching image...`);

  const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60000) });
  const imageBuffer = Buffer.from(await imgRes.arrayBuffer());

  console.log(`Running detection...`);
  const result = await detectSplit(imageBuffer);

  console.log(`\n=== Auto-Split Detection Result ===`);
  console.log(JSON.stringify(result, null, 2));

  console.log(`\n=== Summary ===`);
  console.log(`Two-page spread: ${result.isTwoPageSpread ? 'YES' : 'NO'}`);
  console.log(`Split position: ${result.splitPercent}% (${result.splitPosition}/1000)`);
  console.log(`Text at split: ${result.hasTextAtSplit ? 'YES ⚠️' : 'NO ✓'}`);
  console.log(`Confidence: ${result.confidence.toUpperCase()}`);
}

main().catch(console.error);
