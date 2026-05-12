#!/usr/bin/env node
/**
 * Per-book scan-order repair (#1719).
 *
 * Works on ONE book at a time. Builds a proposed reordering using the
 * printed page-num parsed from OCR. Places unnumbered pages (frontispiece,
 * blank, dedication, preface, toc, illustration, etc.) by interpolation
 * between their numbered neighbors.
 *
 * Multi-tome detection: optional `--tome-resets <digital_pg>,<digital_pg>...`
 * argument names the digital-pg indices where a NEW tome starts. Within
 * each tome the script sorts independently; between tomes the relative
 * order is preserved. If --tome-resets is empty, the entire book is one
 * tome.
 *
 * OCR-error tolerance:
 *   - parses printed-pg with /(\d+)/, takes the first int.
 *   - filters out values > (max-reasonable-pg ≈ 2 × pages_count) — those
 *     are almost certainly OCR errors (e.g., "141" for printed pg "14").
 *
 * Conservative defaults: front-matter (everything before the first
 * confidently-numbered body page) is left in current order.
 *
 * Snapshot at .claude/docs/snapshots/scanorder-<book_id>.json.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/fix-scan-order.mjs --book <id> --dry-run
 *   node scripts/fix-scan-order.mjs --book <id> --tome-resets 250,488 --apply
 */

import { MongoClient, ObjectId } from 'mongodb';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const BOOK = args[args.indexOf('--book') + 1];
const TOME_RESETS = (() => {
  const idx = args.indexOf('--tome-resets');
  if (idx === -1) return [];
  return args[idx + 1].split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
})();

if (!BOOK || !/^[0-9a-f]{24}$/.test(BOOK)) {
  console.error('Usage: --book <24-hex> [--tome-resets a,b,c] [--apply]');
  process.exit(1);
}
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) { console.error('MONGODB_URI not set.'); process.exit(1); }

function parsePrintedPg(ocrText, maxReasonable) {
  if (!ocrText) return null;
  const m = ocrText.match(/<page-num>([^<]+)<\/page-num>/);
  if (!m) return null;
  const raw = m[1].trim();
  // Try Arabic first
  const am = raw.match(/(\d+)/);
  if (am) {
    const v = parseInt(am[1], 10);
    if (v > 0 && v <= maxReasonable) return v;
    return null; // likely OCR error
  }
  // Try Roman numerals (common in front matter)
  const r = raw.toUpperCase().replace(/[^IVXLCDM]/g, '');
  if (r && /^[IVXLCDM]+$/.test(r)) {
    return parseRoman(r);
  }
  return null;
}

function parseRoman(s) {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0, prev = 0;
  for (let i = s.length - 1; i >= 0; i--) {
    const cur = v[s[i]];
    if (cur < prev) total -= cur; else total += cur;
    prev = cur;
  }
  return total > 0 && total < 1000 ? -total : null; // negative = roman (orders before arabic)
}

