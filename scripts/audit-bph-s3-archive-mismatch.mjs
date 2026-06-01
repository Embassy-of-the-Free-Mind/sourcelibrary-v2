#!/usr/bin/env node
/**
 * For every BPH book that has a registered S3 archive (book.archive.source =
 * 'bph-s3'), compare canonical S3 spread count vs Mongo's actual spread count
 * and page count. Surface books where the numbers don't line up — those are
 * candidates for a clean rebuild from the S3 archive.
 *
 * Output: .claude/docs/bph-archive-mismatch.json + ranked summary on stdout.
 */
import { MongoClient } from 'mongodb';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

const books = await db.collection('books').find(
  { 'image_source.provider': 'bph', 'archive.source': 'bph-s3' },
  { projection: { id: 1, slug: 1, title: 1, pages_count: 1, 'archive.pages_count': 1, 'archive.archived_at': 1 } }
).toArray();
console.log(`BPH books with registered S3 archive: ${books.length}`);

const rows = [];
let processed = 0;
for (const b of books) {
  // Unique source spreads in Mongo for this book
  const spreads = await db.collection('pages').distinct('archived_photo', { book_id: b.id, archived_photo: { $exists: true, $ne: null } });
  const visiblePages = await db.collection('pages').countDocuments({ book_id: b.id, page_number: { $gt: 0 } });
  // Detect page_number collisions
  const pages = await db.collection('pages').find({ book_id: b.id, page_number: { $gt: 0 } }, { projection: { page_number: 1 } }).toArray();
  const cnt = {};
  for (const p of pages) cnt[p.page_number] = (cnt[p.page_number] || 0) + 1;
  const collisions = Object.values(cnt).filter(n => n > 1).length;

  const s3 = b.archive.pages_count || 0;
  const extraSpreads = spreads.length - s3;
  rows.push({
    id: b.id, slug: b.slug, title: (b.title || b.slug || '').slice(0, 60),
    s3_spreads: s3, mongo_spreads: spreads.length, extra_spreads: extraSpreads,
    visible_pages: visiblePages, pagenum_collisions: collisions,
    archived_at: b.archive.archived_at,
  });
  processed++;
  if (processed % 100 === 0) console.log(`  ${processed}/${books.length}…`);
}

rows.sort((a, b) => (b.extra_spreads + b.pagenum_collisions * 4) - (a.extra_spreads + a.pagenum_collisions * 4));
const out = resolve(REPO_ROOT, '.claude/docs/bph-archive-mismatch.json');
writeFileSync(out, JSON.stringify(rows, null, 2));

console.log(`\nTotals across ${books.length} BPH books:`);
console.log(`  matching exactly (no extras, no collisions): ${rows.filter(r => r.extra_spreads === 0 && r.pagenum_collisions === 0).length}`);
console.log(`  has extra spreads: ${rows.filter(r => r.extra_spreads > 0).length}`);
console.log(`  has page_number collisions: ${rows.filter(r => r.pagenum_collisions > 0).length}`);
console.log(`\nTop 20 worst (by extras + 4×collisions):`);
for (const r of rows.slice(0, 20)) {
  console.log(`  +${String(r.extra_spreads).padStart(3)} spreads, ${String(r.pagenum_collisions).padStart(3)} collisions  |  s3=${r.s3_spreads} mongo_spreads=${r.mongo_spreads} visible=${r.visible_pages}  |  ${r.slug}`);
}
console.log(`\nReport: ${out}`);
await c.close();
