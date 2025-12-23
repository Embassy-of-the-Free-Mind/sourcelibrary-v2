#!/usr/bin/env node
/**
 * Enhanced Gutter Analysis v2
 *
 * Analyzes scanned book pages to develop rule-based heuristics for:
 * 1. Detecting if a page is a two-page spread vs single page
 * 2. Finding the optimal split position for two-page spreads
 *
 * Usage:
 *   node scripts/analyze-gutter-v2.js <book_id>
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://sourcelibrary-v2.vercel.app';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'gutter-analysis-v2');
const SAMPLE_COUNT = 8;
const ANALYSIS_WIDTH = 1000;

async function fetchBook(bookId) {
  console.log(`Fetching book ${bookId}...`);
  const response = await fetch(`${API_BASE}/api/books/${bookId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(url) {
  console.log(`  Downloading: ${url.split('/').pop().slice(0, 40)}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Detect black borders and find content region
 * Returns { left, right } as percentages of image width
 */
async function detectContentRegion(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const DARK_THRESHOLD = 40; // Pixels darker than this are considered "black border"
  const CONTENT_THRESHOLD = 0.3; // 30% of column must be light to be "content"

  // Analyze each column from left
  let leftEdge = 0;
  for (let x = 0; x < width * 0.3; x++) { // Only check first 30%
    let lightPixels = 0;
    for (let y = 0; y < height; y++) {
      if (data[y * width + x] > DARK_THRESHOLD) lightPixels++;
    }
    if (lightPixels / height > CONTENT_THRESHOLD) {
      leftEdge = x;
      break;
    }
  }

  // Analyze each column from right
  let rightEdge = width - 1;
  for (let x = width - 1; x > width * 0.7; x--) { // Only check last 30%
    let lightPixels = 0;
    for (let y = 0; y < height; y++) {
      if (data[y * width + x] > DARK_THRESHOLD) lightPixels++;
    }
    if (lightPixels / height > CONTENT_THRESHOLD) {
      rightEdge = x;
      break;
    }
  }

  return {
    leftPercent: (leftEdge / width * 100).toFixed(1),
    rightPercent: (rightEdge / width * 100).toFixed(1),
    contentWidthPercent: ((rightEdge - leftEdge) / width * 100).toFixed(1),
    leftPx: leftEdge,
    rightPx: rightEdge
  };
}

/**
 * Analyze vertical intensity profile within content region
 */
async function analyzeVerticalProfile(imageBuffer, contentRegion) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const startX = contentRegion?.leftPx || 0;
  const endX = contentRegion?.rightPx || width;

  const profile = [];
  for (let x = startX; x < endX; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += data[y * width + x];
    }
    profile.push({
      x,
      relativeX: (x - startX) / (endX - startX), // 0-1 within content region
      brightness: sum / height
    });
  }

  return profile;
}

/**
 * Find gutter using multiple methods and score each
 */
