#!/usr/bin/env node
/**
 * Phase B: Rebuild a book's page ordering from its S3 archive.
 *
 * Approach:
 *   1. For each S3 jp2 (0001.jp2 .. NNNN.jp2 per book.archive.pages_count),
 *      decode via ImageMagick → JPEG → compute dHash. These hashes are the
 *      canonical positions 1..N.
 *   2. For each distinct Mongo spread upload (archived_photo URL), fetch and
 *      compute dHash.
 *   3. Match each Mongo spread → closest S3 archive (Hamming distance,
 *      threshold 12 considered safe; >12 = orphan).
 *   4. For each S3 archive position N:
 *      - 1 Mongo match: that spread's LEFT half → page_number 2N-1,
 *        RIGHT half → 2N
 *      - 2+ Mongo matches: keep lowest-Hamming as canonical, hide others
 *   5. Mongo spreads matching nothing: hide all their halves.
 *   6. Snapshot first; 2-phase update via temporary negative numbers to
 *      avoid uniqueness collisions during reassignment.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/phase-b-rebuild-from-s3.mjs --book <id>            # dry-run
 *   node scripts/phase-b-rebuild-from-s3.mjs --book <id> --apply
 */
import { execFileSync } from 'child_process';
import { MongoClient, ObjectId } from 'mongodb';
import sharp from 'sharp';
import { writeFileSync, readFileSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');

const args = process.argv.slice(2);
function flag(name, dflt) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : dflt;
}
const BOOK = flag('--book');
const APPLY = args.includes('--apply');
const CONCURRENCY = parseInt(flag('--concurrency', '4'), 10);
const HAMMING_THRESHOLD = parseInt(flag('--threshold', '12'), 10);
if (!BOOK) { console.error('--book <id> required'); process.exit(1); }

async function fetchBuf(url, retries = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`fetch ${url} → ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastErr;
}
async function dhash(buffer) {
  const raw = await sharp(buffer).greyscale().resize(9, 8, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();
  let hash = 0n; let bit = 63n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { if (raw[y * 9 + x] < raw[y * 9 + x + 1]) hash |= (1n << bit); bit--; }
  return hash.toString(16).padStart(16, '0');
}
function hamming(a, b) {
  let x = BigInt('0x' + a) ^ BigInt('0x' + b); let n = 0;
  while (x) { if (x & 1n) n++; x >>= 1n; }
  return n;
}
function jp2ToJpeg(jp2Buf) {
  const dir = mkdtempSync(join(tmpdir(), 'jp2-'));
  try {
    const jp2Path = join(dir, 'in.jp2'); const jpgPath = join(dir, 'out.jpg');
    writeFileSync(jp2Path, jp2Buf);
    execFileSync('magick', [jp2Path, '-quality', '80', '-resize', '800x800>', jpgPath], { stdio: 'pipe' });
    return readFileSync(jpgPath);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function pmap(items, fn, n) {
  const out = new Array(items.length);
  let i = 0;
  let errors = 0;
  let firstError = null;
  async function w() {
    while (i < items.length) {
      const k = i++;
      try {
        out[k] = await fn(items[k], k);
      } catch (e) {
        out[k] = { error: e.message };
        errors++;
        if (!firstError) firstError = e.message;
      }
    }
  }
  const workers = [];
  for (let j = 0; j < Math.min(n, items.length); j++) workers.push(w());
  await Promise.all(workers);
  if (errors > 0) console.error(`  pmap: ${errors}/${items.length} errored. First: ${firstError}`);
  return out;
}

const c = new MongoClient(process.env.MONGODB_URI);
await c.connect();
const db = c.db('bookstore');
const book = await db.collection('books').findOne({ id: BOOK }, { projection: { id: 1, slug: 1, title: 1, archive: 1, pages_count: 1 } });
if (!book || !book.archive?.pages_count) { console.error('book missing archive metadata'); await c.close(); process.exit(1); }
const N = book.archive.pages_count;
console.log(`${book.slug} | S3 archive: ${N} spreads | Mongo current visible pages: ${book.pages_count}`);

// ── Step 1: hash S3 archive ──
console.log(`\nHashing ${N} S3 archive spreads (ImageMagick decode)…`);
const t0 = Date.now();
const s3Hashes = await pmap(Array.from({ length: N }, (_, i) => i + 1), async (idx) => {
  const url = `https://images.sourcelibrary.org/archive/${BOOK}/${String(idx).padStart(4, '0')}.jp2`;
  const jp2 = await fetchBuf(url);
  const jpeg = jp2ToJpeg(jp2);
  return { idx, hash: await dhash(jpeg) };
}, CONCURRENCY);
const s3Errors = s3Hashes.filter(s => !s.hash).length;
console.log(`  Done in ${((Date.now() - t0) / 1000).toFixed(1)}s, errors: ${s3Errors}`);

