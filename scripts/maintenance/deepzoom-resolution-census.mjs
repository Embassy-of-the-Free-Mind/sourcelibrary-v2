#!/usr/bin/env node
/**
 * Deep-zoom resolution census (issue #2411, phase 1).
 *
 * Reads the master-image dimensions for every visible artwork by range-fetching
 * just the image header (no full downloads) and parsing it with sharp. Outputs
 * a megapixel distribution + per-provider stats so the deep-zoom tiling gate
 * (proposed: >4MP) is decided on data.
 *
 * Master URL precedence: archived_full_url (R2) → image_full (R2) →
 * commons_full_url (upstream — fetched politely with a UA, low concurrency).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/deepzoom-resolution-census.mjs [--limit N]
 *
 * Writes scripts/output/deepzoom-census.json (untracked).
 */
import { MongoClient } from 'mongodb';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const LIMIT = process.argv.includes('--limit')
  ? parseInt(process.argv[process.argv.indexOf('--limit') + 1], 10)
  : Infinity;

const UA = 'SourceLibraryBot/1.0 (+https://sourcelibrary.org; deepzoom-census)';
const HEADER_BYTES = 262144; // 256KB — enough to reach SOF past large EXIF blocks
const R2_CONCURRENCY = 16;
const UPSTREAM_CONCURRENCY = 3; // be polite to Wikimedia etc.

async function dimsFromUrl(url) {
  // Try header-only first; a few progressive/EXIF-heavy files need more.
  for (const range of [`bytes=0-${HEADER_BYTES - 1}`, `bytes=0-${4 * HEADER_BYTES - 1}`]) {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Range: range } });
    if (!res.ok && res.status !== 206) return { error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    try {
      const m = await sharp(buf).metadata();
      if (m.width && m.height) return { width: m.width, height: m.height, format: m.format };
    } catch {
      // fall through to the bigger range
    }
  }
  return { error: 'unparseable header' };
}

async function pool(items, concurrency, fn) {
  const results = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (i < items.length) {
        const idx = i++;
        results[idx] = await fn(items[idx], idx);
      }
    })
  );
  return results;
}

const client = await MongoClient.connect(process.env.MONGODB_URI);
const books = client.db('bookstore').collection('books');

const artworks = await books
  .find(
    { visible: true, content_type: 'artwork' },
    { projection: { title: 1, archived_full_url: 1, image_full: 1, commons_full_url: 1, 'image_source.provider': 1 } }
  )
  .limit(LIMIT === Infinity ? 0 : LIMIT)
  .toArray();
await client.close();

const withMaster = artworks.map((a) => ({
  id: a._id.toString(),
  provider: a.image_source?.provider ?? 'unknown',
  url: a.archived_full_url || a.image_full || a.commons_full_url,
  upstream: !(a.archived_full_url || a.image_full),
}));

const r2 = withMaster.filter((a) => !a.upstream);
const upstream = withMaster.filter((a) => a.upstream);
console.log(`Artworks: ${withMaster.length} (${r2.length} R2-archived, ${upstream.length} upstream-only)`);

let done = 0;
const measure = async (a) => {
  const d = a.url ? await dimsFromUrl(a.url).catch((e) => ({ error: e.message })) : { error: 'no url' };
  done++;
  if (done % 500 === 0) console.log(`  ${done}/${withMaster.length}…`);
  return { ...a, ...d, mp: d.width ? +((d.width * d.height) / 1e6).toFixed(1) : null };
};

const results = [
  ...(await pool(r2, R2_CONCURRENCY, measure)),
  ...(await pool(upstream, UPSTREAM_CONCURRENCY, measure)),
];

// ---- report ----
const ok = results.filter((r) => r.mp !== null);
const errors = results.filter((r) => r.mp === null);
const buckets = [
  ['<1MP', (mp) => mp < 1],
  ['1–4MP', (mp) => mp >= 1 && mp < 4],
  ['4–10MP', (mp) => mp >= 4 && mp < 10],
  ['10–25MP', (mp) => mp >= 10 && mp < 25],
  ['25–50MP', (mp) => mp >= 25 && mp < 50],
  ['≥50MP', (mp) => mp >= 50],
];

console.log(`\nMeasured ${ok.length}/${results.length} (${errors.length} errors)\n`);
console.log('Megapixel distribution:');
for (const [label, test] of buckets) {
  const n = ok.filter((r) => test(r.mp)).length;
  console.log(`  ${label.padEnd(8)} ${String(n).padStart(6)}  (${((100 * n) / ok.length).toFixed(1)}%)`);
}

console.log('\nPer provider (count / median MP / ≥4MP):');
const byProv = {};
for (const r of ok) (byProv[r.provider] ??= []).push(r.mp);
for (const [prov, mps] of Object.entries(byProv).sort((a, b) => b[1].length - a[1].length)) {
  mps.sort((x, y) => x - y);
  const med = mps[Math.floor(mps.length / 2)];
  const gate = mps.filter((m) => m >= 4).length;
  console.log(`  ${prov.padEnd(28)} ${String(mps.length).padStart(6)}  median ${String(med).padStart(6)}MP  ≥4MP: ${gate} (${((100 * gate) / mps.length).toFixed(0)}%)`);
}

if (errors.length) {
  const byErr = {};
  for (const e of errors) byErr[e.error] = (byErr[e.error] ?? 0) + 1;
  console.log('\nErrors:', JSON.stringify(byErr));
}

const outDir = path.join(import.meta.dirname, '..', 'output');
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, 'deepzoom-census.json');
fs.writeFileSync(outPath, JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 1));
console.log(`\nWrote ${outPath}`);
