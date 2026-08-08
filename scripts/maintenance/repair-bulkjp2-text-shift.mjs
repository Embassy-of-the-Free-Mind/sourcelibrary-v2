#!/usr/bin/env node
/**
 * Text-shift repair for the bulk-JP2 leaf offset (#3368) — the SELF-CONSISTENT
 * cohort. Mirrors scripts/maintenance/repair-erara-text-shift.mjs.
 *
 * archive-bulk.mjs equated the IA *_jp2.zip ordinal with the IIIF leaf number;
 * on items with a leading excluded leaf (Color Card etc.) every archived image
 * is one leaf behind the true sequence. Audit: scripts/audit/
 * bulk-archive-alignment.mjs. What decides the repair path is which image the
 * OCR was transcribed from:
 *
 *   - Pages OCR'd BEFORE archival read the IIIF source: their TEXT is correct
 *     and the IMAGE is the outlier. Those books (severity high/partial) are
 *     repaired image-side by repair-bulk-jp2-offset.mjs. This script REFUSES
 *     them — shifting their (correct) text would corrupt it.
 *   - Pages OCR'd AFTER archival read the shifted archive: their text runs one
 *     leaf behind the true sequence, exactly the e-rara shape. For those
 *     (severity:none books) the correct text for page N sits on page N+1, and
 *     THIS script moves it: text p(N+1) -> p(N) over the bulk_jp2 pages, last
 *     page of each run cleared + flagged needs_reocr.
 *
 * ⚠ SEQUENCING: a severity:none book is currently self-consistent — text and
 * image agree (both shifted). Shifting the text alone makes the truth better
 * but the READING experience worse until the images are re-archived from IIIF.
 * Complete the repair by re-archiving the images afterwards (and purging
 * Cloudflare); the book_events record and the
 * archive_metadata.jp2_text_shift_awaiting_image_rearchive flag track that.
 *
 * Every replaced ocr/translation value is snapshotted to page_revisions first
 * (source: 'shift-repair-bulkjp2-2026-08') and each book gets a book_events
 * record — fully reversible. The shift transform itself is pure and
 * unit-tested: scripts/lib/text-shift.mjs.
 *
 * Guards (all fail closed):
 *   - only books the audit called shift+1 (--from), or re-derived live
 *     (--rederive / --book) via the shared dHash check with the vote gate of
 *     repair-bulk-jp2-offset.mjs (>=2 shift votes, ZERO aligned votes);
 *   - REFUSE books with any pre-archival bulk_jp2 OCR (their text is correct);
 *   - skip books already image-repaired (jp2_offset_repaired) — their stale
 *     pages carry needs_reocr flags and a whole-book shift would be wrong;
 *   - skip books with hidden_reason set (takedowns etc. — #3099: sweeps must
 *     respect it);
 *   - skip books containing split pages (flagged for manual repair);
 *   - idempotent via book_events (existing text_shift_repair event = skip).
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/repair-bulkjp2-text-shift.mjs --from scripts/output/bulk-archive-alignment.jsonl            # dry run
 *   node scripts/maintenance/repair-bulkjp2-text-shift.mjs --from scripts/output/bulk-archive-alignment.jsonl --apply
 *   node scripts/maintenance/repair-bulkjp2-text-shift.mjs --book <mongoIdString>                                        # single book, re-derives live
 *   node scripts/maintenance/repair-bulkjp2-text-shift.mjs --from <jsonl> --rederive --limit 5 --apply
 *
 * Flags:
 *   --from PATH   JSONL from scripts/audit/bulk-archive-alignment.mjs; rows
 *                 with verdict shift+1 are the candidate set
 *   --book ID     candidate book by Mongo _id string (repeatable; implies a
 *                 live re-derive for that book unless --from also lists it)
 *   --rederive    re-run the dHash alignment check live instead of trusting
 *                 the audit rows (network: archive.org + R2)
 *   --limit N     stop after N candidate books
 *   --apply       write; default is dry run
 */