function findGutter(profile) {
  // Method 1: Simple minimum in center region (40-60% of content)
  const centerStart = Math.floor(profile.length * 0.4);
  const centerEnd = Math.floor(profile.length * 0.6);

  let minBrightness = Infinity;
  let minIdx = centerStart;
  for (let i = centerStart; i < centerEnd; i++) {
    if (profile[i].brightness < minBrightness) {
      minBrightness = profile[i].brightness;
      minIdx = i;
    }
  }
  const simpleMin = {
    index: minIdx,
    position: profile[minIdx].relativeX,
    brightness: minBrightness
  };

  // Method 2: Smoothed minimum (moving average with window=30)
  const windowSize = 30;
  const smoothed = profile.map((p, i) => {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(profile.length, i + windowSize + 1);
    const slice = profile.slice(start, end);
    const avg = slice.reduce((sum, pt) => sum + pt.brightness, 0) / slice.length;
    return { ...p, smoothedBrightness: avg };
  });

  let smoothedMinBrightness = Infinity;
  let smoothedMinIdx = centerStart;
  for (let i = centerStart; i < centerEnd; i++) {
    if (smoothed[i].smoothedBrightness < smoothedMinBrightness) {
      smoothedMinBrightness = smoothed[i].smoothedBrightness;
      smoothedMinIdx = i;
    }
  }
  const smoothedMin = {
    index: smoothedMinIdx,
    position: smoothed[smoothedMinIdx].relativeX,
    brightness: smoothedMinBrightness
  };

  // Method 3: Gradient-based (find where brightness changes most rapidly)
  const gradients = [];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const gradient = Math.abs(smoothed[i + 1].smoothedBrightness - smoothed[i - 1].smoothedBrightness) / 2;
    gradients.push({ index: i, gradient, relativeX: profile[i].relativeX });
  }

  // Find paired edges (left-drop and right-rise) around the center
  const leftRegion = gradients.filter(g => g.relativeX > 0.35 && g.relativeX < 0.5);
  const rightRegion = gradients.filter(g => g.relativeX > 0.5 && g.relativeX < 0.65);

  const leftPeak = leftRegion.reduce((max, g) => g.gradient > max.gradient ? g : max, { gradient: 0 });
  const rightPeak = rightRegion.reduce((max, g) => g.gradient > max.gradient ? g : max, { gradient: 0 });

  const gradientGutter = leftPeak.gradient > 0 && rightPeak.gradient > 0
    ? { position: (leftPeak.relativeX + rightPeak.relativeX) / 2, leftEdge: leftPeak.relativeX, rightEdge: rightPeak.relativeX }
    : null;

  // Method 4: Valley detection - look for a "U" shaped dip
  // Calculate how much darker the center is compared to surroundings
  const leftAvg = profile.slice(0, Math.floor(profile.length * 0.35))
    .reduce((sum, p) => sum + p.brightness, 0) / (profile.length * 0.35);
  const rightAvg = profile.slice(Math.floor(profile.length * 0.65))
    .reduce((sum, p) => sum + p.brightness, 0) / (profile.length * 0.35);
  const centerAvg = profile.slice(centerStart, centerEnd)
    .reduce((sum, p) => sum + p.brightness, 0) / (centerEnd - centerStart);

  const valleyDepth = ((leftAvg + rightAvg) / 2) - centerAvg;
  const valleyScore = valleyDepth / ((leftAvg + rightAvg) / 2) * 100; // Percentage darker

  return {
    simpleMin,
    smoothedMin,
    gradientGutter,
    valleyAnalysis: {
      leftAvgBrightness: leftAvg.toFixed(1),
      rightAvgBrightness: rightAvg.toFixed(1),
      centerAvgBrightness: centerAvg.toFixed(1),
      valleyDepth: valleyDepth.toFixed(1),
      valleyScorePercent: valleyScore.toFixed(2)
    },
    smoothedProfile: smoothed.map(s => s.smoothedBrightness)
  };
}

/**
 * Determine if image is a two-page spread based on multiple signals
 */
function classifySpread(metadata, contentRegion, gutterAnalysis) {
  const aspectRatio = metadata.width / metadata.height;
  const valleyScore = parseFloat(gutterAnalysis.valleyAnalysis.valleyScorePercent);

  const signals = {
    // Aspect ratio: > 1.0 suggests two-page spread
    aspectRatio: {
      value: aspectRatio.toFixed(3),
      score: aspectRatio > 1.0 ? 1 : (aspectRatio > 0.9 ? 0.5 : 0),
      reason: aspectRatio > 1.0 ? 'Landscape (likely spread)' : 'Portrait (likely single)'
    },
    // Valley depth: deeper valley = more likely gutter shadow
    valleyDepth: {
      value: valleyScore.toFixed(2) + '%',
      score: valleyScore > 5 ? 1 : (valleyScore > 2 ? 0.5 : 0),
      reason: valleyScore > 5 ? 'Strong gutter shadow' : (valleyScore > 2 ? 'Weak gutter signal' : 'No gutter detected')
    },
    // Content region: if content doesn't span full width, may indicate structure
    contentWidth: {
      value: contentRegion.contentWidthPercent + '%',
      score: parseFloat(contentRegion.contentWidthPercent) < 95 ? 0.5 : 0,
      reason: 'Content region analysis'
    }
  };

  const totalScore = signals.aspectRatio.score + signals.valleyDepth.score + signals.contentWidth.score;
  const isTwoPageSpread = totalScore >= 1.5;

  return {
    isTwoPageSpread,
    confidence: totalScore >= 2 ? 'high' : (totalScore >= 1 ? 'medium' : 'low'),
    totalScore,
    signals
  };
}

