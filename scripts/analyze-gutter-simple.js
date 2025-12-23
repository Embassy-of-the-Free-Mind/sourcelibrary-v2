#!/usr/bin/env node
/**
 * Simple Gutter Analysis - generates CSV and basic HTML
 * Usage: node scripts/analyze-gutter-simple.js <book_id>
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://sourcelibrary-v2.vercel.app';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'gutter-analysis');
const ANALYSIS_WIDTH = 1000;

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

/**
 * Analyze image and return column statistics
 */
async function analyzeImage(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;

  // Calculate stats for each column
  const columns = [];
  for (let x = 0; x < width; x++) {
    const pixels = [];
    for (let y = 0; y < height; y++) {
      pixels.push(data[y * width + x]);
    }
    const sorted = [...pixels].sort((a, b) => a - b);
    const sum = pixels.reduce((a, b) => a + b, 0);
    const mean = sum / height;

    const variance = pixels.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / height;

    // Count pixels below darkness thresholds
    const darkThreshold = 180; // Pixels darker than this
    const veryDarkThreshold = 120;
    const darkCount = pixels.filter(p => p < darkThreshold).length;
    const veryDarkCount = pixels.filter(p => p < veryDarkThreshold).length;

    // Longest consecutive dark run (for detecting continuous gutter vs text gaps)
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

    // Count transitions (dark->light or light->dark) - text has many, gutter has few
    let transitions = 0;
    for (let i = 1; i < pixels.length; i++) {
      const wasDark = pixels[i-1] < darkThreshold;
      const isDark = pixels[i] < darkThreshold;
      if (wasDark !== isDark) transitions++;
    }

    // Variance in bottom 25% of pixels (how consistent are the dark pixels?)
    const darkPixels = sorted.slice(0, Math.floor(height * 0.25));
    const darkMean = darkPixels.reduce((a, b) => a + b, 0) / darkPixels.length;
    const darkVariance = darkPixels.reduce((sum, v) => sum + Math.pow(v - darkMean, 2), 0) / darkPixels.length;

    columns.push({
      x,
      mean,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      p10: sorted[Math.floor(height * 0.1)],
      p25: sorted[Math.floor(height * 0.25)],
      median: sorted[Math.floor(height * 0.5)],
      p75: sorted[Math.floor(height * 0.75)],
      p90: sorted[Math.floor(height * 0.9)],
      stdDev: Math.sqrt(variance),
      darkPercent: (darkCount / height * 100),        // % of column that's dark
      veryDarkPercent: (veryDarkCount / height * 100), // % that's very dark
      maxDarkRun: (maxDarkRun / height * 100),        // longest dark run as % of height
      transitions,                                      // # of dark/light transitions
      darkStdDev: Math.sqrt(darkVariance),            // consistency of dark pixels
    });
  }

  // Find darkest in center region (35-65%)
  const centerStart = Math.floor(width * 0.35);
  const centerEnd = Math.floor(width * 0.65);

  const findDarkest = (metric) => {
    let darkest = { value: Infinity, x: centerStart };
    for (let i = centerStart; i < centerEnd; i++) {
      if (columns[i][metric] < darkest.value) {
        darkest = { value: columns[i][metric], x: i };
      }
    }
    return { ...darkest, percent: (darkest.x / width * 100).toFixed(1) };
  };

  // Calculate histogram for center strip (40-60%)
  const histStart = Math.floor(width * 0.4);
  const histEnd = Math.floor(width * 0.6);
  const centerHist = new Array(256).fill(0);

  for (let x = histStart; x < histEnd; x++) {
    for (let y = 0; y < height; y++) {
      centerHist[data[y * width + x]]++;
    }
  }

  const totalPixels = (histEnd - histStart) * height;
  const centerHistPercent = centerHist.map(c => (c / totalPixels * 100).toFixed(3));

  return {
    width,
    height,
    columns,
    darkest: {
      mean: findDarkest('mean'),
      min: findDarkest('min'),
      p10: findDarkest('p10'),
      median: findDarkest('median'),
    },
    centerHistogram: centerHistPercent
  };
}

