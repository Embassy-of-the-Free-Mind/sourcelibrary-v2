#!/usr/bin/env node
/**
 * Recover gallery_images for books with 0% CDN coverage.
 *
 * Pattern uncovered by /admin/r2-coverage's gallery-coverage snapshot:
 * ~558 books have gallery_images rows with `extracted_url` either unset or
 * pointing at files that 404 on R2. For most of these books the underlying
 * `pages.archived_photo` IS on R2 and `pages.detected_images[]` carries
 * the bbox + AI description metadata. We just never generated the cropped
 * gallery JPEGs (or generated them and lost them).
 *
 * Two-phase recovery for each affected book:
 *   1. Trigger /api/admin/generate-gallery-thumbnails (iteratively, since it
 *      caps at 200 per call) — this regenerates the cropped JPEGs from the
 *      source page image + bbox and writes the new extracted_url back to
 *      pages.detected_images[].
 *   2. Materialize pages.detected_images[].extracted_url →
 *      gallery_images.extracted_url so the gallery collection / book page
 *      resolvers can find them. Pairs by (page_id, detection_index) — the
 *      same key the image-extract worker uses when seeding gallery_images.
 *
 * Safety
 *   - Dry-run by default; `--apply` triggers the generation.
 *   - `--book <id>` for one-book runs (recommended for first use).
 *   - Step 2 only writes when gallery_images.extracted_url was empty;
 *     never overwrites an existing URL.
 *   - Skips books with <30% pages on R2 — those need page archive first.
 *
 * Tested 2026-05-28 on Tutte l'opere d'architettura: 1/636 → 614/636.
 *
 * Usage
 *   set -a; source .env.production.local; set +a
 *   node scripts/maintenance/recover-zero-cdn-gallery.mjs                    # dry run
 *   node scripts/maintenance/recover-zero-cdn-gallery.mjs --apply --limit 20
 *   node scripts/maintenance/recover-zero-cdn-gallery.mjs --apply --book <id>
 *
 * Env
 *   MONGODB_URI  — required
 *   CRON_SECRET  — required for the generate-gallery-thumbnails API call
 *   BASE_URL     — defaults to https://sourcelibrary.org
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APPLY = flag('apply');
const BOOK_REF = arg('book', null);
const LIMIT = Number(arg('limit', 0)) || Infinity;
const MIN_PAGE_R2_PCT = Number(arg('min-page-r2-pct', 30));
const BASE_URL = (arg('base', process.env.BASE_URL || 'https://sourcelibrary.org')).replace(/\/+$/, '');

const MONGODB_URI = process.env.MONGODB_URI;
const CRON_SECRET = process.env.CRON_SECRET;
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(2); }
if (APPLY && !CRON_SECRET) { console.error('CRON_SECRET required for --apply (calls /api/admin/generate-gallery-thumbnails)'); process.exit(2); }

// ---------------------------------------------------------------------------

async function pickCandidateBooks(db) {
  // Use the gallery-coverage snapshot as our source of truth for who needs work.
  const snap = await db.collection('system_config').findOne({ _id: 'gallery_coverage_snapshot' });
  if (!snap) {
    console.error('No gallery_coverage_snapshot in system_config — run scripts/workers/gallery-coverage-snapshot.mjs first');
    process.exit(2);
  }
  const cands = (snap.no_coverage_books_top200 || []).filter(b => b.gallery_rows > 0);
  console.log(`[input] ${cands.length} zero-coverage books in snapshot (top 200 captured)`);
  return cands;
}

async function resolveBook(db, ref) {
  const b = await db.collection('books').findOne(
    { $or: [{ id: ref }, { slug: ref }] },
    { projection: { id: 1, slug: 1, title: 1 } }
  );
  return b;
}

async function bookPageStats(db, bookId) {
  const total = await db.collection('pages').countDocuments({ book_id: bookId });
  const r2 = await db.collection('pages').countDocuments({ book_id: bookId, archived_photo: { $regex: /^https:\/\/images\.sourcelibrary\.org/ } });
  return { total, r2, r2_pct: total > 0 ? Math.round((r2 / total) * 100) : 0 };
}

async function generateBatch(bookId) {
  // Iteratively call the admin endpoint until no detections remain to process.
  const headers = {
    Authorization: `Bearer ${CRON_SECRET}`,
    'Content-Type': 'application/json',
  };
  let totalProcessed = 0;
  let totalFailed = 0;
  let iter = 0;
  while (iter < 50) {
    iter++;
    const r = await fetch(`${BASE_URL}/api/admin/generate-gallery-thumbnails?bookId=${bookId}&limit=200`, {
      method: 'POST',
      headers,
      signal: AbortSignal.timeout(300_000),
    });
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`generate-gallery-thumbnails HTTP ${r.status}: ${body.slice(0, 200)}`);
    }
    const json = await r.json();
    totalProcessed += json.processed || 0;
    totalFailed += json.failed || 0;
    if (!json.processed) break;
  }
  return { processed: totalProcessed, failed: totalFailed, iterations: iter };
}

async function syncGalleryRows(db, bookId) {
  // Materialize pages.detected_images[].extracted_url → gallery_images.extracted_url.
  // gallery_images.id format is `<page_id>-<detection_index>`.
  const pages = await db.collection('pages').find(
    { book_id: bookId, 'detected_images.extracted_url': { $type: 'string' } },
    { projection: { id: 1, detected_images: 1 } }
  ).toArray();

  let updated = 0;
  let skipped = 0;
  for (const p of pages) {
    for (let idx = 0; idx < (p.detected_images || []).length; idx++) {
      const di = p.detected_images[idx];
      if (!di.extracted_url) continue;
      const id = `${p.id}-${idx}`;
      const r = await db.collection('gallery_images').updateOne(
        { id, extracted_url: { $in: [null, undefined, ''] } },
        { $set: { extracted_url: di.extracted_url, thumbnail_url: di.thumbnail_url || di.extracted_url, updated_at: new Date() } }
      );
      if (r.modifiedCount) updated++;
      else skipped++;
    }
  }
  return { updated, skipped };
}

// ---------------------------------------------------------------------------

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    let candidates;
    if (BOOK_REF) {
      const b = await resolveBook(db, BOOK_REF);
      if (!b) { console.error(`Book not found: ${BOOK_REF}`); process.exit(2); }
      candidates = [{ id: b.id, title: b.title, slug: b.slug, gallery_rows: 0 }];
    } else {
      candidates = await pickCandidateBooks(db);
    }

    const summary = [];
    let n = 0;
    for (const cand of candidates) {
      if (n >= LIMIT) break;
      n++;
      const ps = await bookPageStats(db, cand.id);
      const skip = ps.r2_pct < MIN_PAGE_R2_PCT;
      console.log(
        `[${n}/${Math.min(candidates.length, LIMIT)}] "${(cand.title || cand.id).slice(0, 55)}" — ` +
        `pages on R2: ${ps.r2}/${ps.total} (${ps.r2_pct}%)${skip ? ' — SKIP (below threshold)' : ''}`
      );
      if (skip) {
        summary.push({ id: cand.id, title: cand.title, skipped: true, reason: `pages_r2_pct<${MIN_PAGE_R2_PCT}` });
        continue;
      }
      if (!APPLY) {
        summary.push({ id: cand.id, title: cand.title, dryrun: true });
        continue;
      }
      try {
        const gen = await generateBatch(cand.id);
        const sync = await syncGalleryRows(db, cand.id);
        const after = await db.collection('gallery_images').countDocuments({
          book_id: cand.id,
          extracted_url: { $type: 'string', $ne: '' },
        });
        const total = await db.collection('gallery_images').countDocuments({ book_id: cand.id });
        console.log(`     processed ${gen.processed} (${gen.iterations} iter, ${gen.failed} failed) — gallery_images URL coverage: ${after}/${total}`);
        summary.push({ id: cand.id, title: cand.title, generated: gen.processed, synced: sync.updated, url_coverage: `${after}/${total}` });
      } catch (err) {
        console.error(`     ERROR: ${err.message}`);
        summary.push({ id: cand.id, title: cand.title, error: err.message });
      }
    }

    console.log('\n--- Summary ---');
    console.log(`Books processed: ${summary.length}`);
    console.log(`Skipped:         ${summary.filter(s => s.skipped).length}`);
    console.log(`Errors:          ${summary.filter(s => s.error).length}`);
    if (APPLY) {
      const totalGenerated = summary.reduce((s, x) => s + (x.generated || 0), 0);
      const totalSynced = summary.reduce((s, x) => s + (x.synced || 0), 0);
      console.log(`Total detections regenerated: ${totalGenerated}`);
      console.log(`Total gallery_images URL-synced: ${totalSynced}`);
    } else {
      console.log('(dry run; pass --apply to recover)');
    }
  } finally {
    await client.close();
  }
}

main().catch(err => { console.error(err); process.exit(2); });