function halfOfSpread(p) {
  if (!p.crop) return null;
  const w = (p.crop.xEnd || 0) - (p.crop.xStart || 0);
  const mid = (p.crop.xStart || 0) + w / 2;
  if (mid < 350) return 'L';
  if (mid > 600) return 'R';
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
  console.log(`Book: ${book.slug} (${BOOK})`);
  console.log(`Current pages_count: ${book.pages_count}, visible pages: ${pages.length}`);

  const maxReasonable = Math.max(50, pages.length * 3);

  // Parse printed-pg per page
  const annotated = pages.map(p => ({
    _id: p._id,
    digital: p.page_number,
    printed: parsePrintedPg(p.ocr?.data, maxReasonable),
    page_type: p.page_type,
    half: halfOfSpread(p),
    archived_photo: p.archived_photo,
  }));

  // Split into tomes
  const tomeRanges = [];
  let start = 0;
  for (const reset of TOME_RESETS) {
    const idx = annotated.findIndex((a, i) => i >= start && a.digital >= reset);
    if (idx > start) {
      tomeRanges.push([start, idx - 1]);
      start = idx;
    }
  }
  tomeRanges.push([start, annotated.length - 1]);
  console.log(`Tomes: ${tomeRanges.length}`);

  // Sort each tome separately and concat
  const reordered = [];
  for (const [lo, hi] of tomeRanges) {
    const tome = annotated.slice(lo, hi + 1);
    // Identify body start: first page with a positive printed-pg in {1,2,3} or first non-front-matter
    const FRONT_TYPES = new Set(['blank', 'frontispiece', 'title-page', 'dedication', 'preface', 'toc']);
    let bodyStart = 0;
    for (let i = 0; i < tome.length; i++) {
      if (tome[i].printed && tome[i].printed > 0 && tome[i].printed <= 5) { bodyStart = i; break; }
      if (!FRONT_TYPES.has(tome[i].page_type)) { bodyStart = i; break; }
    }
    const frontMatter = tome.slice(0, bodyStart); // keep current order
    const body = tome.slice(bodyStart);

    // For body pages: assign a sortable key
    // 1. Anchors = pages with valid positive printed-pg
    // 2. Non-anchors: get the key from their nearest preceding anchor (current-digital-pg-wise),
    //    plus a fractional offset by their original digital position.
    // 3. Stable tiebreak: anchored pages sorted by (printed, half L<R), unanchored
    //    placed at fractional positions.
    for (let i = 0; i < body.length; i++) body[i].origIdx = i;
    const anchorIdxs = body.map((b, i) => b.printed && b.printed > 0 ? i : -1).filter(i => i >= 0);
    if (anchorIdxs.length === 0) {
      // No anchors — keep current order
      reordered.push(...frontMatter, ...body);
      continue;
    }
    // For each page, assign sortKey = (printed-pg of nearest preceding anchor) + (offset within span)
    let lastAnchorPrinted = body[anchorIdxs[0]].printed;
    let lastAnchorIdx = anchorIdxs[0];
    for (let i = 0; i < body.length; i++) {
      const p = body[i];
      if (p.printed && p.printed > 0) {
        lastAnchorPrinted = p.printed;
        lastAnchorIdx = i;
        p.sortKey = p.printed * 1000 + (p.half === 'R' ? 1 : 0);
      } else {
        // unnumbered — anchor to previous numbered's neighborhood
        // offset slightly so adjacent unnumbered keep relative order, but won't outrank the next anchor
        const offset = (i - lastAnchorIdx);
        p.sortKey = lastAnchorPrinted * 1000 + (p.half === 'R' ? 1 : 0) + Math.min(0.5, offset * 0.01);
      }
    }
    const bodySorted = [...body].sort((a, b) => a.sortKey - b.sortKey || a.origIdx - b.origIdx);
    reordered.push(...frontMatter, ...bodySorted);
  }

  // Build diff
  let movedCount = 0;
  let maxDelta = 0;
  const changes = [];
  for (let newIdx = 0; newIdx < reordered.length; newIdx++) {
    const p = reordered[newIdx];
    const newDigital = newIdx + 1;
    const delta = newDigital - p.digital;
    if (delta !== 0) {
      movedCount++;
      maxDelta = Math.max(maxDelta, Math.abs(delta));
      changes.push({ was: p.digital, now: newDigital, printed: p.printed, type: p.page_type });
    }
  }
  console.log(`\nProposed reorder: ${movedCount} pages move, max delta ${maxDelta}`);
  // Show first 20 changes
  console.log(`Sample first 25 changes:`);
  for (const c of changes.slice(0, 25)) {
    console.log(`  digital ${c.was} → ${c.now}  (printed ${c.printed ?? '-'}, ${c.type})`);
  }

  // Verify new order has monotonic printed-pgs in body
  let badJumps = 0;
  let lastPrinted = 0;
  for (const p of reordered) {
    if (p.printed && p.printed > lastPrinted - 10) {
      if (p.printed >= lastPrinted) lastPrinted = p.printed;
    } else if (p.printed && p.printed < lastPrinted - 10) {
      badJumps++;
    }
  }
  console.log(`Post-reorder bad jumps (printed dropped > 10): ${badJumps}`);

  if (!APPLY) {
    console.log(`\n(--dry-run; no writes)`);
    await client.close();
    return;
  }

  // Snapshot
  const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `scanorder-${BOOK}.json`);
  mkdirSync(dirname(snapPath), { recursive: true });
  writeFileSync(snapPath, JSON.stringify({
    snapshot_date: new Date().toISOString(),
    book_id: BOOK, slug: book.slug,
    tome_resets: TOME_RESETS,
    pages: pages.map(p => ({ _id: String(p._id), page_number: p.page_number })),
    reorder: reordered.map((p, i) => ({ _id: String(p._id), old_digital: p.digital, new_digital: i + 1, printed: p.printed })),
  }, null, 2));
  console.log(`Snapshot: ${snapPath}`);

  // Apply: 2-phase to avoid uniqueness collisions
  // Phase 1: set to negative -1000-i (temp)
  for (let i = 0; i < reordered.length; i++) {
    await db.collection('pages').updateOne(
      { _id: reordered[i]._id },
      { $set: { page_number: -1000 - i, updated_at: new Date() } }
    );
  }
  // Phase 2: set to final positive page_numbers
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
