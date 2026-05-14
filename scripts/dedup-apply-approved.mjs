#!/usr/bin/env node
/**
 * Apply only the dedup pairs that the user explicitly accepted in the
 * review UI (downloaded JSON from /tmp/dedup-review/<book_id>.html).
 *
 * Input: a decisions JSON with shape
 *   { book_id: "...", decisions: [{ dup_id, canon_id, method, decision: "accept" }, ...] }
 *
 * For each accepted pair:
 *   - Snapshot the book's pages BEFORE applying (for later rollback).
 *   - Set dup's page_number ← -original_page_number, is_duplicate=true,
 *     duplicate_of=canon._id, dedup_source="reviewed".
 *   - Re-sequence surviving pages 1..N.
 *   - Update books.pages_count.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-apply-approved.mjs --in decisions-<book_id>.json
 *   node scripts/dedup-apply-approved.mjs --in-dir /path/to/dir   # apply many
 */

import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const IN = args[args.indexOf('--in') + 1];
const IN_DIR = args[args.indexOf('--in-dir') + 1];

if (!IN && !IN_DIR) { console.error('--in <file.json> or --in-dir <dir> required'); process.exit(1); }

async function applyOne(db, decisionsObj) {
  const { book_id, decisions } = decisionsObj;
  const accepted = decisions.filter(d => d.decision === 'accept');
  if (accepted.length === 0) { console.log(`${book_id}: no accepted pairs, skipping`); return; }
  const book = await db.collection('books').findOne({ id: book_id }, { projection: { id: 1, slug: 1, pages_count: 1 } });
  if (!book) { console.log(`${book_id}: book not found`); return; }
  const allPagesBefore = await db.collection('pages').find({ book_id }, { projection: { _id: 1, page_number: 1 } }).toArray();
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `dedup-reviewed-${book_id}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify({ book_id, slug: book.slug, pages_count_before: book.pages_count, decisions_in: accepted, pages: allPagesBefore.map(p => ({ _id: String(p._id), page_number: p.page_number })) }, null, 2));

  let marked = 0;
  for (const d of accepted) {
    const dup = await db.collection('pages').findOne({ _id: new ObjectId(d.dup_id) }, { projection: { _id: 1, page_number: 1 } });
    if (!dup || dup.page_number <= 0) continue;
    await db.collection('pages').updateOne(
      { _id: dup._id },
      {
        $set: {
          is_duplicate: true,
          duplicate_of: new ObjectId(d.canon_id),
          original_page_number: dup.page_number,
          page_number: -Math.abs(dup.page_number),
          dedup_source: 'reviewed',
          dedup_method: d.method,
          updated_at: new Date(),
        },
      }
    );
    marked++;
  }

  // Re-sequence survivors
  const surviving = await db.collection('pages').find(
    { book_id, page_number: { $gt: 0 } },
    { projection: { _id: 1, page_number: 1 } }
  ).sort({ page_number: 1 }).toArray();
  for (let idx = 0; idx < surviving.length; idx++) {
    const target = idx + 1;
    if (surviving[idx].page_number !== target) {
      await db.collection('pages').updateOne({ _id: surviving[idx]._id }, { $set: { page_number: target, updated_at: new Date() } });
    }
  }
  await db.collection('books').updateOne({ id: book_id }, { $set: { pages_count: surviving.length, updated_at: new Date() } });
  console.log(`${book_id} ${(book.slug || '').slice(0, 50).padEnd(50)} marked=${marked}, surviving=${surviving.length} (was ${book.pages_count})`);
}

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db('bookstore');

if (IN) {
  await applyOne(db, JSON.parse(readFileSync(IN, 'utf8')));
} else if (IN_DIR) {
  for (const f of readdirSync(IN_DIR).filter(f => f.endsWith('.json'))) {
    await applyOne(db, JSON.parse(readFileSync(resolve(IN_DIR, f), 'utf8')));
  }
}

await client.close();