import { MongoClient } from 'mongodb';
import fs from 'fs';
import dotenv from 'dotenv';
import { nanoid } from 'nanoid';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { checkAlignment, hashBuffer, readerVisibleShift } from '../lib/page-alignment.mjs';
import { computeTextShiftMoves, SHIFT_FIELDS } from '../lib/text-shift.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
dotenv.config({ path: resolve(REPO_ROOT, '.env.production.local') });
dotenv.config({ path: resolve(REPO_ROOT, '.env.local') });

const args = process.argv.slice(2);
/** Accept both `--name value` and `--name=value`. */
const flag = (name, dflt) => {
  const eq = args.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : dflt;
};
const APPLY = args.includes('--apply');
const REDERIVE = args.includes('--rederive');
const FROM = flag('from');
const LIMIT = parseInt(flag('limit', '0'), 10) || 0;
const BOOKS = args.flatMap((a, i) => {
  if (a.startsWith('--book=')) return [a.slice(7)];
  if (a === '--book' && args[i + 1]) return [args[i + 1]];
  return [];
});

const SOURCE_LABEL = 'shift-repair-bulkjp2-2026-08';
const IA_LEAF_RE = /\/page\/n\d+/;
const thumbnail = u => String(u).replace(/\/full\/pct:\d+\//, '/full/pct:12/');

async function hashUrl(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return hashBuffer(Buffer.from(await r.arrayBuffer()));
}

/** Candidate list: audit rows (verdict shift+1) and/or explicit --book ids. */
function buildQueue() {
  const queue = [];
  const seen = new Set();
  const push = (id, fromAudit) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    queue.push({ id, fromAudit });
  };
  if (FROM) {
    const rows = fs.readFileSync(FROM, 'utf8').trim().split('\n')
      .filter(l => l.trim()).map(l => JSON.parse(l));
    const shifted = rows.filter(r => r.verdict === 'shift+1');
    // Worst-off-in-this-cohort first: most self-consistent (= shifted-text) pages.
    shifted.sort((a, b) => (b.self_consistent_pages || 0) - (a.self_consistent_pages || 0));
    for (const r of shifted) push(r.book_id, true);
    console.log(`from-audit: ${rows.length} rows, ${shifted.length} shift+1 candidates`);
  }
  for (const id of BOOKS) push(id, false);
  return queue;
}

