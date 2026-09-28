#!/usr/bin/env node
/**
 * PRIOR ART: scripts/maintenance/delete-stale-embeddings.mjs — asks only "does this row's book
 * exist?"; a row pointing at the WRONG existing book (3,711 of them on 2026-09-28) passes it.
 * scripts/backfill-clip-embeddings.mjs is idempotent on id and never re-checks book_id.
 * scripts/clip-find-duplicates.mjs reads the index as truth. scripts/audit/gallery-denorm-drift.mjs
 * checks gallery_images' OWN denormalised book fields against books, not the CLIP index.
 * scripts/audit/embedding-coverage.mjs asks whether each store is still being WRITTEN, not whether
 * what it holds is true. None joins clip_embeddings to gallery_images.
 *
 * clip-index-integrity — is the CLIP retrieval index telling the truth about the gallery? (#5195)
 *
 * THE INVARIANT
 *   For every `gallery_image` row in `clip_embeddings`, the gallery row it is keyed to exists and
 *   carries the same `book_id`; and every gallery row with a crop has an index row. The index is a
 *   cache; `gallery_images` and `books` are the truth.
 *
 * WHY IT MATTERS
 *   On 2026-09-26 an /identify visitor photographed an illustration, got a confident match, and
 *   was sent to /book/<id> for a book that no longer had that id: 3,711 index rows pointed at
 *   the wrong book after re-mints and merges, 31,210 pointed at no gallery row at all, and 14,135
 *   crops had never been embedded (a query-shape bug, fixed in #5214). Nothing errored at any
 *   step — a wrong book_id serves a real page, and an unembedded crop is indistinguishable from
 *   one nothing matches. This is the standing check that turns that into a one-run alarm.
 *
 * USAGE
 *   set -a; source .env.production.local; set +a
 *   node scripts/audit/clip-index-integrity.mjs                  # drift + orphans (classified) + missing
 *   node scripts/audit/clip-index-integrity.mjs --no-missing     # skip the 217K-row gallery walk
 *   node scripts/audit/clip-index-integrity.mjs --json out.json  # full lists (drift rows, classified orphans)
 *   node scripts/audit/clip-index-integrity.mjs --max-drift 0 --max-orphans 1000 --max-missing 500
 *
 * Exits 1 when any count is above its threshold, 2 on a broken probe or missing env. READ-ONLY.
 * Repair: scripts/maintenance/clip-index-repair.mjs (drift rewrite; orphan removal is gated).
 */
import { MongoClient } from 'mongodb';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import { loadClipRows, loadBookMap, scanGalleryIndex, findMissingFromIndex } from '../lib/clip-index-scan.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => (args.includes(name) ? args[args.indexOf(name) + 1] : dflt);
const JSON_OUT = flag('--json', null);
const MISSING = !args.includes('--no-missing');
const MAX_DRIFT = Number(flag('--max-drift', 0));
const MAX_ORPHANS = Number(flag('--max-orphans', 1000));
const MAX_MISSING = Number(flag('--max-missing', 500));

const MONGODB_URI = process.env.MONGODB_URI;
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!MONGODB_URI || !SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Need MONGODB_URI, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}

const log = (s) => console.error(s);
const t0 = Date.now();
const mongo = await MongoClient.connect(MONGODB_URI);
const db = mongo.db('bookstore');
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

try {
  log('Loading clip_embeddings (id, book_id, source_type)…');
  const all = await loadClipRows(sb, { log });
  const bySource = {};
  for (const r of all) bySource[r.source_type] = (bySource[r.source_type] || 0) + 1;
  const galleryRows = all.filter(r => r.source_type === 'gallery_image');

  log('Joining gallery rows to gallery_images…');
  const scan = await scanGalleryIndex(db, galleryRows, { log });

  // Covers / artworks: the only truth for those is `books` itself (by id OR _id).
  const books = await loadBookMap(db);
  const nonGallery = all.filter(r => r.source_type !== 'gallery_image');
  const bookGone = nonGallery.filter(r => !books.has(String(r.book_id)));
  const driftToMissingBook = scan.drift.filter(d => !books.has(String(d.gallery_book))).length;

  let missing = null;
  if (MISSING) {
    log('Walking gallery_images with a crop for rows the index lacks…');
    missing = await findMissingFromIndex(db, galleryRows);
  }

  const topDrift = [...scan.driftByClipBook.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([clip_book, n]) => ({ clip_book, rows: n, book: books.get(clip_book)?.title || '(no books row)' }));

  const report = {
    measured_at: new Date().toISOString(),
    index_rows: all.length,
    by_source_type: bySource,
    gallery: {
      checked: scan.checked,
      joined: scan.joined,
      drift: scan.drift.length,
      drift_to_missing_book: driftToMissingBook,
      orphans: scan.orphans.length,
      orphans_by_class: scan.byClass,
      top_drift_clip_books: topDrift,
    },
    covers_and_artworks: { rows: nonGallery.length, book_gone: bookGone.length },
    missing_from_index: missing ? { gallery_with_crop: missing.withCrop, missing: missing.missing.length,
      missing_visible: missing.missing.filter(m => m.book_visible !== false).length } : 'skipped',
    thresholds: { max_drift: MAX_DRIFT, max_orphans: MAX_ORPHANS, max_missing: MAX_MISSING },
    seconds: Math.round((Date.now() - t0) / 1000),
  };

  console.log(JSON.stringify(report, null, 1));
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ ...report, drift_rows: scan.drift, orphan_rows: scan.orphans,
      cover_artwork_book_gone: bookGone, missing_rows: missing?.missing ?? [] }, null, 1));
    log(`Full lists → ${JSON_OUT}`);
  }

  const failures = [];
  if (scan.drift.length > MAX_DRIFT) failures.push(`drift ${scan.drift.length} > ${MAX_DRIFT}`);
  if (scan.orphans.length > MAX_ORPHANS) failures.push(`orphans ${scan.orphans.length} > ${MAX_ORPHANS}`);
  if (missing && missing.missing.length > MAX_MISSING) failures.push(`missing ${missing.missing.length} > ${MAX_MISSING}`);
  if (failures.length) {
    log(`FAIL clip-index-integrity: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    log('PASS clip-index-integrity');
  }
} catch (e) {
  log(`ERROR clip-index-integrity: ${e.message}`);
  process.exitCode = 2;
} finally {
  await mongo.close();
}
