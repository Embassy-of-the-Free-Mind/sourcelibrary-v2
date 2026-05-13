#!/usr/bin/env node
/**
 * Strict content-based dedup scanner.
 *
 * Two independent signals, each strong:
 *   1. SHA-256 of image bytes — exact match catches "same scan uploaded twice"
 *   2. OCR text Jaccard ≥ 0.95 on word trigrams — catches re-compressed scans
 *
 * Writes proposals to .claude/docs/dedup-proposals/<book_id>.json without
 * applying anything. Use scripts/dedup-review-build.mjs to generate the
 * per-book HTML review pages, scripts/dedup-apply-approved.mjs to apply
 * accepted ones.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-scan-strict.mjs --book <id>
 *   node scripts/dedup-scan-strict.mjs --book-list <file>
 */

import { MongoClient } from 'mongodb';
import { createHash } from 'crypto';
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const idxBook = args.indexOf('--book');
const idxList = args.indexOf('--book-list');
const BOOK = idxBook >= 0 ? args[idxBook + 1] : undefined;
const BOOK_LIST = idxList >= 0 ? args[idxList + 1] : undefined;
const CONCURRENCY = parseInt(args[args.indexOf('--concurrency') + 1] || '6', 10);
const OCR_JACCARD = 0.95;
const MIN_OCR_LEN = 80;

if (!BOOK && !BOOK_LIST) { console.error('--book <id> or --book-list <file> required'); process.exit(1); }

async function fetchSha(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

function normalize(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim(); }
function trigrams(text, n = 3) { const w = text.split(' ').filter(Boolean); const set = new Set(); for (let i = 0; i + n <= w.length; i++) set.add(w.slice(i, i + n).join(' ')); return set; }
function jaccard(a, b) { if (!a.size && !b.size) return 1; if (!a.size || !b.size) return 0; let inter = 0; for (const x of a) if (b.has(x)) inter++; return inter / (a.size + b.size - inter); }

async function pmap(items, fn, c) {
  const out = new Array(items.length); let i = 0;
  async function w() { while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: e.message }; } } }
  await Promise.all(Array.from({ length: Math.min(c, items.length) }, w));
  return out;
}

async function scanBook(db, bookId) {
  const book = await db.collection('books').findOne({ id: bookId }, { projection: { id: 1, slug: 1, title: 1, pages_count: 1 } });
  if (!book) return null;
  const pages = await db.collection('pages').find(
    { book_id: bookId, page_number: { $gt: 0 }, cropped_photo: { $exists: true, $ne: null } },
    { projection: { _id: 1, page_number: 1, page_type: 1, cropped_photo: 1, printed_pg: 1, 'ocr.data': 1 } }
  ).sort({ page_number: 1 }).toArray();

  const t0 = Date.now();
  const fetched = await pmap(pages, async (p) => {
    try { return { ...p, sha: await fetchSha(p.cropped_photo), ocrNorm: normalize(p.ocr?.data) }; }
    catch (e) { return { ...p, error: e.message }; }
  }, CONCURRENCY);

  const valid = fetched.filter(p => p.sha);

  // SHA groups
  const bySha = new Map();
  for (const p of valid) { if (!bySha.has(p.sha)) bySha.set(p.sha, []); bySha.get(p.sha).push(p); }
  const shaGroups = Array.from(bySha.values()).filter(g => g.length > 1);

  // OCR groups among pages not in sha groups
  const inSha = new Set();
  for (const g of shaGroups) for (const p of g) inSha.add(String(p._id));
  const ocrPages = valid.filter(p => !inSha.has(String(p._id)) && p.ocrNorm.length >= MIN_OCR_LEN);
  for (const p of ocrPages) p.trigrams = trigrams(p.ocrNorm);

  const ocrGroups = [];
  const assigned = new Set();
  for (let i = 0; i < ocrPages.length; i++) {
    if (assigned.has(i)) continue;
    const group = [ocrPages[i]];
    assigned.add(i);
    for (let j = i + 1; j < ocrPages.length; j++) {
      if (assigned.has(j)) continue;
      if (ocrPages[i].page_type !== ocrPages[j].page_type) continue;
      const sim = jaccard(ocrPages[i].trigrams, ocrPages[j].trigrams);
      if (sim >= OCR_JACCARD) { group.push({ ...ocrPages[j], sim }); assigned.add(j); }
    }
    if (group.length > 1) ocrGroups.push(group);
  }

  const proposals = {
    book_id: bookId,
    slug: book.slug,
    title: book.title,
    pages_count: book.pages_count,
    scanned: valid.length,
    failed: fetched.length - valid.length,
    scanned_at: new Date().toISOString(),
    elapsed_sec: ((Date.now() - t0) / 1000).toFixed(1),
    groups: [
      ...shaGroups.map(g => ({
        method: 'sha',
        members: g.map(p => ({
          _id: String(p._id), page_number: p.page_number, page_type: p.page_type,
          cropped_photo: p.cropped_photo, printed_pg: p.printed_pg ?? null,
          ocr_snippet: p.ocrNorm.slice(0, 200),
        })),
        sha: g[0].sha,
      })),
      ...ocrGroups.map(g => ({
        method: 'ocr',
        members: g.map(p => ({
          _id: String(p._id), page_number: p.page_number, page_type: p.page_type,
          cropped_photo: p.cropped_photo, printed_pg: p.printed_pg ?? null,
          ocr_snippet: p.ocrNorm.slice(0, 200),
          sim: p.sim ?? null,
        })),
      })),
    ],
  };

  const outPath = resolve(REPO_ROOT, '.claude/docs/dedup-proposals', `${bookId}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(proposals, null, 2));
  const totalDupes = proposals.groups.reduce((s, g) => s + g.members.length - 1, 0);
  console.log(`${bookId} ${(book.slug || '').slice(0, 50).padEnd(50)} pages=${pages.length}, sha-groups=${shaGroups.length}, ocr-groups=${ocrGroups.length}, dupes=${totalDupes} (${proposals.elapsed_sec}s)`);
  return proposals;
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

let bookIds = [];
if (BOOK) bookIds = [BOOK];
else if (BOOK_LIST) bookIds = readFileSync(BOOK_LIST, 'utf8').split('\n').map(s => s.trim()).filter(Boolean);

console.error(`bookIds: ${bookIds.length} → ${JSON.stringify(bookIds.slice(0, 3))}...`);

for (const bid of bookIds) {
  console.error(`>> scanning ${bid}`);
  try {
    await scanBook(db, bid);
  } catch (e) {
    console.error(`!! error on ${bid}: ${e.stack || e.message}`);
  }
}

await client.close();
