#!/usr/bin/env node
/**
 * Analyze vertical gutter patterns in scanned book pages
 *
 * Usage:
 *   node scripts/analyze-gutter.js <book_id>
 *   node scripts/analyze-gutter.js 6909cfe3cf28baa1b4caff19
 *
 * This script:
 * 1. Fetches pages from a book via the API
 * 2. Downloads sample images (unsplit two-page spreads)
 * 3. Analyzes vertical intensity profiles to find gutter patterns
 * 4. Outputs data files and a visualization HTML
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const API_BASE = 'https://sourcelibrary.org';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'gutter-analysis');
const SAMPLE_COUNT = 5; // Number of pages to analyze
const ANALYSIS_WIDTH = 1000; // Normalize all images to this width for consistent analysis

async function fetchBook(bookId) {
  console.log(`Fetching book ${bookId}...`);
  const response = await fetch(`${API_BASE}/api/books/${bookId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  return response.json();
}

async function fetchImage(url) {
  console.log(`  Downloading: ${url.split('/').pop().slice(0, 40)}...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Analyze vertical intensity profile across the image
 * Returns an array of average brightness values for each vertical column
 */
async function analyzeVerticalProfile(imageBuffer) {
  // Get raw pixel data, normalized to analysis width
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const profile = [];

  // For each column, calculate average brightness
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y < height; y++) {
      sum += data[y * width + x];
    }
    profile.push(sum / height);
  }

  return { profile, width, height };
}

/**
 * Analyze a specific vertical strip (e.g., center 20% of image)
 * Returns detailed stats about that region
 */
async function analyzeRegion(imageBuffer, startPercent, endPercent) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const startX = Math.floor(width * startPercent / 100);
  const endX = Math.floor(width * endPercent / 100);

  const columnStats = [];

  for (let x = startX; x < endX; x++) {
    const values = [];
    for (let y = 0; y < height; y++) {
      values.push(data[y * width + x]);
    }

    // Calculate stats for this column
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const min = Math.min(...values);
    const max = Math.max(...values);

    columnStats.push({
      x,
      relativeX: ((x - startX) / (endX - startX) * 100).toFixed(1),
      mean: mean.toFixed(1),
      stdDev: stdDev.toFixed(1),
      min,
      max,
      range: max - min
    });
  }

  return columnStats;
}

/**
 * Find the darkest vertical column in a region (likely the gutter)
 */
function findDarkestColumn(profile, startPercent = 40, endPercent = 60) {
  const startIdx = Math.floor(profile.length * startPercent / 100);
  const endIdx = Math.floor(profile.length * endPercent / 100);

  let minVal = Infinity;
  let minIdx = startIdx;

  for (let i = startIdx; i < endIdx; i++) {
    if (profile[i] < minVal) {
      minVal = profile[i];
      minIdx = i;
    }
  }

  return {
    index: minIdx,
    position: (minIdx / profile.length * 100).toFixed(2),
    brightness: minVal.toFixed(1)
  };
}

/**
 * Find local minimum using smoothed profile (to avoid noise)
 */
function findGutterWithSmoothing(profile, windowSize = 20) {
  // Apply moving average smoothing
  const smoothed = [];
  for (let i = 0; i < profile.length; i++) {
    const start = Math.max(0, i - windowSize);
    const end = Math.min(profile.length, i + windowSize + 1);
    const sum = profile.slice(start, end).reduce((a, b) => a + b, 0);
    smoothed.push(sum / (end - start));
  }

  // Find minimum in center region (40-60%)
  const startIdx = Math.floor(profile.length * 0.4);
  const endIdx = Math.floor(profile.length * 0.6);

  let minVal = Infinity;
  let minIdx = startIdx;

  for (let i = startIdx; i < endIdx; i++) {
    if (smoothed[i] < minVal) {
      minVal = smoothed[i];
      minIdx = i;
    }
  }

  return {
    index: minIdx,
    position: (minIdx / profile.length * 100).toFixed(2),
    brightness: minVal.toFixed(1),
    smoothedProfile: smoothed
  };
}

/**
 * Detect edges using gradient (where brightness changes rapidly)
 */