async function repairBook(db, { id: bookId, fromAudit }) {
  const book = await db.collection('books').findOne(
    { $expr: { $eq: [{ $toString: '$_id' }, bookId] } },
    { projection: { title: 1, id: 1, visible: 1, hidden_reason: 1, archive_metadata: 1 } },
  );
  if (!book) { console.log(`[SKIP] ${bookId}: book not found`); return 'error'; }

  console.log(`\n=== ${(book.title || '').slice(0, 66)}`);
  console.log(`    ${bookId} | visible=${book.visible === true}`);

  // Takedowns and other deliberate hides: leave their text alone (#3099).
  if (book.hidden_reason) {
    console.log(`  [SKIP] hidden_reason set (${String(book.hidden_reason).slice(0, 60)}) — not touching`);
    return 'skipped-hidden';
  }
  // Image-repaired books had their stale pages flagged needs_reocr by
  // repair-bulk-jp2-offset.mjs; a whole-book shift on top would be wrong.
  if (book.archive_metadata?.jp2_offset_repaired) {
    console.log('  [SKIP] images already re-archived (jp2_offset_repaired) — stale pages are flagged needs_reocr, nothing to shift');
    return 'skipped-repaired';
  }
  const already = await db.collection('book_events').findOne(
    { book_id: bookId, type: 'text_shift_repair' }, { projection: { _id: 1 } });
  if (already) { console.log('  [SKIP] already repaired (book_events)'); return 'skipped-done'; }

  const pages = await db.collection('pages').find({ book_id: bookId })
    .sort({ page_number: 1 }).toArray();
  const bulk = pages.filter(p => p.archive_metadata?.source === 'bulk_jp2');
  console.log(`    ${pages.length} pages, ${bulk.length} bulk_jp2`);
  if (!bulk.length) { console.log('  [SKIP] no bulk_jp2 pages'); return 'skipped-nobulk'; }

  if (pages.some(p => p.split_side)) {
    console.log('  [SKIP] split pages present — flagging for manual repair');
    if (APPLY) {
      await db.collection('books').updateOne({ _id: book._id },
        { $set: { text_shift_repair_manual: true, updated_at: new Date() } });
    }
    return 'skipped-split';
  }

  // Direction gate — the crucial one. Pre-archival OCR read the IIIF source, so
  // its text is CORRECT; those books belong to repair-bulk-jp2-offset.mjs
  // (image-side). Only a book whose bulk_jp2 text uniformly read the shifted
  // archive is safe to shift.
  const split = readerVisibleShift(bulk);
  console.log(`    OCR timing: ${split.visible} pre-archival, ${split.consistent} post-archival, ${split.unknown} unknown`);
  if (split.visible > 0) {
    console.log(`  [REFUSE] ${split.visible} pre-archival pages hold CORRECT text — this book is the image-repair cohort (repair-bulk-jp2-offset.mjs), not a text-shift candidate`);
    return 'refused-prearchival';
  }

  // Shift gate: the archive must really be shifted. Trust the audit row unless
  // asked to re-derive; --book ids not present in the audit are always
  // re-derived — never shift on say-so alone.
  let verdict = 'shift+1';
  if (REDERIVE || !fromAudit) {
    const align = await checkAlignment(pages, {
      hashUrl,
      sourceUrlFor: p => thumbnail(p.photo_original || p.photo),
      isUsableSource: p => IA_LEAF_RE.test(String(p.photo_original || p.photo)),
      candidates: bulk,
    });
    const v = align.votes || { aligned: 0, shift: 0, checked: 0 };
    console.log(`    alignment (live): ${align.verdict} (${align.detail})`);
    // Vote gate, same rationale as repair-bulk-jp2-offset.mjs: unanimity is too
    // brittle (one flaky fetch demotes a real shift to `ambiguous`), but
    // requiring >=2 shift votes and ZERO aligned votes stays strictly safe.
    verdict = (v.shift >= 2 && v.aligned === 0) ? 'shift+1' : align.verdict;
    if (verdict !== 'shift+1') {
      console.log(`  [REFUSE] insufficient evidence of a shift (aligned=${v.aligned} shift=${v.shift} of ${v.checked})`);
      return 'refused-notshifted';
    }
  }

  const moves = computeTextShiftMoves(pages, { verdict });
  const byNum = new Map(pages.map(p => [p.page_number, p]));
  const cleared = moves.filter(m => m.cleared);
  const clearedWithText = cleared.filter(m => byNum.get(m.page_number)?.ocr?.data);
  let revisionCount = 0;
  for (const m of moves) {
    const dst = byNum.get(m.page_number);
    for (const f of ['ocr', 'translation']) if (dst?.[f]?.data) revisionCount++;
  }
  console.log(`    plan: ${moves.length} moves (${cleared.length} cleared, ${clearedWithText.length} of those need re-OCR), ${revisionCount} page_revisions snapshots`);
  console.log('    ⚠ follow-up required: re-archive this book\'s images from IIIF, then purge Cloudflare — until then text and image DISAGREE on-page');

  if (!APPLY) { console.log('  [DRY RUN] no writes — pass --apply'); return 'dry-run'; }

  const now = new Date();
  // Snapshot everything we will overwrite, then write shifted values from the
  // in-memory copy (no ordering hazard) — same shape as the e-rara repair.
  const revisions = [];
  const bulkOps = [];
  for (const m of moves) {
    const dst = byNum.get(m.page_number);
    for (const f of ['ocr', 'translation']) {
      if (dst[f]?.data) {
        revisions.push({
          id: nanoid(12), page_id: dst.id, book_id: bookId, field: f,
          data: dst[f].data, model: dst[f].model ?? null, language: dst[f].language ?? null,
          prompt_version: dst[f].prompt_version ?? null, source: SOURCE_LABEL,
          edited_by: null, job_id: null, original_date: dst[f].updated_at ?? null, created_at: now,
        });
      }
    }
    const set = { ...m.set, updated_at: now, text_shift_repaired_at: now };
    if (m.cleared && dst.ocr?.data) {
      set.needs_reocr = true;
      set.needs_reocr_reason = 'bulkjp2-text-shift-cleared-#3368';
    }
    const update = { $set: set };
    if (m.unset.length) update.$unset = Object.fromEntries(m.unset.map(f => [f, '']));
    bulkOps.push({ updateOne: { filter: { _id: dst._id }, update } });
  }

  if (revisions.length) await db.collection('page_revisions').insertMany(revisions);
  if (bulkOps.length) await db.collection('pages').bulkWrite(bulkOps);

  const pagesOcr = await db.collection('pages').countDocuments({ book_id: bookId, 'ocr.data': { $exists: true, $ne: '' } });
  const pagesTr = await db.collection('pages').countDocuments({ book_id: bookId, 'translation.data': { $exists: true, $ne: '' } });
  await db.collection('books').updateOne(
    { _id: book._id },
    { $set: {
      pages_ocr: pagesOcr, pages_translated: pagesTr, updated_at: now,
      'archive_metadata.jp2_text_shift_repaired_at': now,
      // The other half of the repair: the archived images are still one leaf
      // behind. Cleared once the book is re-archived from IIIF.
      'archive_metadata.jp2_text_shift_awaiting_image_rearchive': true,
    } },
  );
  await db.collection('book_events').insertOne({
    book_id: bookId, type: 'text_shift_repair', at: now, source: 'repair-bulkjp2-text-shift',
    details: {
      shift: 'text p(N+1)->p(N)', fields: SHIFT_FIELDS,
      pages: pages.length, bulk_jp2_pages: bulk.length, moves: moves.length,
      cleared: cleared.length, needs_reocr: clearedWithText.length,
      revisions: revisions.length, revision_source: SOURCE_LABEL,
      reason: 'bulk-JP2 zip-ordinal offset (#3368); OCR read the shifted archive',
      follow_up: 're-archive images from IIIF at the correct leaf, then purge Cloudflare',
    },
  });
  console.log(`  [OK] shifted ${moves.length} pages, snapshotted ${revisions.length} values`);
  return 'repaired';
}

const uri = process.env.MONGODB_URI;
if (!uri) { console.error('MONGODB_URI not set — source .env.production.local first'); process.exit(1); }
let queue = buildQueue();
if (!queue.length) { console.error('nothing to do — pass --from <jsonl> and/or --book <id>'); process.exit(1); }
if (LIMIT) queue = queue.slice(0, LIMIT);

const mongo = new MongoClient(uri);
await mongo.connect();
const db = mongo.db('bookstore');

console.log(APPLY ? `*** APPLY MODE — writing *** (${queue.length} candidate books)` : `--- dry run --- (${queue.length} candidate books)`);
const tally = {};
for (const item of queue) {
  let outcome;
  try { outcome = await repairBook(db, item); }
  catch (err) { outcome = 'error'; console.log(`  [ERR] ${item.id}: ${err.message?.slice(0, 120)}`); }
  tally[outcome] = (tally[outcome] || 0) + 1;
}
console.log(`\nDone. ${JSON.stringify(tally)}`);
if (APPLY && tally.repaired) {
  console.log('\nREMEMBER: these books now need their images re-archived from IIIF');
  console.log('(archive_metadata.jp2_text_shift_awaiting_image_rearchive: true), then a Cloudflare purge.');
}
await mongo.close();
