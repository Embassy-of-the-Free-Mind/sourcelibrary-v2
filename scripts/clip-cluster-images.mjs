#!/usr/bin/env node
/**
 * Cluster gallery images by visual similarity using CLIP embeddings.
 *
 * Groups illustrations into visual themes (e.g., "all skeleton figures",
 * "all ouroboros", "all distillation apparatus") using k-means clustering.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a; node scripts/clip-cluster-images.mjs
 *
 * Options:
 *   --clusters N      Number of clusters (default: 50)
 *   --iterations N    K-means iterations (default: 20)
 *   --min-size N      Minimum cluster size to report (default: 5)
 *   --output FILE     Write JSON output to file (default: stdout summary)
 *   --label           Ask CLIP server to label clusters by nearest text
 */

import pg from 'pg';
import fs from 'fs';

const { Client: PgClient } = pg;

const K = parseInt(process.argv.find(a => a.startsWith('--clusters='))?.split('=')[1] || '50');
const ITERATIONS = parseInt(process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] || '20');
const MIN_SIZE = parseInt(process.argv.find(a => a.startsWith('--min-size='))?.split('=')[1] || '5');
const OUTPUT_FILE = process.argv.find(a => a.startsWith('--output='))?.split('=')[1];
const LABEL = process.argv.includes('--label');
const CLIP_URL = process.env.CLIP_URL || 'http://localhost:3457';

// Simple k-means on float arrays
function kmeans(vectors, k, iterations) {
  const dims = vectors[0].length;
  const n = vectors.length;

  // Initialize centroids randomly
  const indices = new Set();
  while (indices.size < k) indices.add(Math.floor(Math.random() * n));
  const centroids = [...indices].map(i => [...vectors[i]]);

  const assignments = new Int32Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    // Assign each point to nearest centroid
    let changed = 0;
    for (let i = 0; i < n; i++) {
      let bestDist = Infinity;
      let bestK = 0;
      for (let c = 0; c < k; c++) {
        let dist = 0;
        for (let d = 0; d < dims; d++) {
          const diff = vectors[i][d] - centroids[c][d];
          dist += diff * diff;
        }
        if (dist < bestDist) { bestDist = dist; bestK = c; }
      }
      if (assignments[i] !== bestK) { assignments[i] = bestK; changed++; }
    }

    if (changed === 0) break;

    // Recompute centroids
    const counts = new Float64Array(k);
    const sums = Array.from({ length: k }, () => new Float64Array(dims));
    for (let i = 0; i < n; i++) {
      const c = assignments[i];
      counts[c]++;
      for (let d = 0; d < dims; d++) sums[c][d] += vectors[i][d];
    }
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      for (let d = 0; d < dims; d++) centroids[c][d] = sums[c][d] / counts[c];
    }

    process.stdout.write(`\r  Iteration ${iter + 1}/${iterations} — ${changed} reassigned`);
  }
  console.log();

  return { assignments, centroids };
}

async function labelCluster(centroid) {
  // Use CLIP text encoding to find the best text label for a centroid
  const candidates = [
    'skeleton', 'skull', 'ouroboros', 'alchemical laboratory', 'distillation apparatus',
    'furnace', 'zodiac', 'astrological chart', 'botanical illustration', 'heraldic crest',
    'portrait', 'landscape', 'architectural diagram', 'geometric figure', 'musical notation',
    'religious scene', 'angel', 'demon', 'dragon', 'tree of life', 'sun and moon',
    'compass and square', 'eye of providence', 'caduceus', 'phoenix', 'pelican',
    'crucifixion', 'resurrection', 'kabbalah diagram', 'sephiroth', 'emblem',
    'allegory', 'mythological scene', 'battle scene', 'map', 'celestial chart',
    'chemical symbols', 'serpent', 'lion', 'eagle', 'crown', 'sword',
    'book illustration', 'ornamental border', 'title page decoration', 'printer mark',
    'woodcut', 'engraving', 'etching', 'manuscript illumination',
  ];

  try {
    const resp = await fetch(`${CLIP_URL}/embed-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: candidates[0] }), // single test
    });
    if (!resp.ok) return null;
  } catch { return null; }

  // Embed all candidates
  let bestLabel = '';
  let bestSim = -1;

  for (const text of candidates) {
    try {
      const resp = await fetch(`${CLIP_URL}/embed-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const { embedding } = await resp.json();

      let dot = 0, normA = 0, normB = 0;
      for (let i = 0; i < embedding.length; i++) {
        dot += centroid[i] * embedding[i];
        normA += centroid[i] * centroid[i];
        normB += embedding[i] * embedding[i];
      }
      const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));

      if (sim > bestSim) { bestSim = sim; bestLabel = text; }
    } catch { /* skip */ }
  }

  return bestSim > 0.15 ? `${bestLabel} (${bestSim.toFixed(3)})` : null;
}

async function main() {
  const connStr = (process.env.SUPABASE_DB_URL || '').replace(':6543/', ':5432/');
  if (!connStr) { console.error('Missing SUPABASE_DB_URL'); process.exit(1); }

  const client = new PgClient({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('Loading CLIP embeddings from Supabase...');
  const { rows } = await client.query(
    "SELECT id, title, book_id, image_url, embedding::text FROM clip_embeddings WHERE source_type = 'gallery_image'"
  );
  console.log(`Loaded ${rows.length} gallery image embeddings`);

  if (rows.length < K) {
    console.error(`Not enough images (${rows.length}) for ${K} clusters`);
    process.exit(1);
  }

  // Parse embeddings
  const vectors = rows.map(r => {
    const nums = r.embedding.replace(/[\[\]]/g, '').split(',').map(Number);
    return nums;
  });

  console.log(`Running k-means (k=${K}, iterations=${ITERATIONS})...`);
  const { assignments, centroids } = kmeans(vectors, K, ITERATIONS);

  // Build clusters
  const clusters = Array.from({ length: K }, () => []);
  for (let i = 0; i < rows.length; i++) {
    clusters[assignments[i]].push({
      id: rows[i].id,
      title: rows[i].title,
      book_id: rows[i].book_id,
      image_url: rows[i].image_url,
    });
  }

  // Sort by size descending, filter by min size
  const validClusters = clusters
    .map((items, idx) => ({ idx, items, centroid: centroids[idx] }))
    .filter(c => c.items.length >= MIN_SIZE)
    .sort((a, b) => b.items.length - a.items.length);

  console.log(`\n${validClusters.length} clusters with >= ${MIN_SIZE} images:\n`);

  // Optionally label clusters
  const output = [];
  for (const cluster of validClusters) {
    const label = LABEL ? await labelCluster(cluster.centroid) : null;
    const uniqueBooks = new Set(cluster.items.map(i => i.book_id)).size;
    const entry = {
      cluster: cluster.idx,
      size: cluster.items.length,
      books: uniqueBooks,
      label: label || undefined,
      sample_titles: cluster.items.slice(0, 3).map(i => i.title?.slice(0, 60)),
      sample_urls: cluster.items.slice(0, 3).map(i => i.image_url),
    };
    output.push(entry);

    console.log(`Cluster ${cluster.idx}: ${cluster.items.length} images from ${uniqueBooks} books${label ? ` — ${label}` : ''}`);
    for (const s of entry.sample_titles) console.log(`  ${s}`);
  }

  if (OUTPUT_FILE) {
    const fullOutput = validClusters.map(c => ({
      cluster: c.idx,
      size: c.items.length,
      items: c.items,
    }));
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(fullOutput, null, 2));
    console.log(`\nFull output written to ${OUTPUT_FILE}`);
  }

  await client.end();
}

main().catch(console.error);
