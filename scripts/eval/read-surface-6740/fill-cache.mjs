// #6740 read-surface: fill the run's image cache (DIR/cache/<page_id>.jpg) for every page of every window, one at a
// time with backoff, so no run skips a page on a 429 from the image host (the first phase-A minute lost 8 pages that way).
// PRIOR ART: fetch-targets.mjs (this directory; targets only, no retry); cli-ocr.mjs servedImage (one try per read).
//   node --env-file=/root/sourcelibrary/.env.production.local scripts/eval/read-surface-6740/fill-cache.mjs --work=DIR
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const WORK = path.resolve(process.argv.find((a) => a.startsWith('--work='))?.slice(7));
const panel = JSON.parse(fs.readFileSync(path.join(WORK, 'panel.json'), 'utf8'));
const cache = path.join(WORK, 'cache');
fs.mkdirSync(cache, { recursive: true });
const ids = [...new Set(Object.values(panel.langs).flatMap((L) => L.targets.flatMap((t) => t.window8)))];
const client = new MongoClient(process.env.MONGODB_URI); await client.connect();
const pages = await client.db('bookstore').collection('pages').find({ id: { $in: ids } }, { projection: { id: 1, book_id: 1, page_number: 1, archived_photo: 1, cropped_photo: 1, split_from_spread: 1, split_from_pecha: 1, crop: 1, photo: 1, enhanced_photo: 1, photo_original: 1 } }).toArray();
await client.close();
let got = 0, had = 0, failed = 0;
for (const p of pages) {
  const f = path.join(cache, `${p.id}.jpg`);
  if (fs.existsSync(f)) { had++; continue; }
  const src = getPageSource(p);
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
