#!/usr/bin/env node
/**
 * Export book embeddings from Supabase → run UMAP → write 2D coordinates as JSON.
 * Output: public/constellation-data.json
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAllEmbeddings() {
  const PAGE_SIZE = 1000;
  let all = [];
  let offset = 0;

  while (true) {
    const { data, error } = await sb
      .from('book_embeddings')
      .select('book_id, title, author, year, language, embedding, metadata')
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    console.log(`  Fetched ${all.length} embeddings...`);
    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  return all;
}

async function main() {
  console.log('1. Fetching embeddings from Supabase...');
  const books = await fetchAllEmbeddings();
  console.log(`   Got ${books.length} book embeddings`);

  // Write embeddings as numpy-compatible format for Python UMAP
  // Supabase returns vectors as strings like "[0.1,0.2,...]" — parse them
  const embeddings = books.map(b => {
    if (typeof b.embedding === 'string') return JSON.parse(b.embedding);
    return b.embedding;
  });
  const metadata = books.map(b => ({
    book_id: b.book_id,
    title: b.title,
    author: b.author,
    year: b.year,
    language: b.language,
    quality_score: b.metadata?.quality_score || null,
    collections: b.metadata?.collections || [],
  }));

  // Write temp files for Python
  const tmpDir = path.join(process.cwd(), '.tmp-constellation');
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'embeddings.json'), JSON.stringify(embeddings));
  fs.writeFileSync(path.join(tmpDir, 'metadata.json'), JSON.stringify(metadata));

  console.log('2. Running UMAP projection...');

  // Python UMAP script
  const pythonScript = `
import json
import numpy as np
import umap
import sys

with open('${tmpDir}/embeddings.json') as f:
    embeddings = np.array(json.load(f), dtype=np.float32)

print(f"   Input shape: {embeddings.shape}", file=sys.stderr)

reducer = umap.UMAP(
    n_components=2,
    n_neighbors=30,
    min_dist=0.1,
    metric='cosine',
    random_state=42,
    verbose=True
)
coords = reducer.fit_transform(embeddings)

# Normalize to [-1, 1] range
coords[:, 0] = (coords[:, 0] - coords[:, 0].min()) / (coords[:, 0].max() - coords[:, 0].min()) * 2 - 1
coords[:, 1] = (coords[:, 1] - coords[:, 1].min()) / (coords[:, 1].max() - coords[:, 1].min()) * 2 - 1

with open('${tmpDir}/coords.json', 'w') as f:
    json.dump(coords.tolist(), f)

print(f"   Output shape: {coords.shape}", file=sys.stderr)
`;

  fs.writeFileSync(path.join(tmpDir, 'umap_project.py'), pythonScript);
  execSync(`python3 ${tmpDir}/umap_project.py`, { stdio: 'inherit' });

  console.log('3. Assembling constellation data...');
  const coords = JSON.parse(fs.readFileSync(path.join(tmpDir, 'coords.json'), 'utf8'));

  const constellationData = metadata.map((m, i) => ({
    id: m.book_id,
    t: m.title,
    a: m.author,
    y: m.year,
    l: m.language,
    q: m.quality_score,
    c: m.collections,
    x: Math.round(coords[i][0] * 10000) / 10000,
    z: Math.round(coords[i][1] * 10000) / 10000,
  }));

  const outPath = path.join(process.cwd(), 'public', 'constellation-data.json');
  fs.writeFileSync(outPath, JSON.stringify(constellationData));
  console.log(`   Wrote ${constellationData.length} points to ${outPath}`);
  console.log(`   File size: ${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB`);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true });
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