// ── Step 2: hash distinct Mongo spreads ──
const allPages = await db.collection('pages').find({ book_id: BOOK }, { projection: { _id: 1, page_number: 1, page_type: 1, archived_photo: 1, crop: 1, photo: 1, cropped_photo: 1 } }).toArray();
const spreadMap = new Map();   // archived_photo URL → { pages: [...], hash, matched: { idx, dist } }
for (const p of allPages) {
  if (!p.archived_photo) continue;
  if (!spreadMap.has(p.archived_photo)) spreadMap.set(p.archived_photo, { url: p.archived_photo, pages: [] });
  spreadMap.get(p.archived_photo).pages.push(p);
}
console.log(`\nHashing ${spreadMap.size} distinct Mongo spread uploads…`);
const spreads = [...spreadMap.values()];
const t1 = Date.now();
await pmap(spreads, async (s) => {
  const buf = await fetchBuf(s.url);
  s.hash = await dhash(buf);
}, CONCURRENCY);
const mErrors = spreads.filter(s => !s.hash).length;
console.log(`  Done in ${((Date.now() - t1) / 1000).toFixed(1)}s, errors: ${mErrors}`);

// ── Step 3: match Mongo spreads → S3 archives ──
for (const s of spreads) {
  if (!s.hash) { s.matched = null; continue; }
  let best = null;
  for (const a of s3Hashes) {
    if (!a.hash) continue;
    const d = hamming(s.hash, a.hash);
    if (!best || d < best.dist) best = { idx: a.idx, dist: d };
  }
  s.matched = best && best.dist <= HAMMING_THRESHOLD ? best : { idx: null, dist: best?.dist };
}

const matched = spreads.filter(s => s.matched && s.matched.idx).length;
const orphaned = spreads.filter(s => s.matched && s.matched.idx == null).length;
console.log(`\nMatching: ${matched} matched | ${orphaned} orphaned (Hamming > ${HAMMING_THRESHOLD})`);

// Group spreads by matched S3 position
const byPosition = new Map();
for (const s of spreads) {
  if (s.matched?.idx == null) continue;
  if (!byPosition.has(s.matched.idx)) byPosition.set(s.matched.idx, []);
  byPosition.get(s.matched.idx).push(s);
}

let positionsCovered = 0, positionsMissing = 0, positionsWithDups = 0;
for (let i = 1; i <= N; i++) {
  const g = byPosition.get(i);
  if (!g) positionsMissing++;
  else { positionsCovered++; if (g.length > 1) positionsWithDups++; }
}
console.log(`S3 positions: ${positionsCovered}/${N} covered, ${positionsMissing} missing, ${positionsWithDups} with multiple Mongo matches (dups)`);

// ── Step 4: build the new page_number assignment ──
// canonical[N] = { left: page_id, right: page_id } from the lowest-Hamming Mongo spread
const assignments = []; // [{ page_id, new_page_number }]
const orphanIds = [];
for (const [idx, group] of byPosition.entries()) {
  group.sort((a, b) => a.matched.dist - b.matched.dist);
  const canonical = group[0];
  const dups = group.slice(1);
  // From canonical: find LEFT and RIGHT halves
  const visibleHalves = canonical.pages.filter(p => p.page_number > 0 && p.crop);
  // Heuristic for L/R: crop.xStart smaller → LEFT
  const left = visibleHalves.find(p => (p.crop?.xStart ?? 0) < 250);
  const right = visibleHalves.find(p => (p.crop?.xStart ?? 0) >= 250);
  if (left) assignments.push({ page_id: left._id, new_page_number: 2 * idx - 1, role: 'L' });
  if (right) assignments.push({ page_id: right._id, new_page_number: 2 * idx, role: 'R' });
  // Hide all duplicate spreads' halves
  for (const d of dups) for (const p of d.pages) if (p.page_number > 0) orphanIds.push({ page_id: p._id, was_pg: p.page_number, reason: 'dup-of-' + idx, canon_left: left?._id, canon_right: right?._id });
}
// Spreads matching nothing → all halves hidden
for (const s of spreads) {
  if (s.matched?.idx == null) {
    for (const p of s.pages) if (p.page_number > 0) orphanIds.push({ page_id: p._id, was_pg: p.page_number, reason: 'orphan' });
  }
}

// Also: archived-spread pages (full-spread page_type) for canonical spreads should stay hidden (page_number < 0 already). Those that belonged to ORPHAN spreads also stay hidden (no change).

