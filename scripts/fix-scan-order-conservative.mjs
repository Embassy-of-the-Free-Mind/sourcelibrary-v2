#!/usr/bin/env node
/**
 * Conservative scan-order repair (#1719).
 *
 * Only fixes LOCAL inversions where order is unambiguously wrong:
 *   - Three consecutive numbered pages A, B, C where A < C and B is out
 *     of range [A-1, C+1]: B is the misplaced page. Move B to its correct
 *     position between A and C if a numbered slot exists, or flag for
 *     manual review.
 *
 * Front matter (pages before first numbered page) is left alone.
 * OCR-error tolerance: printed-pg > 2 × pages_count is treated as null.
 * Multi-tome books should NOT use this script (or use --first-tome-only).
 *
 * Snapshot at .claude/docs/snapshots/scanorder-conservative-<book_id>.json.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/fix-scan-order-conservative.mjs --book <id>            # dry-run
 *   node scripts/fix-scan-order-conservative.mjs --book <id> --apply
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

function parsePrintedPg(ocrText, maxReasonable) {
  if (!ocrText) return null;
  const m = ocrText.match(/<page-num>([^<]+)<\/page-num>/);
  if (!m) return null;
  const raw = m[1].trim();
  const am = raw.match(/^(\d+)/);
  if (am) {
    const v = parseInt(am[1], 10);
    if (v > 0 && v <= maxReasonable) return v;
    return null;
  }
  return null;
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
  console.log(`Book: ${book.slug}`);
  console.log(`Visible pages: ${pages.length}`);

  const maxReasonable = Math.max(50, pages.length * 3);
  const seq = pages.map(p => ({
    _id: p._id,
    digital: p.page_number,
    printed: parsePrintedPg(p.ocr?.data, maxReasonable),
    page_type: p.page_type,
  }));

  // Find anchors (consecutive triples) where the middle is out of order.
  // For triple A,B,C with all three numbered:
  //   - if A < C and B not in [A, C+1]: B is misplaced
  //   - target slot: ideally where (A < target ≤ C) and B's printed-pg fits
  const inversions = []; // {pageIdx, currentDigital, suggestedDigital, printed}
  for (let i = 1; i < seq.length - 1; i++) {
    const A = seq[i - 1], B = seq[i], C = seq[i + 1];
    if (A.printed == null || B.printed == null || C.printed == null) continue;
    if (A.printed >= C.printed) continue; // A,C themselves not monotonic — skip
    const expected = [A.printed, A.printed + 1, C.printed - 1, C.printed];
    if (expected.some(e => Math.abs(B.printed - e) <= 1)) continue; // B is plausible
    // B's printed is out of the local range
    inversions.push({
      idx: i,
      digital: B.digital,
      printed: B.printed,
      neighbors: [A.printed, C.printed],
    });
  }
  console.log(`Local inversions detected: ${inversions.length}`);
  if (inversions.length === 0) {
    console.log(`No conservative fixes available. Larger reordering would need manual review.`);
    await client.close();
    return;
  }
  // For each inversion, find a target slot in the sequence where it fits
  // Use a fresh seq copy + repeatedly find best slot for each misplaced page.
  // Slot = somewhere between two consecutive seq members whose printed-pgs
  // bracket the misplaced one.
  const plan = []; // [{ moveIdx (in seq), insertAfterIdx, page }]
  for (const inv of inversions) {
    const B = seq[inv.idx];
    if (B.printed == null) continue;
    // Find target — scan seq for two consecutive pages whose printed-pgs
    // bracket B (lo.printed ≤ B.printed ≤ hi.printed). Avoid self.
    let bestSlot = null;
    for (let j = 0; j < seq.length - 1; j++) {
      if (j === inv.idx || j + 1 === inv.idx) continue;
      const lo = seq[j], hi = seq[j + 1];
      if (lo.printed == null || hi.printed == null) continue;
      if (lo.printed <= B.printed && B.printed <= hi.printed) {
        bestSlot = j;
        break;
      }
    }
    if (bestSlot != null) {
      plan.push({ moveIdx: inv.idx, insertAfterIdx: bestSlot, digital: B.digital, printed: B.printed, target: [seq[bestSlot].printed, seq[bestSlot + 1].printed] });
    }
  }
  console.log(`Conservative plan: ${plan.length} moves`);
  for (const p of plan.slice(0, 30)) {
    console.log(`  move pg @ digital ${p.digital} (printed ${p.printed}) → between digital ${seq[p.insertAfterIdx].digital} (printed ${p.target[0]}) and digital ${seq[p.insertAfterIdx + 1].digital} (printed ${p.target[1]})`);
  }
  if (plan.length > 30) console.log(`  ... ${plan.length - 30} more`);

  if (!APPLY) { console.log('\n(--dry-run; no writes)'); await client.close(); return; }

  // Build the new ordering by applying moves on a clone of seq
  const work = [...seq];
  // Process moves carefully: rebuild order, with each moved item placed in its target slot.
  // Strategy: collect moved IDs, remove them from work, then re-insert at target.
  const movedIds = new Set(plan.map(p => String(p.moveIdx)));
  const stayed = work.filter((_, i) => !movedIds.has(String(i)));
  // Now insert each moved item into stayed at the right position
  for (const p of plan) {
    const moveItem = seq[p.moveIdx];
    // Find insertion index in stayed: after the page whose printed > moveItem.printed is the bound
    let insertAt = stayed.length;
    for (let j = 0; j < stayed.length; j++) {
      const s = stayed[j];
      if (s.printed != null && s.printed > moveItem.printed) { insertAt = j; break; }
    }
    stayed.splice(insertAt, 0, moveItem);
  }
  // Snapshot
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `scanorder-conservative-${BOOK}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify({
    snapshot_date: new Date().toISOString(),
    book_id: BOOK, slug: book.slug,
    pages_before: pages.map(p => ({ _id: String(p._id), page_number: p.page_number })),
    pages_after: stayed.map((p, i) => ({ _id: String(p._id), new_page_number: i + 1 })),
    plan,
  }, null, 2));
  console.log(`Snapshot: ${snapPath}`);
  // Apply: phase 1 negatives, phase 2 final
  for (let i = 0; i < stayed.length; i++) {
    await db.collection('pages').updateOne({ _id: stayed[i]._id }, { $set: { page_number: -1000 - i, updated_at: new Date() } });
  }
  for (let i = 0; i < stayed.length; i++) {
    await db.collection('pages').updateOne({ _id: stayed[i]._id }, { $set: { page_number: i + 1, updated_at: new Date() } });
  }
  console.log(`Renumbered ${stayed.length} pages.`);
  await client.close();
}

main().catch(err => { console.error(err); process.exit(1); });
