#!/usr/bin/env node
// PRIOR ART: scripts/gpu/gex45-bench-6871/build-manifest.mjs (one interior page per book, archived master preferred) and
// scripts/eval/lib/sampling.mjs (one page per book). Neither draws page-weighted inside source groups, which is what a
// backlog decision needs (the 8,806 hidden Sanskrit books are 69% eGangotri IA scans by pages, 11% museum MSS).
/**
 * draw.mjs — the candidate draw for the #7243 Sanskrit GPU-vs-Flash test. Read-only.
 *
 *   node --env-file=.env.production.local draw.mjs <out.json> [--seed 7243]
 *
 * Population: books with language /sanskrit/i, visible != true, pages_count > 0 (8,806 on 2026-10-24).
 * Groups by catalog_metadata.source: ia (internet_archive), other (null + iiif), moi (museumsofindia).
 * Within a group, books are drawn without replacement with probability ∝ pages_count (Efraimidis–Spirakis keys), so the
 * draw represents pages at stake, one page per book. Page: uniform over the interior (skip the first 15% and last 5%;
 * books of 1–5 pages: any page). Image: archived_photo, else photo. Candidates are classified by eye afterwards
 * (observed script / kind / layout); the classification, not this file, decides which stratum a page enters.
 */
import fs from 'node:fs';
import { MongoClient } from 'mongodb';

const out = process.argv[2];
const seed = Number((process.argv.find((a, i) => process.argv[i - 1] === '--seed')) || 7243);
const TAKE = { ia: 60, other: 25, moi: 20 };

// mulberry32
let s = seed >>> 0;
const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const c = await MongoClient.connect(process.env.MONGODB_URI);
const db = c.db('bookstore');
const books = await db.collection('books').find(
  { language: /sanskrit/i, visible: { $ne: true }, pages_count: { $gt: 0 } },
  { projection: { id: 1, title: 1, author: 1, published: 1, language: 1, pages_count: 1, pages_ocr: 1, categories: 1, hidden_reason: 1, 'catalog_metadata.source': 1, 'catalog_metadata.script': 1, 'catalog_metadata.creator': 1 } },
).sort({ id: 1 }).toArray();
const group = (b) => b.catalog_metadata?.source === 'internet_archive' ? 'ia' : b.catalog_metadata?.source === 'museumsofindia' ? 'moi' : 'other';
const picked = [];
for (const g of Object.keys(TAKE)) {
  const pool = books.filter((b) => group(b) === g).map((b) => ({ b, key: Math.pow(rnd(), 1 / b.pages_count) }));
  pool.sort((x, y) => y.key - x.key);
  for (const { b } of pool.slice(0, TAKE[g])) {
    const n = b.pages_count;
    const lo = n <= 5 ? 1 : Math.max(1, Math.ceil(n * 0.15) + 1), hi = n <= 5 ? n : Math.max(lo, Math.floor(n * 0.95));
    const pn = lo + Math.floor(rnd() * (hi - lo + 1));
    let p = await db.collection('pages').findOne({ book_id: b.id, page_number: pn }, { projection: { id: 1, page_number: 1, archived_photo: 1, photo: 1 } });
    if (!p) p = await db.collection('pages').findOne({ book_id: b.id, page_number: { $gte: pn } }, { sort: { page_number: 1 }, projection: { id: 1, page_number: 1, archived_photo: 1, photo: 1 } });
    if (!p) continue;
    picked.push({
      slug: `sa-${b.id.slice(-8)}-p${p.page_number}`, group: g, book_id: b.id, page_id: p.id, page_number: p.page_number,
      image_url: p.archived_photo || p.photo, image_field: p.archived_photo ? 'archived_photo' : 'photo',
      catalogue: { title: b.title, author: b.author, published: b.published ?? null, language: b.language, pages_count: n, pages_ocr: b.pages_ocr ?? 0, categories: b.categories ?? [], script: b.catalog_metadata?.script ?? null, creator: b.catalog_metadata?.creator ?? null, hidden_reason: b.hidden_reason ?? null },
    });
  }
}
fs.writeFileSync(out, JSON.stringify({ drawn_at: new Date().toISOString(), seed, population: books.length, take: TAKE, rule: 'pps by pages_count within group; interior page', pages: picked }, null, 1));
console.log(`${picked.length} candidates from ${books.length} books -> ${out}`);
await c.close();
