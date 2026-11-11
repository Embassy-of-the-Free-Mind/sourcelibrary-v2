#!/usr/bin/env node
// PRIOR ART: scripts/eval/identify-bench.mjs (image→image, a photo of a plate against gallery crops; #3193) and
// scripts/eval/clip-index-recall.mjs (the CLIP index against itself after a runtime change). Neither scores TEXT→image
// over PAGE images with real reader queries, which is what a re-embed of the ~20M page images would serve (#6871 item 3).
/**
 * build-pool — the page-image pool and the candidate queries for the #6871 CLIP vs SigLIP2 test (PREREGISTRATION.md).
 *   Pool: 5,000 pages that carry an extracted illustration (gallery_images, one per page, visible books) +
 *         10,000 random pages of visible books (one per book where possible). Seed 6871. Read-only.
 *   Queries: every distinct free-text search_images query in mcp_tool_calls, with its distinct-IP count.
 *   node --env-file=/root/sourcelibrary/.env.production.local build-pool.mjs --out DIR
 */
import fs from 'node:fs';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { getPageSource } from '../../lib/page-image-url.mjs';

const OUT = process.argv[process.argv.indexOf('--out') + 1];
let s = 6871; const rnd = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const c = new MongoClient(process.env.MONGODB_URI); await c.connect();
const db = c.db('bookstore');
const live = await db.collection('books').find({ visible: true, pages_count: { $gt: 0 } }, { projection: { id: 1, pages_count: 1 } }).sort({ id: 1 }).toArray();
const liveIds = new Set(live.map((b) => b.id));
const PROJ = { id: 1, book_id: 1, page_number: 1, photo: 1, archived_photo: 1, cropped_photo: 1, photo_original: 1, enhanced_photo: 1, split_from_spread: 1 };

// 1. illustrated pages
const gp = await db.collection('gallery_images').find({}, { projection: { page_id: 1, book_id: 1 } }).sort({ _id: 1 }).toArray();
const gpages = shuffle([...new Map(gp.filter((g) => liveIds.has(g.book_id)).map((g) => [g.page_id, g])).values()]);
const pool = []; const seen = new Set();
for (let i = 0; i < gpages.length && pool.filter((p) => p.stratum === 'illustrated').length < 5000; i += 500) {
  const ids = gpages.slice(i, i + 500).map((g) => g.page_id);
  for (const p of await db.collection('pages').find({ id: { $in: ids } }, { projection: PROJ }).toArray()) {
    const src = getPageSource(p); if (!src || seen.has(p.id)) continue;
    if (pool.filter((x) => x.stratum === 'illustrated').length >= 5000) break;
    seen.add(p.id); pool.push({ id: p.id, book_id: p.book_id, page_number: p.page_number, src, stratum: 'illustrated' });
  }
}
// 2. random pages, one per book
const books = shuffle(live.slice());
for (let i = 0; i < books.length && pool.length < 15000; i += 50) {
  const got = await Promise.all(books.slice(i, i + 50).map(async (b) => {
    const pn = 1 + Math.floor(rnd() * b.pages_count);
    return db.collection('pages').findOne({ book_id: b.id, page_number: { $gte: pn } }, { projection: PROJ, sort: { page_number: 1 } });
  }));
  for (const p of got) { const src = p && getPageSource(p); if (!src || seen.has(p.id) || pool.length >= 15000) continue; seen.add(p.id); pool.push({ id: p.id, book_id: p.book_id, page_number: p.page_number, src, stratum: 'random' }); }
}
const q = await db.collection('mcp_tool_calls').aggregate([{ $match: { tool: 'search_images', 'args.query': { $type: 'string', $ne: '' } } },
  { $group: { _id: { $toLower: { $trim: { input: '$args.query' } } }, n: { $sum: 1 }, ips: { $addToSet: '$ip_hash' }, scoped: { $max: { $cond: [{ $ifNull: ['$args.book_id', false] }, 1, 0] } } } },
  { $project: { _id: 0, query: '$_id', n: 1, nip: { $size: '$ips' }, scoped: 1 } }, { $sort: { nip: -1, n: -1, query: 1 } }]).toArray();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'pool.jsonl'), pool.map((r) => JSON.stringify(r)).join('\n') + '\n');
fs.writeFileSync(path.join(OUT, 'queries-all.json'), JSON.stringify(q, null, 1));
console.log(JSON.stringify({ pool: pool.length, illustrated: pool.filter((p) => p.stratum === 'illustrated').length, random: pool.filter((p) => p.stratum === 'random').length, queries: q.length }));
await c.close();
