#!/usr/bin/env node
/**
 * Test the split detection heuristic
 * Usage: node scripts/test-split-detection.js <book_id> [page_numbers...]
 */

const sharp = require('sharp');

const API_BASE = 'https://sourcelibrary.org';

async function fetchBook(bookId) {
  const response = await fetch(`${API_BASE}/api/books/${bookId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// Inline the detection logic for testing (mirrors splitDetection.ts)
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

    let maxDarkRun = 0;
    let currentRun = 0;
    for (const p of pixels) {
      if (p < darkThreshold) {
        currentRun++;
        maxDarkRun = Math.max(maxDarkRun, currentRun);
      } else {
        currentRun = 0;
      }
    }

    let transitions = 0;
    for (let i = 1; i < pixels.length; i++) {
      const wasDark = pixels[i - 1] < darkThreshold;
      const isDark = pixels[i] < darkThreshold;
      if (wasDark !== isDark) transitions++;
    }

    const darkPixels = sorted.slice(0, Math.floor(height * 0.25));
    const darkMean = darkPixels.reduce((a, b) => a + b, 0) / darkPixels.length;
    const darkVariance = darkPixels.reduce((sum, v) => sum + Math.pow(v - darkMean, 2), 0) / darkPixels.length;

    columns.push({
      x,
      mean,
      min: sorted[0],
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

  let bestScore = -Infinity;
  let bestIdx = Math.floor(columns.length / 2);

  for (let i = searchStart; i < searchEnd; i++) {
    const col = columns[i];

    const p10Score = (255 - col.p10) / 2.55;
    const darkRunScore = col.maxDarkRun;
    const transitionScore = Math.max(0, 100 - col.transitions / 5);
    const consistencyScore = Math.max(0, 50 - col.darkStdDev);

    const score = p10Score * 0.3 + darkRunScore * 0.35 + transitionScore * 0.2 + consistencyScore * 0.15;

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return { position: bestIdx, score: bestScore, stats: columns[bestIdx] };
}

function detectTextAtPosition(columns, position, windowSize = 3) {
  const start = Math.max(0, position - windowSize);
  const end = Math.min(columns.length, position + windowSize + 1);
  const window = columns.slice(start, end);

  const avgTransitions = window.reduce((sum, c) => sum + c.transitions, 0) / window.length;
  const avgMaxDarkRun = window.reduce((sum, c) => sum + c.maxDarkRun, 0) / window.length;
  const avgDarkStdDev = window.reduce((sum, c) => sum + c.darkStdDev, 0) / window.length;

  // Check the split column itself
  const splitCol = columns[position];

  // Text detection: check if the split column shows text characteristics
  const hasHighTransitions = splitCol.transitions > 30 && avgTransitions > 40;
  const hasLowDarkRun = splitCol.maxDarkRun < 40 && avgMaxDarkRun < 50;
  const hasHighVariance = avgDarkStdDev > 30;

  const textSignals = [hasHighTransitions, hasLowDarkRun, hasHighVariance].filter(Boolean).length;

  return {
    hasText: textSignals >= 2,
    splitTransitions: splitCol.transitions,
    splitDarkRun: splitCol.maxDarkRun,
    avgTransitions,
    avgMaxDarkRun,
    avgDarkStdDev,
  };
}

async function testPage(page) {
  const imageUrl = page.photo_original || page.photo;
  const imageBuffer = await fetchImage(imageUrl);
  const metadata = await sharp(imageBuffer).metadata();

  const { data, info } = await sharp(imageBuffer)
    .resize(1000, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const aspectRatio = metadata.width / metadata.height;
  const columns = analyzeColumns(data, info.width, info.height);
  const gutter = findGutterPosition(columns);
  const textCheck = detectTextAtPosition(columns, gutter.position);

  const splitPercent = (gutter.position / columns.length * 100).toFixed(1);
  const splitPosition = Math.round(gutter.position / columns.length * 1000);

  let confidence = 'medium';
  if (aspectRatio > 1.1 && gutter.score > 50 && !textCheck.hasText) {
    confidence = 'high';
  } else if (aspectRatio < 1.0 || gutter.score < 30 || textCheck.hasText) {
    confidence = 'low';
  }

  return {
    page: page.page_number,
    aspectRatio: aspectRatio.toFixed(3),
    isTwoPage: aspectRatio > 1.0,
    splitPercent,
    splitPosition,
    gutterScore: gutter.score.toFixed(1),
    maxDarkRun: gutter.stats.maxDarkRun.toFixed(1),
    transitions: gutter.stats.transitions,
    hasText: textCheck.hasText,
    textMetrics: {
      avgTransitions: textCheck.avgTransitions.toFixed(0),
      avgDarkRun: textCheck.avgMaxDarkRun.toFixed(1),
      avgDarkStdDev: textCheck.avgDarkStdDev.toFixed(1),
    },
    confidence,
  };
}

async function main() {
  const bookId = process.argv[2];
  if (!bookId) {
    console.error('Usage: node scripts/test-split-detection.js <book_id> [page_numbers...]');
    process.exit(1);
  }

  const specificPages = process.argv.slice(3).map(n => parseInt(n, 10)).filter(n => !isNaN(n));

  console.log('Fetching book...');
  const book = await fetchBook(bookId);
  console.log(`Book: ${book.title}\n`);

  let samples;
  if (specificPages.length > 0) {
    samples = specificPages.map(num => book.pages.find(p => p.page_number === num)).filter(Boolean);
  } else {
    samples = book.pages.filter(p => !p.split_from && !p.crop).slice(0, 10);
  }

  console.log('Testing split detection...\n');
  console.log('Page | Aspect | 2-Page | Split% | Split(0-1000) | Score | DarkRun | Trans | Text? | Conf');
  console.log('-----|--------|--------|--------|---------------|-------|---------|-------|-------|------');

  for (const page of samples) {
    try {
      const result = await testPage(page);
      console.log(
        `${String(result.page).padStart(4)} | ` +
        `${result.aspectRatio} | ` +
        `${result.isTwoPage ? '  YES  ' : '  NO   '} | ` +
        `${result.splitPercent.padStart(5)}% | ` +
        `${String(result.splitPosition).padStart(13)} | ` +
        `${result.gutterScore.padStart(5)} | ` +
        `${result.maxDarkRun.padStart(6)}% | ` +
        `${String(result.transitions).padStart(5)} | ` +
        `${result.hasText ? ' YES ' : '  NO  '} | ` +
        `${result.confidence}`
      );
    } catch (err) {
      console.log(`${String(page.page_number).padStart(4)} | ERROR: ${err.message}`);
    }
  }

  console.log('\n✓ Done');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
