#!/usr/bin/env node
/**
 * Histogram-based Gutter Analysis
 *
 * Creates detailed histograms and statistics for:
 * - Average darkness per column
 * - Peak (minimum) darkness per column
 * - Darkness variance per column
 * - Full histogram of center region
 *
 * Usage: node scripts/analyze-gutter-histogram.js <book_id>
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://sourcelibrary-v2.vercel.app';
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'gutter-histograms');
const ANALYSIS_WIDTH = 1000;

async function fetchBook(bookId) {
  const response = await fetch(`${API_BASE}/api/books/${bookId}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchImage(url) {
  console.log(`  Downloading...`);
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Comprehensive column analysis
 * For each vertical column, compute:
 * - mean brightness
 * - min brightness (darkest pixel)
 * - max brightness (lightest pixel)
 * - std deviation
 * - percentiles (10th, 25th, 50th/median, 75th, 90th)
 */
async function analyzeColumns(imageBuffer) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const columns = [];

  for (let x = 0; x < width; x++) {
    const pixels = [];
    for (let y = 0; y < height; y++) {
      pixels.push(data[y * width + x]);
    }

    // Sort for percentile calculations
    const sorted = [...pixels].sort((a, b) => a - b);

    const sum = pixels.reduce((a, b) => a + b, 0);
    const mean = sum / height;
    const variance = pixels.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / height;

    columns.push({
      x,
      xPercent: (x / width * 100).toFixed(1),
      mean,
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stdDev: Math.sqrt(variance),
      p10: sorted[Math.floor(height * 0.1)],
      p25: sorted[Math.floor(height * 0.25)],
      median: sorted[Math.floor(height * 0.5)],
      p75: sorted[Math.floor(height * 0.75)],
      p90: sorted[Math.floor(height * 0.9)],
    });
  }

  return { columns, width, height };
}

/**
 * Analyze a vertical strip of the image (for histogram)
 */
