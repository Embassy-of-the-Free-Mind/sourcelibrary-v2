#!/usr/bin/env node
// PRIOR ART: scripts/eval/image-search-6871/build-pool.mjs (the 15K-page eval pool: same live filter, same getPageSource,
// same seeded shuffle; 15K pages, no crops) and scripts/backfill-clip-embeddings.mjs phase 3 (which gallery rows the CLIP
// index embeds and from which URL: the crop, never the full page). Neither builds a 152K crop list plus a 100K
// archived-master page sample for a files-only SigLIP2 run.
/**
 * build-manifests — the two inputs of the SigLIP2-so400m files-only run on gex45 (#6871 row 8, Derek 2026-10-21).
 *   crops.jsonl  every gallery_images row with a crop or image URL (extracted_url preferred, as the CLIP index does)
 *   pilot.jsonl  100,000 pages with an archived R2 master from live books (visible, pages_count > 0): seeded shuffle of
 *                the books, up to 5 random pages per book, so the sample spreads over ~20K books like the full run would
 * Read-only. node --env-file=/root/sourcelibrary/.env.production.local build-manifests.mjs --out DIR [--pilot 100000]
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource, isUsableImageUrl } from '../../lib/page-image-url.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out'); const PILOT = Number(arg('--pilot', 100000)); const PER_BOOK = 5;
if (!OUT) { console.error('usage: build-manifests.mjs --out DIR'); process.exit(2); }
let s = 6871; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
fs.mkdirSync(OUT, { recursive: true });

// 1. gallery crops (the clip_embeddings gallery rows, re-embedded with so400m)
const gal = await db.collection('gallery_images').find(
  { $or: [{ extracted_url: { $exists: true, $ne: null } }, { image_url: { $exists: true, $ne: null } }] },
  { projection: { _id: 0, id: 1, book_id: 1, page_id: 1, page_number: 1, extracted_url: 1, image_url: 1 } },
).sort({ id: 1 }).toArray();
const crops = [];
for (const g of gal) {
  const src = isUsableImageUrl(g.extracted_url) ? g.extracted_url : isUsableImageUrl(g.image_url) ? g.image_url : null;
  if (!src || !g.id) continue;
  crops.push({ id: `gallery-${g.id}`, book_id: g.book_id, page_id: g.page_id ?? null, page_number: g.page_number ?? null, src, kind: g.extracted_url === src ? 'crop' : 'image_url' });
}
fs.writeFileSync(path.join(OUT, 'crops.jsonl'), crops.map((r) => JSON.stringify(r)).join('\n') + '\n');
console.log(JSON.stringify({ gallery_rows: gal.length, crops: crops.length, crop_kind: crops.filter((r) => r.kind === 'crop').length }));

// 2. pilot pages: archived master present, live books, seeded
const live = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { _id: 0, id: 1, pages_count: 1 } }).sort({ id: 1 }).toArray();
const books = shuffle(live.filter((b) => b.id));
const PROJ = { _id: 0, id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, enhanced_photo: 1, split_from_spread: 1 };
const pilot = []; const seen = new Set(); let booksUsed = 0;
for (let i = 0; i < books.length && pilot.length < PILOT; i += 40) {
  const got = await Promise.all(books.slice(i, i + 40).map((b) => {
    const pns = [...new Set(Array.from({ length: PER_BOOK }, () => 1 + Math.floor(rnd() * b.pages_count)))];
    return db.collection('pages').find({ book_id: b.id, page_number: { $in: pns } }, { projection: PROJ }).toArray();
  }));
  for (const ps of got) {
    let used = false;
    for (const p of ps) {
      if (pilot.length >= PILOT || seen.has(p.id) || !isUsableImageUrl(p.archived_photo)) continue;
      const src = getPageSource(p); if (!src) continue;
      seen.add(p.id); used = true;
      pilot.push({ id: p.id, book_id: p.book_id, page_number: p.page_number, src, master: p.archived_photo === src });
    }
    if (used) booksUsed++;
  }
}
fs.writeFileSync(path.join(OUT, 'pilot.jsonl'), pilot.map((r) => JSON.stringify(r)).join('\n') + '\n');
const host = (u) => { try { return new URL(u).host; } catch { return '?'; } };
const hosts = {}; for (const r of pilot) hosts[host(r.src)] = (hosts[host(r.src)] || 0) + 1;
console.log(JSON.stringify({ live_books: live.length, books_used: booksUsed, pilot: pilot.length, src_is_archived_master: pilot.filter((r) => r.master).length, hosts }));
await c.close();
