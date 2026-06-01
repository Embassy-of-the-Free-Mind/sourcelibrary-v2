#!/usr/bin/env node
/**
 * Apply vision-confirmed SAME collision-pair dedup.
 *
 * Reads .claude/docs/all-collision-vision-audit.json. For each pair where
 * verdict === 'same', hides the later-created doc (dup_id) and points it
 * at the earlier doc (keep_id). DIFFERENT and UNSURE verdicts are left
 * untouched (those need Phase B S3-mapping).
 *
 * For each book that has SAME pairs:
 *   - Snapshot the book's pages to .claude/docs/snapshots/collision-dedup-<id>-<ts>.json
 *   - Mark each SAME-pair dup: is_duplicate=true, duplicate_of=keep_id,
 *     original_page_number=p.page_number, page_number=-abs(...), dedup_source='collision-vision'
 *   - NO re-sequencing (hide-only mode — preserve citations)
 *   - Update books.pages_count to count of visible pages
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/apply-collision-dedup.mjs --dry-run
 *   node scripts/apply-collision-dedup.mjs --apply
 */
import { MongoClient, ObjectId } from 'mongodb';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const APPLY = process.argv.includes('--apply');
const audit = JSON.parse(readFileSync(resolve(REPO_ROOT, '.claude/docs/all-collision-vision-audit.json'), 'utf8'));

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');

let totalSame = 0, totalApplied = 0;
let booksAffected = 0;
for (const b of audit) {
  const samePairs = (b.pairs || []).filter(p => p.verdict === 'same');
  if (samePairs.length === 0) continue;
  totalSame += samePairs.length;
  booksAffected++;
  if (!APPLY) {
    console.log(`  ${(b.slug || b.id).slice(0, 60).padEnd(60)} would hide ${samePairs.length} dups`);
    continue;
  }
  // Snapshot
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const allPages = await db.collection('pages').find({ book_id: b.id }, { projection: { _id: 1, page_number: 1 } }).toArray();
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `collision-dedup-${b.id}-${ts}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify({
    book_id: b.id, slug: b.slug, ts,
    pairs: samePairs,
    pages: allPages.map(p => ({ _id: String(p._id), page_number: p.page_number })),
  }, null, 2));

  for (const p of samePairs) {
    const dupOid = new ObjectId(p.dup_id);
    const dup = await db.collection('pages').findOne({ _id: dupOid }, { projection: { page_number: 1 } });
    if (!dup || dup.page_number <= 0) continue;
    await db.collection('pages').updateOne(
      { _id: dupOid },
      { $set: {
        is_duplicate: true,
        duplicate_of: new ObjectId(p.keep_id),
        original_page_number: dup.page_number,
        page_number: -Math.abs(dup.page_number),
        dedup_source: 'collision-vision',
        updated_at: new Date(),
      } }
    );
    totalApplied++;
  }
  // Recount pages_count
  const visible = await db.collection('pages').countDocuments({ book_id: b.id, page_number: { $gt: 0 } });
  await db.collection('books').updateOne({ id: b.id }, { $set: { pages_count: visible, updated_at: new Date() } });
}

console.log(`\n${APPLY ? 'Hidden' : 'Would hide'}: ${APPLY ? totalApplied : totalSame} pages across ${booksAffected} books`);
console.log(audit.length, 'books audited total');
await c.close();
