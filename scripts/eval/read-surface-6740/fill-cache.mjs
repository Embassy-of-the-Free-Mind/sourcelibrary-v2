// #6740 read-surface: fill the run's image cache (DIR/cache/<page_id>.jpg) for every page of every window, one at a
// time with backoff, so no run skips a page on a 429 from the image host (the first phase-A minute lost 8 pages that way).
// PRIOR ART: fetch-targets.mjs (this directory; targets only, no retry); cli-ocr.mjs servedImage (one try per read).
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/fill-cache.mjs --work=DIR
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const WORK = path.resolve(process.argv.find((a) => a.startsWith('--work='))?.slice(7));
const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
const cache = path.join(WORK, 'cache');
fs.mkdirSync(cache, { recursive: true });
// Amendment 6: on 2026-10-31 images.sourcelibrary.org answered GET with re-encoded bytes (e.g. 397,846 for a JPEG whose
// HEAD and R2 object are 481,969), so a cache refilled from the public URL is not the bytes the earlier runs read. An
// archived image is read from its R2 object instead; --check compares every cached file with the earlier reads' sha256.
const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
const R2_HOST = 'https://images.sourcelibrary.org/';
const fromR2 = async (src) => { const r = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: decodeURIComponent(src.slice(R2_HOST.length)) })); return Buffer.from(await r.Body.transformToByteArray()); };
const ids = [...new Set(Object.values(panel.langs).flatMap((L) => L.targets.flatMap((t) => t.window8)))];
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pages = await client.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
await client.close();
let got = 0, had = 0, failed = 0;
for (const p of pages) {
  const f = path.join(cache, `${p.id}.jpg`);
  if (fs.existsSync(f)) { had++; continue; }
  const src = getPageSource(p);
  if (src.startsWith(R2_HOST)) { fs.writeFileSync(f, await fromR2(src)); got++; continue; }
  for (let i = 0; i < 8; i++) {
    const res = await fetch(src);
    if (res.ok) { fs.writeFileSync(f, Buffer.from(await res.arrayBuffer())); got++; break; }
    const wait = Math.min(120, 5 * 2 ** i);
    console.log(`${p.id} HTTP ${res.status} (${new URL(src).host}); retry in ${wait}s`);
    if (i === 7) failed++;
    await new Promise((s) => setTimeout(s, wait * 1000));
  }
  await new Promise((s) => setTimeout(s, 300));
}
console.log(`${ids.length} window pages: ${had} cached already, ${got} fetched, ${failed} failed`);
// The earlier reads' bytes: every meta of a read sent unresized (no image_fit, or not resized) names the sha256 it sent.
const want = new Map();
for (const lang of fs.readdirSync(path.join(WORK, 'runs'))) for (const run of fs.readdirSync(path.join(WORK, 'runs', lang))) {
  const d = path.join(WORK, 'runs', lang, run);
  for (const m of fs.readdirSync(d).filter((x) => x.endsWith('.meta.json')).map((x) => JSON.parse(fs.readFileSync(path.join(d, x), 'utf8')))) if (m.image_sha256 && !m.image_fit?.resized) want.set(m.page_id, m.image_sha256);
}
const { createHash } = await import('node:crypto');
const bad = [...want].filter(([id, h]) => !fs.existsSync(path.join(cache, `${id}.jpg`)) || createHash('sha256').update(fs.readFileSync(path.join(cache, `${id}.jpg`))).digest('hex') !== h);
console.log(`checked against earlier reads: ${want.size - bad.length}/${want.size} identical${bad.length ? `; differ: ${bad.slice(0, 10).map(([id]) => id).join(', ')}` : ''}`);
if (bad.length) process.exitCode = 1;