async function analyzeStrip(imageBuffer, startPercent, endPercent) {
  const { data, info } = await sharp(imageBuffer)
    .resize(ANALYSIS_WIDTH, null, { fit: 'inside' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  const startX = Math.floor(width * startPercent / 100);
  const endX = Math.floor(width * endPercent / 100);

  // Collect all pixels in the strip
  const allPixels = [];
  for (let x = startX; x < endX; x++) {
    for (let y = 0; y < height; y++) {
      allPixels.push(data[y * width + x]);
    }
  }

  // Build histogram (256 bins for 0-255)
  const histogram = new Array(256).fill(0);
  for (const p of allPixels) {
    histogram[p]++;
  }

  // Normalize to percentages
  const total = allPixels.length;
  const histogramPercent = histogram.map(c => (c / total * 100));

  return {
    startPercent,
    endPercent,
    pixelCount: total,
    histogram,
    histogramPercent,
    stats: {
      mean: (allPixels.reduce((a, b) => a + b, 0) / total).toFixed(1),
      min: Math.min(...allPixels),
      max: Math.max(...allPixels),
    }
  };
}

/**
 * Find the darkest vertical band using different metrics
 */
function findDarkestBand(columns, metric = 'mean') {
  const centerStart = Math.floor(columns.length * 0.35);
  const centerEnd = Math.floor(columns.length * 0.65);

  let darkest = { value: Infinity, index: centerStart };

  for (let i = centerStart; i < centerEnd; i++) {
    const value = columns[i][metric];
    if (value < darkest.value) {
      darkest = { value, index: i, xPercent: columns[i].xPercent };
    }
  }

  return darkest;
}

function generateHTML(results) {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Gutter Histogram Analysis</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    body { font-family: system-ui; max-width: 1800px; margin: 0 auto; padding: 20px; background: #f5f5f5; }
    h1, h2, h3 { color: #333; }
    .page-section { background: white; padding: 20px; margin: 20px 0; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    .chart-row { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 20px 0; }
    .chart-container { height: 300px; }
    .chart-container-tall { height: 400px; }
    .stats-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin: 15px 0; }
    .stat-box { background: #f5f5f5; padding: 15px; border-radius: 4px; text-align: center; }
    .stat-value { font-size: 24px; font-weight: bold; color: #333; }
    .stat-label { font-size: 12px; color: #666; margin-top: 5px; }
    .thumbnail { max-width: 600px; border: 1px solid #ddd; }
    .legend { display: flex; gap: 20px; flex-wrap: wrap; margin: 10px 0; font-size: 14px; }
    .legend-item { display: flex; align-items: center; gap: 5px; }
    .legend-color { width: 20px; height: 10px; border-radius: 2px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; }
    th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
  </style>
</head>
<body>
  <h1>Gutter Histogram Analysis</h1>

  <div class="page-section">
    <h2>Summary - Darkest Band Detection</h2>
    <table>
      <tr>
        <th>Page</th>
        <th>Dimensions</th>
        <th>By Mean</th>
        <th>By Min (Peak Dark)</th>
        <th>By P10</th>
        <th>By Median</th>
      </tr>
      ${results.map(r => `
        <tr>
          <td>Page ${r.pageNumber}</td>
          <td>${r.dimensions.width}x${r.dimensions.height}</td>
          <td>${r.darkestBand.mean.xPercent}% (${r.darkestBand.mean.value.toFixed(0)})</td>
          <td>${r.darkestBand.min.xPercent}% (${r.darkestBand.min.value})</td>
          <td>${r.darkestBand.p10.xPercent}% (${r.darkestBand.p10.value})</td>
          <td>${r.darkestBand.median.xPercent}% (${r.darkestBand.median.value.toFixed(0)})</td>
        </tr>
      `).join('')}
    </table>
  </div>

  ${results.map((r, idx) => `
  <div class="page-section">
    <h2>Page ${r.pageNumber}</h2>

    <div class="stats-grid">
      <div class="stat-box">
        <div class="stat-value">${r.darkestBand.mean.xPercent}%</div>
        <div class="stat-label">Darkest by Mean</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${r.darkestBand.min.xPercent}%</div>
        <div class="stat-label">Darkest by Peak</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${r.darkestBand.p10.xPercent}%</div>
        <div class="stat-label">Darkest by P10</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${r.darkestBand.median.xPercent}%</div>
        <div class="stat-label">Darkest by Median</div>
      </div>
      <div class="stat-box">
        <div class="stat-value">${(r.dimensions.width / r.dimensions.height).toFixed(2)}</div>
        <div class="stat-label">Aspect Ratio</div>
      </div>
    </div>

    <img src="page-${r.pageNumber}-thumb.jpg" class="thumbnail">

    <div class="legend">
      <div class="legend-item"><div class="legend-color" style="background: rgba(255,99,132,0.8)"></div> Mean brightness</div>
      <div class="legend-item"><div class="legend-color" style="background: rgba(54,162,235,0.8)"></div> Min (darkest pixel)</div>
      <div class="legend-item"><div class="legend-color" style="background: rgba(75,192,192,0.8)"></div> 10th percentile</div>
      <div class="legend-item"><div class="legend-color" style="background: rgba(153,102,255,0.8)"></div> Median</div>
      <div class="legend-item"><div class="legend-color" style="background: rgba(255,159,64,0.5)"></div> Std deviation</div>
    </div>

    <h3>Column-wise Brightness Profiles</h3>
    <div class="chart-container-tall">
      <canvas id="profile-${idx}"></canvas>
    </div>

    <h3>Strip Histograms (Left 25% vs Center 25% vs Right 25%)</h3>
    <div class="chart-row">
      <div class="chart-container">
        <canvas id="hist-${idx}"></canvas>
      </div>
      <div class="chart-container">
        <canvas id="hist-overlay-${idx}"></canvas>
      </div>
    </div>
  </div>
  `).join('')}

  <script>
    // Load chart data from JSON file
    fetch('chart-data.json')
      .then(r => r.json())
      .then(results => {
        renderCharts(results);
      })
      .catch(err => {
        console.error('Failed to load chart data:', err);
        document.body.innerHTML += '<p style="color:red">Error loading chart data. Run from a web server (http://localhost:3000).</p>';
      });

    function renderCharts(results) {
    results.forEach((r, idx) => {
      // Profile chart
      const profileCtx = document.getElementById('profile-' + idx).getContext('2d');
      const labels = r.columns.map(c => c.x);

      new Chart(profileCtx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            { label: 'Mean', data: r.columns.map(c => c.mean), borderColor: 'rgba(255,99,132,0.8)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'Min (Peak Dark)', data: r.columns.map(c => c.min), borderColor: 'rgba(54,162,235,0.8)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'P10', data: r.columns.map(c => c.p10), borderColor: 'rgba(75,192,192,0.8)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'Median', data: r.columns.map(c => c.median), borderColor: 'rgba(153,102,255,0.8)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'StdDev', data: r.columns.map(c => c.stdDev), borderColor: 'rgba(255,159,64,0.5)', borderWidth: 1, pointRadius: 0, fill: false, yAxisID: 'y2' }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            title: { display: true, text: 'Brightness by Column Position' },
            annotation: {
              annotations: {
                centerRegion: {
                  type: 'box',
                  xMin: 35, xMax: 65,
                  backgroundColor: 'rgba(255,255,0,0.1)',
                  borderWidth: 0
                }
              }
            }
          },
          scales: {
            x: { title: { display: true, text: 'Position (%)' }, ticks: { maxTicksLimit: 20 } },
            y: { title: { display: true, text: 'Brightness (0=black)' }, min: 0, max: 255 },
            y2: { title: { display: true, text: 'Std Dev' }, position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false } }
          }
        }
      });

      // Strip histogram (separate)
      const histCtx = document.getElementById('hist-' + idx).getContext('2d');
      const binLabels = Array.from({length: 64}, (_, i) => i * 4); // Downsampled to 64 bins

      new Chart(histCtx, {
        type: 'bar',
        data: {
          labels: binLabels,
          datasets: [
            { label: 'Left (10-25%)', data: r.strips.left.histogramPercent, backgroundColor: 'rgba(255,99,132,0.5)', barPercentage: 1, categoryPercentage: 1 },
            { label: 'Center (40-60%)', data: r.strips.center.histogramPercent, backgroundColor: 'rgba(54,162,235,0.5)', barPercentage: 1, categoryPercentage: 1 },
            { label: 'Right (75-90%)', data: r.strips.right.histogramPercent, backgroundColor: 'rgba(75,192,192,0.5)', barPercentage: 1, categoryPercentage: 1 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Brightness Histogram by Region' } },
          scales: {
            x: { title: { display: true, text: 'Brightness (0=black, 255=white)' }, ticks: { maxTicksLimit: 20 } },
            y: { title: { display: true, text: 'Frequency %' } }
          }
        }
      });

      // Overlay histogram (line)
      const histOverlayCtx = document.getElementById('hist-overlay-' + idx).getContext('2d');

      new Chart(histOverlayCtx, {
        type: 'line',
        data: {
          labels: binLabels,
          datasets: [
            { label: 'Left', data: r.strips.left.histogramPercent, borderColor: 'rgb(255,99,132)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'Center', data: r.strips.center.histogramPercent, borderColor: 'rgb(54,162,235)', borderWidth: 2, pointRadius: 0, fill: false },
            { label: 'Right', data: r.strips.right.histogramPercent, borderColor: 'rgb(75,192,192)', borderWidth: 2, pointRadius: 0, fill: false }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { title: { display: true, text: 'Histogram Overlay' } },
          scales: {
            x: { title: { display: true, text: 'Brightness' }, ticks: { maxTicksLimit: 20 } },
            y: { title: { display: true, text: 'Frequency %' } }
          }
        }
      });
    });
    } // end renderCharts
  </script>
</body>
</html>`;
}

async function main() {
  const bookId = process.argv[2];
  if (!bookId) {
    console.error('Usage: node scripts/analyze-gutter-histogram.js <book_id>');
    process.exit(1);
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log('=== Histogram Gutter Analysis ===\n');

  const book = await fetchBook(bookId);
  console.log(`Book: ${book.title}\n`);

  // Get unsplit pages
  const unsplitPages = (book.pages || []).filter(p => !p.split_from && !p.crop);
  const samples = unsplitPages.slice(0, 6);

  console.log(`Analyzing ${samples.length} pages...\n`);

  const results = [];

  for (const page of samples) {
    console.log(`Page ${page.page_number}:`);

    try {
      const imageUrl = page.photo_original || page.photo;
      const imageBuffer = await fetchImage(imageUrl);
      const metadata = await sharp(imageBuffer).metadata();
      console.log(`  ${metadata.width}x${metadata.height}`);

      // Full column analysis
      const { columns, width, height } = await analyzeColumns(imageBuffer);

      // Find darkest band using different metrics
      const darkestBand = {
        mean: findDarkestBand(columns, 'mean'),
        min: findDarkestBand(columns, 'min'),
        p10: findDarkestBand(columns, 'p10'),
        median: findDarkestBand(columns, 'median'),
      };

      console.log(`  Darkest by mean: ${darkestBand.mean.xPercent}%`);
      console.log(`  Darkest by min:  ${darkestBand.min.xPercent}%`);
      console.log(`  Darkest by P10:  ${darkestBand.p10.xPercent}%`);

      // Strip histograms
      const strips = {
        left: await analyzeStrip(imageBuffer, 10, 25),
        center: await analyzeStrip(imageBuffer, 40, 60),
        right: await analyzeStrip(imageBuffer, 75, 90),
      };

      // Save thumbnail
      const thumb = await sharp(imageBuffer).resize(600, null, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
      fs.writeFileSync(path.join(OUTPUT_DIR, `page-${page.page_number}-thumb.jpg`), thumb);

      results.push({
        pageNumber: page.page_number,
        dimensions: { width: metadata.width, height: metadata.height },
        columns,
        darkestBand,
        strips
      });

    } catch (error) {
      console.error(`  ERROR: ${error.message}`);
    }
  }

  // Save chart data separately to avoid stack overflow
  const chartData = results.map(r => {
    const sampledColumns = r.columns.filter((_, i) => i % 5 === 0);
    const downsampleHist = (hist) => {
      const result = [];
      for (let i = 0; i < 256; i += 4) {
        result.push(Math.round((hist[i] + hist[i+1] + hist[i+2] + hist[i+3]) / 4 * 100) / 100);
      }
      return result;
    };
    return {
      pageNumber: r.pageNumber,
      columns: sampledColumns.map(c => ({
        x: parseFloat(c.xPercent),
        mean: Math.round(c.mean),
        min: c.min,
        p10: c.p10,
        median: Math.round(c.median),
        stdDev: Math.round(c.stdDev)
      })),
      strips: {
        left: { histogramPercent: downsampleHist(r.strips.left.histogramPercent) },
        center: { histogramPercent: downsampleHist(r.strips.center.histogramPercent) },
        right: { histogramPercent: downsampleHist(r.strips.right.histogramPercent) }
      }
    };
  });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'chart-data.json'), JSON.stringify(chartData));

  fs.writeFileSync(path.join(OUTPUT_DIR, 'index.html'), generateHTML(results));
  console.log('\n=== Done ===');
  console.log(`View: http://localhost:3000/gutter-histograms/index.html`);
  console.log(`Or: file://${path.join(OUTPUT_DIR, 'index.html')}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