async function main() {
  const bookId = process.argv[2];
  if (!bookId) {
    console.error('Usage: node scripts/analyze-gutter-simple.js <book_id>');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('Fetching book...');
  const book = await fetchBook(bookId);
  console.log(`Book: ${book.title}\n`);

  // Check for specific page numbers as additional args
  const specificPages = process.argv.slice(3).map(n => parseInt(n, 10)).filter(n => !isNaN(n));

  let samples;
  if (specificPages.length > 0) {
    // Use specific page numbers
    samples = specificPages.map(num => book.pages.find(p => p.page_number === num)).filter(Boolean);
    console.log(`Using specific pages: ${specificPages.join(', ')}`);
  } else {
    // Default: unsplit pages
    const unsplitPages = (book.pages || []).filter(p => !p.split_from && !p.crop);
    samples = unsplitPages.slice(0, 7);
  }

  console.log(`Analyzing ${samples.length} pages...\n`);

  // CSV output
  const csvLines = ['page,width,height,aspect_ratio,darkest_mean_pos,darkest_min_pos,darkest_p10_pos,darkest_median_pos,darkest_mean_val,darkest_min_val'];

  // Collect all profiles for charting
  const allProfiles = [];
  const summaryData = [];

  for (const page of samples) {
    console.log(`Page ${page.page_number}...`);

    try {
      const imageUrl = page.photo_original || page.photo;
      const imageBuffer = await fetchImage(imageUrl);
      const metadata = await sharp(imageBuffer).metadata();
      const analysis = await analyzeImage(imageBuffer);

      const aspectRatio = (metadata.width / metadata.height).toFixed(3);

      csvLines.push([
        page.page_number,
        metadata.width,
        metadata.height,
        aspectRatio,
        analysis.darkest.mean.percent,
        analysis.darkest.min.percent,
        analysis.darkest.p10.percent,
        analysis.darkest.median.percent,
        analysis.darkest.mean.value.toFixed(1),
        analysis.darkest.min.value
      ].join(','));

      // Downsample profile for JSON (every 10th point)
      const sampledProfile = analysis.columns
        .filter((_, i) => i % 10 === 0)
        .map(c => ({
          x: (c.x / analysis.width * 100).toFixed(1),
          mean: Math.round(c.mean),
          min: c.min,
          max: c.max,
          p10: c.p10,
          p25: c.p25,
          median: Math.round(c.median),
          p75: c.p75,
          p90: c.p90,
          stdDev: Math.round(c.stdDev),
          range: c.max - c.min,
          darkPercent: Math.round(c.darkPercent * 10) / 10,
          veryDarkPercent: Math.round(c.veryDarkPercent * 10) / 10,
          maxDarkRun: Math.round(c.maxDarkRun * 10) / 10,
          transitions: c.transitions,
          darkStdDev: Math.round(c.darkStdDev * 10) / 10,
        }));

      allProfiles.push({
        page: page.page_number,
        profile: sampledProfile,
        histogram: analysis.centerHistogram.filter((_, i) => i % 4 === 0) // 64 bins
      });

      // Run split detection
      const columns = analysis.columns;
      const searchStart = Math.floor(columns.length * 0.35);
      const searchEnd = Math.floor(columns.length * 0.65);
      let bestScore = -Infinity, bestIdx = Math.floor(columns.length / 2);
      for (let i = searchStart; i < searchEnd; i++) {
        const col = columns[i];
        const score = (255 - col.p10) / 2.55 * 0.3 + col.maxDarkRun * 0.35 +
          Math.max(0, 100 - col.transitions / 5) * 0.2 + Math.max(0, 50 - col.stdDev) * 0.15;
        if (score > bestScore) { bestScore = score; bestIdx = i; }
      }
      const splitPercent = (bestIdx / columns.length * 100).toFixed(1);
      const splitPosition = Math.round(bestIdx / columns.length * 1000);

      // Text detection at split
      const splitCol = columns[bestIdx];
      const hasText = splitCol.transitions > 30 && splitCol.maxDarkRun < 40;

      summaryData.push({
        page: page.page_number,
        width: metadata.width,
        height: metadata.height,
        aspectRatio,
        darkest: analysis.darkest,
        split: {
          percent: splitPercent,
          position: splitPosition,
          score: bestScore.toFixed(1),
          darkRun: splitCol.maxDarkRun.toFixed(1),
          transitions: splitCol.transitions,
          hasText
        }
      });

      // Save thumbnail
      const thumb = await sharp(imageBuffer).resize(600, null, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      fs.writeFileSync(path.join(OUTPUT_DIR, `page-${page.page_number}-thumb.jpg`), thumb);

      console.log(`  Aspect: ${aspectRatio}, Darkest(mean): ${analysis.darkest.mean.percent}%, Darkest(min): ${analysis.darkest.min.percent}%`);

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
    }
  }

  // Write CSV
  fs.writeFileSync(path.join(OUTPUT_DIR, 'analysis.csv'), csvLines.join('\n'));
  console.log('\nCSV saved: analysis.csv');

  // Write JSON for charts
  fs.writeFileSync(path.join(OUTPUT_DIR, 'profiles.json'), JSON.stringify(allProfiles, null, 2));
  console.log('JSON saved: profiles.json');

  // Generate HTML
  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Gutter Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui; max-width: 1400px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    .card { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; text-align: left; border-bottom: 1px solid #ddd; }
    .chart-container { height: 350px; margin: 20px 0; }
    .thumbnails { display: flex; gap: 10px; flex-wrap: wrap; margin: 20px 0; }
    .thumbnails img { height: 200px; border: 1px solid #ddd; }
    .thumbnails-with-split { display: flex; gap: 15px; flex-wrap: wrap; margin: 20px 0; }
    .thumb-wrapper { position: relative; display: inline-block; }
    .thumb-wrapper img { height: 250px; border: 1px solid #ddd; display: block; }
    .split-line { position: absolute; top: 0; bottom: 25px; width: 3px; transform: translateX(-50%); opacity: 0.9; }
    .thumb-label { text-align: center; padding: 4px; font-size: 12px; font-weight: bold; background: #4caf50; color: white; }
    .thumb-label.warning { background: #ff9800; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  </style>
</head>
<body>
  <h1>Gutter Analysis</h1>

  <div class="card">
    <h2>Summary</h2>
    <table>
      <tr>
        <th>Page</th>
        <th>Dimensions</th>
        <th>Aspect</th>
        <th>Split Position</th>
        <th>Score</th>
        <th>Dark Run</th>
        <th>Transitions</th>
        <th>Text?</th>
      </tr>
      ${summaryData.map(d => `
      <tr style="background: ${d.split.hasText ? '#fff3e0' : '#e8f5e9'}">
        <td><strong>${d.page}</strong></td>
        <td>${d.width}x${d.height}</td>
        <td>${d.aspectRatio}</td>
        <td><strong>${d.split.percent}%</strong> (${d.split.position})</td>
        <td>${d.split.score}</td>
        <td>${d.split.darkRun}%</td>
        <td>${d.split.transitions}</td>
        <td>${d.split.hasText ? '⚠️ YES' : '✓ NO'}</td>
      </tr>
      `).join('')}
    </table>
  </div>

  <div class="card">
    <h2>Detected Split Lines</h2>
    <p>Red line = detected gutter position. Green = high confidence, Orange = text warning.</p>
    <div class="thumbnails-with-split">
      ${summaryData.map(d => `
        <div class="thumb-wrapper">
          <img src="page-${d.page}-thumb.jpg" title="Page ${d.page}">
          <div class="split-line" style="left: ${d.split.percent}%; background: ${d.split.hasText ? '#ff9800' : '#4caf50'};"></div>
          <div class="thumb-label ${d.split.hasText ? 'warning' : ''}">
            P${d.page}: ${d.split.percent}% ${d.split.hasText ? '⚠️' : '✓'}
          </div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="card">
    <h2>Average Brightness (Mean)</h2>
    <p>X: position across image (%), Y: mean brightness of column (0=black, 255=white)</p>
    <div class="chart-container">
      <canvas id="meanChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Peak Darkness (Min)</h2>
    <p>X: position (%), Y: darkest pixel in each column</p>
    <div class="chart-container">
      <canvas id="minChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Peak Lightness (Max)</h2>
    <p>X: position (%), Y: lightest pixel in each column</p>
    <div class="chart-container">
      <canvas id="maxChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>10th Percentile (P10)</h2>
    <p>X: position (%), Y: 10% of pixels are darker than this value</p>
    <div class="chart-container">
      <canvas id="p10Chart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>25th Percentile (P25)</h2>
    <p>X: position (%), Y: 25% of pixels are darker than this value</p>
    <div class="chart-container">
      <canvas id="p25Chart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Median (P50)</h2>
    <p>X: position (%), Y: median brightness of column</p>
    <div class="chart-container">
      <canvas id="medianChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>75th Percentile (P75)</h2>
    <p>X: position (%), Y: 75% of pixels are darker than this value</p>
    <div class="chart-container">
      <canvas id="p75Chart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>90th Percentile (P90)</h2>
    <p>X: position (%), Y: 90% of pixels are darker than this value</p>
    <div class="chart-container">
      <canvas id="p90Chart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Standard Deviation</h2>
    <p>X: position (%), Y: std dev of pixel values in column (higher = more variance)</p>
    <div class="chart-container">
      <canvas id="stdDevChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Range (Max - Min)</h2>
    <p>X: position (%), Y: difference between lightest and darkest pixel in column</p>
    <div class="chart-container">
      <canvas id="rangeChart"></canvas>
    </div>
  </div>

  <div class="card" style="background: #ffe8e8;">
    <h2>🎯 Dark Pixel % (< 180)</h2>
    <p>X: position (%), Y: percentage of pixels in column darker than 180. <b>Gutter = high % consistently dark</b></p>
    <div class="chart-container">
      <canvas id="darkPercentChart"></canvas>
    </div>
  </div>

  <div class="card" style="background: #ffe8e8;">
    <h2>🎯 Very Dark Pixel % (< 120)</h2>
    <p>X: position (%), Y: percentage of pixels in column darker than 120</p>
    <div class="chart-container">
      <canvas id="veryDarkPercentChart"></canvas>
    </div>
  </div>

  <div class="card" style="background: #e8ffe8;">
    <h2>🎯 Max Dark Run Length</h2>
    <p>X: position (%), Y: longest consecutive dark run as % of column height. <b>Gutter = long continuous dark, Text = short runs with gaps</b></p>
    <div class="chart-container">
      <canvas id="maxDarkRunChart"></canvas>
    </div>
  </div>

  <div class="card" style="background: #e8ffe8;">
    <h2>🎯 Dark/Light Transitions</h2>
    <p>X: position (%), Y: number of transitions between dark and light. <b>Text = many transitions, Gutter = few transitions</b></p>
    <div class="chart-container">
      <canvas id="transitionsChart"></canvas>
    </div>
  </div>

  <div class="card" style="background: #e8e8ff;">
    <h2>🎯 Dark Pixel Consistency (Std Dev)</h2>
    <p>X: position (%), Y: std dev of darkest 25% pixels. <b>Low = uniform darkness (gutter), High = varied (text)</b></p>
    <div class="chart-container">
      <canvas id="darkStdDevChart"></canvas>
    </div>
  </div>

  <div class="card">
    <h2>Center Region Histogram</h2>
    <p>Brightness distribution in center 20% of each image</p>
    <div class="chart-container">
      <canvas id="histChart"></canvas>
    </div>
  </div>

  <script>
    fetch('profiles.json')
      .then(r => r.json())
      .then(data => {
        const colors = ['#e74c3c', '#3498db', '#2ecc71', '#9b59b6', '#f39c12', '#1abc9c', '#e91e63'];
        const labels = data[0].profile.map(p => p.x);

        function createChart(canvasId, metric, title, yMin = 0, yMax = 255) {
          new Chart(document.getElementById(canvasId), {
            type: 'line',
            data: {
              labels,
              datasets: data.map((d, i) => ({
                label: 'Page ' + d.page,
                data: d.profile.map(p => p[metric]),
                borderColor: colors[i % colors.length],
                borderWidth: 2,
                pointRadius: 0,
                fill: false
              }))
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { position: 'top' } },
              scales: {
                x: { title: { display: true, text: 'Position (%)' } },
                y: { title: { display: true, text: title }, min: yMin, max: yMax }
              }
            }
          });
        }

        // Create all charts
        createChart('meanChart', 'mean', 'Brightness (0-255)');
        createChart('minChart', 'min', 'Brightness (0-255)');
        createChart('maxChart', 'max', 'Brightness (0-255)');
        createChart('p10Chart', 'p10', 'Brightness (0-255)');
        createChart('p25Chart', 'p25', 'Brightness (0-255)');
        createChart('medianChart', 'median', 'Brightness (0-255)');
        createChart('p75Chart', 'p75', 'Brightness (0-255)');
        createChart('p90Chart', 'p90', 'Brightness (0-255)');
        createChart('stdDevChart', 'stdDev', 'Std Dev', 0, 100);
        createChart('rangeChart', 'range', 'Range (max-min)', 0, 255);

        // New gutter-detection charts
        createChart('darkPercentChart', 'darkPercent', '% Dark Pixels', 0, 100);
        createChart('veryDarkPercentChart', 'veryDarkPercent', '% Very Dark', 0, 50);
        createChart('maxDarkRunChart', 'maxDarkRun', '% of Height', 0, 100);
        createChart('transitionsChart', 'transitions', '# Transitions', 0, null);
        createChart('darkStdDevChart', 'darkStdDev', 'Std Dev', 0, 50);

        // Histogram chart
        new Chart(document.getElementById('histChart'), {
          type: 'line',
          data: {
            labels: Array.from({length: 64}, (_, i) => i * 4),
            datasets: data.map((d, i) => ({
              label: 'Page ' + d.page,
              data: d.histogram,
              borderColor: colors[i % colors.length],
              borderWidth: 2,
              pointRadius: 0,
              fill: false
            }))
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'top' } },
            scales: {
              x: { title: { display: true, text: 'Brightness (0-255)' } },
              y: { title: { display: true, text: 'Frequency (%)' } }
            }
          }
        });
      });
  </script>
</body>
</html>`;

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), html);
  console.log('HTML saved: index.html');
  console.log(`\nView: http://localhost:3000/gutter-analysis/index.html`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