function generateHTML(results) {
  const summaryRows = results.map(r => `
    <tr class="${r.classification.isTwoPageSpread ? 'spread' : 'single'}">
      <td>Page ${r.pageNumber}</td>
      <td>${r.metadata.width}x${r.metadata.height}</td>
      <td>${r.classification.signals.aspectRatio.value}</td>
      <td>${r.classification.isTwoPageSpread ? 'Two-Page Spread' : 'Single Page'}</td>
      <td>${r.classification.confidence}</td>
      <td>${r.classification.isTwoPageSpread ? (r.gutterAnalysis.smoothedMin.position * 100).toFixed(1) + '%' : 'N/A'}</td>
      <td>${r.gutterAnalysis.valleyAnalysis.valleyScorePercent}%</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>Gutter Analysis v2</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui; max-width: 1600px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1, h2, h3 { color: #333; }
    .summary { background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f0f0f0; }
    tr.spread { background: #e8f4e8; }
    tr.single { background: #f4f4e8; }
    .page-card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .page-grid { display: grid; grid-template-columns: 400px 1fr; gap: 20px; }
    .thumbnail { max-width: 100%; border: 1px solid #ddd; }
    .signals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 15px 0; }
    .signal { background: #f5f5f5; padding: 10px; border-radius: 4px; }
    .signal.good { background: #d4edda; }
    .signal.medium { background: #fff3cd; }
    .signal.low { background: #f8f9fa; }
    .chart-container { height: 250px; }
    .gutter-line { position: absolute; background: red; width: 2px; top: 0; bottom: 0; }
    .image-wrapper { position: relative; display: inline-block; }
    .heuristics { background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>Gutter Analysis v2 - Rule-Based Heuristics</h1>

  <div class="heuristics">
    <h2>Proposed Heuristics</h2>
    <h3>1. Two-Page Spread Detection</h3>
    <pre><code>function isTwoPageSpread(image) {
  const aspectRatio = image.width / image.height;

  // Primary signal: aspect ratio
  if (aspectRatio > 1.1) return { isSpread: true, confidence: 'high' };
  if (aspectRatio < 0.8) return { isSpread: false, confidence: 'high' };

  // Secondary signal: gutter valley depth
  const valleyScore = analyzeGutterValley(image);
  if (valleyScore > 5) return { isSpread: true, confidence: 'medium' };

  return { isSpread: false, confidence: 'low' };
}</code></pre>

    <h3>2. Split Position Detection</h3>
    <pre><code>function findSplitPosition(image) {
  // 1. Detect content region (exclude black borders)
  const { left, right } = detectContentRegion(image);

  // 2. Analyze brightness profile in center 40-60%
  const profile = getVerticalBrightnessProfile(image, left, right);
  const centerRegion = profile.slice(0.4 * profile.length, 0.6 * profile.length);

  // 3. Apply smoothing (window=30) and find minimum
  const smoothed = movingAverage(centerRegion, 30);
  const gutterIdx = findMinimum(smoothed);

  // 4. Convert to 0-1000 scale
  return Math.round(gutterIdx / profile.length * 1000);
}</code></pre>
  </div>

  <div class="summary">
    <h2>Analysis Summary</h2>
    <table>
      <tr>
        <th>Page</th>
        <th>Dimensions</th>
        <th>Aspect Ratio</th>
        <th>Classification</th>
        <th>Confidence</th>
        <th>Gutter Position</th>
        <th>Valley Score</th>
      </tr>
      ${summaryRows}
    </table>
  </div>

  ${results.map((r, idx) => `
  <div class="page-card">
    <h2>Page ${r.pageNumber} - ${r.classification.isTwoPageSpread ? 'Two-Page Spread' : 'Single Page'}</h2>

    <div class="signals">
      <div class="signal ${r.classification.signals.aspectRatio.score >= 1 ? 'good' : (r.classification.signals.aspectRatio.score >= 0.5 ? 'medium' : 'low')}">
        <strong>Aspect Ratio</strong><br>
        ${r.classification.signals.aspectRatio.value}<br>
        <small>${r.classification.signals.aspectRatio.reason}</small>
      </div>
      <div class="signal ${r.classification.signals.valleyDepth.score >= 1 ? 'good' : (r.classification.signals.valleyDepth.score >= 0.5 ? 'medium' : 'low')}">
        <strong>Valley Depth</strong><br>
        ${r.classification.signals.valleyDepth.value}<br>
        <small>${r.classification.signals.valleyDepth.reason}</small>
      </div>
      <div class="signal">
        <strong>Content Region</strong><br>
        ${r.contentRegion.leftPercent}% - ${r.contentRegion.rightPercent}%<br>
        <small>Width: ${r.contentRegion.contentWidthPercent}%</small>
      </div>
    </div>

    <div class="page-grid">
      <div>
        <div class="image-wrapper">
          <img src="page-${r.pageNumber}-thumb.jpg" class="thumbnail" alt="Page ${r.pageNumber}">
          ${r.classification.isTwoPageSpread ? `<div class="gutter-line" style="left: ${r.gutterAnalysis.smoothedMin.position * 100}%"></div>` : ''}
        </div>
        <p><strong>Detected gutter:</strong> ${(r.gutterAnalysis.smoothedMin.position * 100).toFixed(1)}% from content left</p>
      </div>
      <div>
        <div class="chart-container">
          <canvas id="chart-${idx}"></canvas>
        </div>
      </div>
    </div>
  </div>
  `).join('')}

  <script>
    const results = ${JSON.stringify(results.map(r => ({
      pageNumber: r.pageNumber,
      profile: r.profile.map(p => p.brightness),
      smoothedProfile: r.gutterAnalysis.smoothedProfile,
      gutterPosition: r.gutterAnalysis.smoothedMin.position
    })))};

    results.forEach((result, idx) => {
      const ctx = document.getElementById('chart-' + idx).getContext('2d');
      const labels = result.profile.map((_, i) => (i / result.profile.length * 100).toFixed(0));

      new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Raw', data: result.profile, borderColor: 'rgba(150,150,150,0.4)', borderWidth: 1, pointRadius: 0 },
            { label: 'Smoothed', data: result.smoothedProfile, borderColor: 'rgb(54,162,235)', borderWidth: 2, pointRadius: 0 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Brightness Profile (within content region)' } },
          scales: {
            x: { title: { display: true, text: 'Position %' }, ticks: { maxTicksLimit: 10 } },
            y: { title: { display: true, text: 'Brightness' }, min: 0, max: 255 }
          }
        }
      });
    });
  </script>
</body>
</html>`;
}

async function main() {
  const bookId = process.argv[2];
  if (!bookId) {
    console.error('Usage: node scripts/analyze-gutter-v2.js <book_id>');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== Gutter Analysis v2 ===\n');

  const book = await fetchBook(bookId);
  console.log(`Book: ${book.title}`);
  console.log(`Total pages: ${book.pages?.length || 0}\n`);

  // Get mix of unsplit and already-split pages for comparison
  const unsplitPages = (book.pages || []).filter(p => !p.split_from && !p.crop);
  const allPages = book.pages || [];

  // Sample: first few pages + some from middle + some from end
  const samples = [
    ...allPages.slice(0, 3),
    ...unsplitPages.slice(Math.floor(unsplitPages.length / 2), Math.floor(unsplitPages.length / 2) + 2),
    ...unsplitPages.slice(-3)
  ].slice(0, SAMPLE_COUNT);

  // Remove duplicates
  const uniqueSamples = [...new Map(samples.map(p => [p.page_number, p])).values()];

  console.log(`Analyzing ${uniqueSamples.length} sample pages...\n`);

  const results = [];

  for (const page of uniqueSamples) {
    console.log(`\nPage ${page.page_number}:`);

    try {
      const imageUrl = page.photo_original || page.photo;
      const imageBuffer = await fetchImage(imageUrl);
      const metadata = await sharp(imageBuffer).metadata();
      console.log(`  Dimensions: ${metadata.width}x${metadata.height} (ratio: ${(metadata.width/metadata.height).toFixed(2)})`);

      // Detect content region (exclude black borders)
      const contentRegion = await detectContentRegion(imageBuffer);
      console.log(`  Content region: ${contentRegion.leftPercent}% - ${contentRegion.rightPercent}%`);

      // Analyze brightness profile
      const profile = await analyzeVerticalProfile(imageBuffer, contentRegion);

      // Find gutter using multiple methods
      const gutterAnalysis = findGutter(profile);
      console.log(`  Gutter (smoothed): ${(gutterAnalysis.smoothedMin.position * 100).toFixed(1)}%`);
      console.log(`  Valley score: ${gutterAnalysis.valleyAnalysis.valleyScorePercent}%`);

      // Classify spread vs single
      const classification = classifySpread(metadata, contentRegion, gutterAnalysis);
      console.log(`  Classification: ${classification.isTwoPageSpread ? 'TWO-PAGE SPREAD' : 'SINGLE PAGE'} (${classification.confidence})`);

      // Save thumbnail
      const thumb = await sharp(imageBuffer).resize(800, null, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      fs.writeFileSync(path.join(OUTPUT_DIR, `page-${page.page_number}-thumb.jpg`), thumb);

      results.push({
        pageNumber: page.page_number,
        pageId: page.id || page._id,
        metadata: { width: metadata.width, height: metadata.height },
        contentRegion,
        profile,
        gutterAnalysis,
        classification
      });

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
    }
  }

  // Generate outputs
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), generateHTML(results));
  fs.writeFileSync(path.join(OUTPUT_DIR, 'data.json'), JSON.stringify(results, null, 2));

  console.log('\n=== Complete ===');
  console.log(`View: http://localhost:3000/gutter-analysis-v2/index.html`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
