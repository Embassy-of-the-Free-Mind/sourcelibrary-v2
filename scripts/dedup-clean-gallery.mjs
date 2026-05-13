#!/usr/bin/env node
/**
 * Hide gallery_images entries that point to pages that were dedup-hidden.
 *
 * For each `dedup-reviewed-<book_id>-<ts>.json` snapshot:
 *   - Get the dup_id list of accepted decisions
 *   - Mark gallery_images with `page_id` in that list: is_duplicate=true,
 *     duplicate_of_page=<canon_id>, book_visible=false (so it won't show
 *     in gallery list views).
 *
 * Reversible — to un-hide, just unset the same fields.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/dedup-clean-gallery.mjs --dry-run
 *   node scripts/dedup-clean-gallery.mjs --apply
 */

import { MongoClient } from 'mongodb';
import { readdirSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const APPLY = process.argv.includes('--apply');

const snapDir = resolve(REPO_ROOT, '.claude/docs/snapshots');
const files = readdirSync(snapDir).filter(f => f.startsWith('dedup-reviewed-') && f.endsWith('.json'));

// Group by book_id, take the union of dup_ids across snapshots
const byBook = new Map();
for (const f of files) {
  const s = JSON.parse(readFileSync(resolve(snapDir, f), 'utf8'));
  if (!byBook.has(s.book_id)) byBook.set(s.book_id, { slug: s.slug, dupIds: new Set(), canonOf: new Map() });
  const e = byBook.get(s.book_id);
  for (const d of s.decisions_in || []) {
    e.dupIds.add(d.dup_id);
    e.canonOf.set(d.dup_id, d.canon_id);
  }
}

console.log(`${byBook.size} books to process`);

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

let totalAffected = 0;
let booksAffected = 0;
let i = 0;
for (const [bookId, info] of byBook.entries()) {
  i++;
  const dupIds = Array.from(info.dupIds);
  if (dupIds.length === 0) continue;
  const match = { book_id: bookId, page_id: { $in: dupIds } };
  const count = await db.collection('gallery_images').countDocuments(match);
  if (count === 0) continue;
  totalAffected += count;
  booksAffected++;
  if (!APPLY) {
    if (booksAffected % 25 === 0 || count > 5) console.log(`  ${i}/${byBook.size}  ${(info.slug || '').slice(0, 50).padEnd(50)} ${count} gallery entries to hide`);
    continue;
  }
  // Apply
  await db.collection('gallery_images').updateMany(
    match,
    { $set: { is_duplicate: true, book_visible: false, dedup_hidden_at: new Date(), updated_at: new Date() } }
  );
  if (booksAffected % 25 === 0) console.log(`  ${i}/${byBook.size}  ${booksAffected} books, ${totalAffected} gallery entries hidden`);
}

console.log(`\n${APPLY ? 'Hidden' : 'Would hide'}: ${totalAffected} gallery entries across ${booksAffected} books.`);
await c.close();