console.log(`\nProposed: ${assignments.length} page-number reassignments | ${orphanIds.length} pages to hide`);

const summary = {
  book_id: BOOK, slug: book.slug, ts: new Date().toISOString(),
  s3_count: N, mongo_spread_count: spreads.length, matched, orphaned, positions_covered: positionsCovered, positions_missing: positionsMissing, positions_with_dups: positionsWithDups,
  hamming_threshold: HAMMING_THRESHOLD,
  reassignments_count: assignments.length, orphans_count: orphanIds.length,
};
console.log(JSON.stringify(summary, null, 2));

if (!APPLY) {
  // Save dry-run report
  const dryPath = resolve(REPO_ROOT, '.claude/docs', `phase-b-dryrun-${BOOK}.json`);
  mkdirSync(dirname(dryPath), { recursive: true });
  writeFileSync(dryPath, JSON.stringify({ summary, assignments: assignments.slice(0, 20), orphans: orphanIds.slice(0, 20), spreads_sample: spreads.slice(0, 10).map(s => ({ url: s.url, hash: s.hash, matched: s.matched })) }, null, 2));
  console.log(`Dry-run report: ${dryPath}`);
  console.log('\nAdd --apply to perform reassignment.');
  await c.close();
  process.exit(0);
}

// ── Step 5: snapshot + apply (2-phase via temp negative page_numbers) ──
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const snapPath = resolve(REPO_ROOT, '.claude/docs/snapshots', `phase-b-${BOOK}-${ts}.json`);
mkdirSync(dirname(snapPath), { recursive: true });
writeFileSync(snapPath, JSON.stringify({
  ...summary,
  pages_before: allPages.map(p => ({ _id: String(p._id), page_number: p.page_number })),
  assignments: assignments.map(a => ({ ...a, page_id: String(a.page_id) })),
  orphans: orphanIds.map(o => ({ ...o, page_id: String(o.page_id), canon_left: o.canon_left ? String(o.canon_left) : undefined, canon_right: o.canon_right ? String(o.canon_right) : undefined })),
}, null, 2));
console.log(`Snapshot: ${snapPath}`);

// 5a. Move all visible pages to temporary negative offsets to avoid uniqueness collisions.
//     We park them at -1000000 - (current page_number).
console.log('\n[apply] Phase 5a: park current visible pages to temp negative…');
await db.collection('pages').updateMany(
  { book_id: BOOK, page_number: { $gt: 0 } },
  [{ $set: { page_number: { $subtract: [-1000000, '$page_number'] } } }]
);

// 5b. Apply new page_numbers
console.log('[apply] Phase 5b: assign new canonical page_numbers…');
for (const a of assignments) {
  await db.collection('pages').updateOne(
    { _id: new ObjectId(String(a.page_id)) },
    { $set: { page_number: a.new_page_number, updated_at: new Date(), phase_b_role: a.role, phase_b_canonical_s3: Math.ceil(a.new_page_number / 2) } }
  );
}

// 5c. Mark orphans/dups as hidden
console.log('[apply] Phase 5c: hide orphans/dups…');
for (const o of orphanIds) {
  await db.collection('pages').updateOne(
    { _id: new ObjectId(String(o.page_id)) },
    { $set: {
      is_duplicate: true,
      duplicate_of: o.canon_left || o.canon_right ? new ObjectId(String(o.canon_left || o.canon_right)) : null,
      original_page_number: o.was_pg,
      page_number: -Math.abs(o.was_pg),
      dedup_source: 'phase-b-' + o.reason,
      updated_at: new Date(),
    } }
  );
}

// 5d. Any pages still at temp negative (-1000000 -) weren't reassigned — they're also orphans we missed
const stragglers = await db.collection('pages').find({ book_id: BOOK, page_number: { $lt: -999999 } }, { projection: { _id: 1, page_number: 1 } }).toArray();
console.log(`[apply] Phase 5d: ${stragglers.length} stragglers (parked but not reassigned)…`);
for (const s of stragglers) {
  const was = -1000000 - s.page_number;  // recover original
  await db.collection('pages').updateOne(
    { _id: s._id },
    { $set: { page_number: -Math.abs(was), original_page_number: was, is_duplicate: true, dedup_source: 'phase-b-straggler', updated_at: new Date() } }
  );
}

// 5e. Recount pages_count
const visible = await db.collection('pages').countDocuments({ book_id: BOOK, page_number: { $gt: 0 } });
await db.collection('books').updateOne({ id: BOOK }, { $set: { pages_count: visible, updated_at: new Date() } });
console.log(`[apply] Done. pages_count → ${visible}.`);

await c.close();