function findEdges(profile) {
  const gradients = [];
  for (let i = 1; i < profile.length - 1; i++) {
    // Central difference gradient
    gradients.push(Math.abs(profile[i + 1] - profile[i - 1]) / 2);
  }

  // Find peaks in gradient (edges) in center region
  const startIdx = Math.floor(profile.length * 0.35);
  const endIdx = Math.floor(profile.length * 0.65);

  const edges = [];
  for (let i = startIdx; i < endIdx; i++) {
    if (i > 0 && i < gradients.length - 1) {
      if (gradients[i] > gradients[i-1] && gradients[i] > gradients[i+1] && gradients[i] > 5) {
        edges.push({
          index: i,
          position: (i / profile.length * 100).toFixed(2),
          gradient: gradients[i].toFixed(2)
        });
      }
    }
  }

  return { gradients, edges };
}

function generateHTML(results) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Gutter Analysis Results</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui; max-width: 1400px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1 { color: #333; }
    .page-analysis { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin: 15px 0; }
    .stat { background: #f0f0f0; padding: 10px; border-radius: 4px; }
    .stat-label { font-size: 12px; color: #666; }
    .stat-value { font-size: 18px; font-weight: bold; color: #333; }
    .chart-container { height: 300px; margin: 20px 0; }
    .thumbnail { max-width: 400px; border: 1px solid #ddd; }
    .gutter-marker { color: #e74c3c; font-weight: bold; }
    .summary { background: #e8f4e8; padding: 20px; border-radius: 8px; margin-bottom: 20px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
  </style>
</head>
<body>
  <h1>Gutter Analysis Results</h1>

  <div class="summary">
    <h2>Summary</h2>
    <p>Analyzed ${results.length} pages. Detected gutter positions:</p>
    <table>
      <tr>
        <th>Page</th>
        <th>Raw Darkest</th>
        <th>Smoothed Min</th>
        <th>Brightness</th>
        <th>Edge Count</th>
      </tr>
      ${results.map(r => `
        <tr>
          <td>Page ${r.pageNumber}</td>
          <td>${r.darkestColumn.position}%</td>
          <td>${r.smoothedGutter.position}%</td>
          <td>${r.smoothedGutter.brightness}</td>
          <td>${r.edges.length}</td>
        </tr>
      `).join('')}
    </table>
    <p><strong>Average gutter position:</strong> ${(results.reduce((sum, r) => sum + parseFloat(r.smoothedGutter.position), 0) / results.length).toFixed(2)}%</p>
  </div>

  ${results.map((result, idx) => `
  <div class="page-analysis">
    <div class="page-header">
      <h2>Page ${result.pageNumber}</h2>
      <span class="gutter-marker">Detected gutter: ${result.smoothedGutter.position}%</span>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-label">Raw Darkest Column</div>
        <div class="stat-value">${result.darkestColumn.position}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Smoothed Minimum</div>
        <div class="stat-value">${result.smoothedGutter.position}%</div>
      </div>
      <div class="stat">
        <div class="stat-label">Gutter Brightness</div>
        <div class="stat-value">${result.smoothedGutter.brightness}</div>
      </div>
      <div class="stat">
        <div class="stat-label">Edges Detected</div>
        <div class="stat-value">${result.edges.length}</div>
      </div>
    </div>

    <img src="page-${result.pageNumber}-thumb.jpg" class="thumbnail" alt="Page ${result.pageNumber}">

    <div class="chart-container">
      <canvas id="chart-${idx}"></canvas>
    </div>
  </div>
  `).join('')}

  <script>
    const results = ${JSON.stringify(results)};

    results.forEach((result, idx) => {
      const ctx = document.getElementById('chart-' + idx).getContext('2d');

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: result.profile.map((_, i) => (i / result.profile.length * 100).toFixed(0) + '%'),
          datasets: [
            {
              label: 'Raw Profile',
              data: result.profile,
              borderColor: 'rgba(100, 100, 100, 0.3)',
              borderWidth: 1,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'Smoothed Profile',
              data: result.smoothedProfile,
              borderColor: 'rgb(54, 162, 235)',
              borderWidth: 2,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Vertical Brightness Profile (left to right)' },
            annotation: {
              annotations: {
                gutterLine: {
                  type: 'line',
                  xMin: result.smoothedGutter.index,
                  xMax: result.smoothedGutter.index,
                  borderColor: 'red',
                  borderWidth: 2,
                  label: { display: true, content: 'Gutter' }
                }
              }
            }
          },
          scales: {
            x: {
              display: true,
              title: { display: true, text: 'Position (% from left)' },
              ticks: { maxTicksLimit: 20 }
            },
            y: {
              display: true,
              title: { display: true, text: 'Brightness (0=black, 255=white)' },
              min: 0,
              max: 255
            }
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
    console.error('Usage: node scripts/analyze-gutter.js <book_id>');
    console.error('Example: node scripts/analyze-gutter.js 6909cfe3cf28baa1b4caff19');
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== Gutter Analysis ===\n');

  // Fetch book data
  const book = await fetchBook(bookId);
  console.log(`Book: ${book.title}`);
  console.log(`Total pages: ${book.pages?.length || 0}\n`);

  // Filter to unsplit pages only (pages that might be two-page spreads)
  // These are pages without split_from and without crop data
  const unsplitPages = (book.pages || []).filter(p => !p.split_from && !p.crop);
  console.log(`Unsplit pages (potential two-page spreads): ${unsplitPages.length}\n`);

  if (unsplitPages.length === 0) {
    console.log('No unsplit pages found. Looking at all pages...');
    unsplitPages.push(...(book.pages || []).slice(0, SAMPLE_COUNT));
  }

  // Sample evenly across the book
  const step = Math.max(1, Math.floor(unsplitPages.length / SAMPLE_COUNT));
  const samplesToAnalyze = [];
  for (let i = 0; i < unsplitPages.length && samplesToAnalyze.length < SAMPLE_COUNT; i += step) {
    samplesToAnalyze.push(unsplitPages[i]);
  }

  console.log(`Analyzing ${samplesToAnalyze.length} sample pages...\n`);

  const results = [];

  for (const page of samplesToAnalyze) {
    console.log(`\nAnalyzing Page ${page.page_number}:`);

    try {
      // Use original photo if available
      const imageUrl = page.photo_original || page.photo;
      const imageBuffer = await fetchImage(imageUrl);

      // Get image metadata
      const metadata = await sharp(imageBuffer).metadata();
      console.log(`  Dimensions: ${metadata.width}x${metadata.height}`);

      // Analyze vertical profile
      const { profile, width, height } = await analyzeVerticalProfile(imageBuffer);
      console.log(`  Profile points: ${profile.length}`);

      // Find darkest column (raw)
      const darkestColumn = findDarkestColumn(profile);
      console.log(`  Raw darkest: ${darkestColumn.position}% (brightness: ${darkestColumn.brightness})`);

      // Find gutter with smoothing
      const smoothedGutter = findGutterWithSmoothing(profile);
      console.log(`  Smoothed minimum: ${smoothedGutter.position}% (brightness: ${smoothedGutter.brightness})`);

      // Find edges
      const { gradients, edges } = findEdges(profile);
      console.log(`  Edges found: ${edges.length}`);
      if (edges.length > 0) {
        console.log(`  Edge positions: ${edges.map(e => e.position + '%').join(', ')}`);
      }

      // Save thumbnail
      const thumbnail = await sharp(imageBuffer)
        .resize(800, null, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();
      fs.writeFileSync(path.join(OUTPUT_DIR, `page-${page.page_number}-thumb.jpg`), thumbnail);

      results.push({
        pageNumber: page.page_number,
        pageId: page.id || page._id,
        dimensions: { width: metadata.width, height: metadata.height },
        profile,
        smoothedProfile: smoothedGutter.smoothedProfile,
        darkestColumn,
        smoothedGutter,
        edges,
        gradients
      });

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
    }
  }

  // Generate HTML visualization
  const html = generateHTML(results);
  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);

  // Save raw data as JSON
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'analysis-data.json'),
    JSON.stringify(results, null, 2)
  );

  console.log('\n=== Analysis Complete ===');
  console.log(`Results saved to: ${OUTPUT_DIR}`);
  console.log(`View: http://localhost:3000/gutter-analysis/index.html`);
  console.log('\nOr open directly: file://' + path.join(OUTPUT_DIR, 'index.html'));
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
