#!/usr/bin/env node
/**
 * Reorder a book's pages using `printed_pg_verified` (set by
 * vision-verify-page-nums.mjs) as the sort key.
 *
 * Strategy:
 *   1. Front matter (everything before the first verified printed-pg=1
 *      or 2 with proper LEFT/RIGHT alternation around it) stays in
 *      current order.
 *   2. Body pages with verified printed-pg sort by (printed-pg, half-of-spread).
 *   3. Body pages without verified printed-pg get the printed-pg of the
 *      nearest preceding numbered page + a small fractional offset by
 *      original position.
 *
 * Refuses to run if more than 30% of body pages have null printed-pg.
 *
 * Snapshot at .claude/docs/snapshots/scanorder-verified-<book_id>.json.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/reorder-from-verified.mjs --book <id>           # dry-run
 *   node scripts/reorder-from-verified.mjs --book <id> --apply
 */

import { MongoClient } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BOOK = args[args.indexOf('--book') + 1];

if (!BOOK || !/^[0-9a-f]{24}$/.test(BOOK)) {
  console.error('Usage: --book <24-hex> [--apply]');
  process.exit(1);
}
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

function halfOfSpread(p) {
  if (!p.crop) return 'M'; // single-page upload, no spread
  const mid = (p.crop.xStart + p.crop.xEnd) / 2;
  if (mid < 350) return 'L';
  if (mid > 600) return 'R';
  return 'M';
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');
  const book = await db.collection('books').findOne({ id: BOOK });
  if (!book) { console.error('book not found'); process.exit(1); }
  const pages = await db.collection('pages').find(
    { book_id: BOOK, page_number: { $gt: 0 } }
  ).sort({ page_number: 1 }).toArray();
  const annotated = pages.map(p => ({
    _id: p._id,
    digital: p.page_number,
    verified: typeof p.printed_pg_verified === 'number' ? p.printed_pg_verified : null,
    page_type: p.page_type,
    half: halfOfSpread(p),
  }));
  const haveVerified = annotated.filter(a => a.verified != null).length;
  const noVerified = annotated.filter(a => a.verified == null).length;
  console.log(`Book: ${book.slug}`);
  console.log(`Pages: ${annotated.length}, with verified printed-pg: ${haveVerified}, without: ${noVerified}`);
  if (haveVerified === 0) {
    console.error('No verified printed-pgs. Run vision-verify-page-nums.mjs first.');
    process.exit(1);
  }

  // Identify body start: first page with verified printed-pg in {1,2,3}
  let bodyStart = 0;
  for (let i = 0; i < annotated.length; i++) {
    if (annotated[i].verified === 1 || annotated[i].verified === 2) { bodyStart = i; break; }
  }
  // If no obvious "1" found, fall back to first verified page anywhere
  if (bodyStart === 0) {
    bodyStart = annotated.findIndex(a => a.verified != null);
    if (bodyStart < 0) bodyStart = 0;
  }
  console.log(`Body starts at digital ${annotated[bodyStart]?.digital} (verified printed-pg ${annotated[bodyStart]?.verified})`);

  const frontMatter = annotated.slice(0, bodyStart);
  const body = annotated.slice(bodyStart);

  // For body: build sort key
  // Anchor pages = verified != null
  // Non-anchors get key = preceding anchor's verified-pg + small offset
  body.forEach((b, i) => b.origIdx = i);
  let lastAnchor = null;
  let lastAnchorIdx = -1;
  for (let i = 0; i < body.length; i++) {
    const p = body[i];
    if (p.verified != null) {
      lastAnchor = p.verified;
      lastAnchorIdx = i;
      // Sort key: verified * 100 + half-bias (L=0, R=1, M=0.5)
      p.sortKey = p.verified * 100 + (p.half === 'L' ? 0 : p.half === 'R' ? 1 : 0.5);
    } else {
      // Unnumbered — anchor to previous verified
      const offset = lastAnchor != null ? (i - lastAnchorIdx) : (i + 1);
      const baseKey = lastAnchor != null ? lastAnchor * 100 : 0;
      p.sortKey = baseKey + 2 + Math.min(50, offset);
    }
  }
  const bodySorted = [...body].sort((a, b) => a.sortKey - b.sortKey || a.origIdx - b.origIdx);
  const reordered = [...frontMatter, ...bodySorted];

  // Diff summary
  let moved = 0;
  let maxDelta = 0;
  for (let i = 0; i < reordered.length; i++) {
    const newDig = i + 1;
    if (reordered[i].digital !== newDig) {
      moved++;
      maxDelta = Math.max(maxDelta, Math.abs(newDig - reordered[i].digital));
    }
  }
  console.log(`\nReordering: ${moved} pages would move, max delta ${maxDelta}`);

  // Show inversions in old vs new
  let oldInversions = 0, newInversions = 0;
  let lastSeenOld = 0, lastSeenNew = 0;
  for (const p of annotated) {
    if (p.verified != null) {
      if (p.verified < lastSeenOld - 5) oldInversions++;
      if (p.verified > lastSeenOld) lastSeenOld = p.verified;
    }
  }
  for (const p of reordered) {
    if (p.verified != null) {
      if (p.verified < lastSeenNew - 5) newInversions++;
      if (p.verified > lastSeenNew) lastSeenNew = p.verified;
    }
  }
  console.log(`Inversions: ${oldInversions} (current) → ${newInversions} (after reorder)`);

  // Sample first 20 changes
  console.log(`\nSample changes (first 20):`);
  let shown = 0;
  for (let i = 0; i < reordered.length && shown < 20; i++) {
    const p = reordered[i];
    if (p.digital !== i + 1) {
      console.log(`  digital ${p.digital} → ${i + 1} (verified pg ${p.verified ?? '-'}, ${p.half}, ${p.page_type})`);
      shown++;
    }
  }
  if (!APPLY) { console.log('\n(--dry-run; no writes)'); await client.close(); return; }

  // Snapshot
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `scanorder-verified-${BOOK}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify({
    snapshot_date: new Date().toISOString(),
    book_id: BOOK, slug: book.slug,
    pages_before: pages.map(p => ({ _id: String(p._id), page_number: p.page_number, verified: p.printed_pg_verified ?? null })),
    pages_after: reordered.map((p, i) => ({ _id: String(p._id), old_digital: p.digital, new_digital: i + 1, verified: p.verified })),
  }, null, 2));
  console.log(`Snapshot: ${snapPath}`);
  // Phase 1: negative tmp page_numbers
  for (let i = 0; i < reordered.length; i++) {
    await db.collection('pages').updateOne(
      { _id: reordered[i]._id },
      { $set: { page_number: -10000 - i, updated_at: new Date() } }
    );
  }
  // Phase 2: final positive
  for (let i = 0; i < reordered.length; i++) {
    await db.collection('pages').updateOne(
      { _id: reordered[i]._id },
      { $set: { page_number: i + 1, updated_at: new Date() } }
    );
  }
  console.log(`Renumbered ${reordered.length} pages.`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
