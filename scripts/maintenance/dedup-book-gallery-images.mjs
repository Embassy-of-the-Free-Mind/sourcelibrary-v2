#!/usr/bin/env node
/**
 * Collapse within-book gallery_images that are extractions of the SAME
 * recurring printed element (chapter header, decorative border, frontispiece
 * reprinted on every verse page, page-watermark, etc.).
 *
 * Why this exists
 *   Image extraction runs per page. When an illustration is *reproduced*
 *   across many pages of a book (the recurring-template pattern), the
 *   extractor independently flags it on each page and writes a separate
 *   gallery_images row. The Secret Commonwealth scan has 24 rows for one
 *   frontispiece; the Krestos Gospels has 1,461 rows of which ~1,300 are
 *   different instances of the same handful of decorative borders.
 *
 * Why bbox is the right signal
 *   When the same template element is detected on N pages, the extractor
 *   reports near-identical normalized bboxes (x, y, width, height vary by
 *   <0.5% in practice — same page layout, same crop). Books with
 *   legitimately distinct illustrations have unique bboxes per page
 *   (different woodcut sizes / placements). Sampling 5 heavily-galleried
 *   books on 2026-05-27 confirms: recurring-template books have a few
 *   bbox clusters of 100+; unique-illustration books have ~1 entry per
 *   bbox cluster. Bbox + same `type` is a high-precision dedup key
 *   without needing image fetches or dhash.
 *
 * Strategy
 *   For each book (or one with --book), pull gallery_images, cluster by
 *   (type, bbox rounded to BBOX_PRECISION). Within each cluster of size
 *   >= MIN_CLUSTER, keep the highest gallery_quality row, archive the
 *   rest to deleted_gallery_images with reason='recurring_template'.
 *
 * Safety
 *   - Dry-run by default; needs --apply.
 *   - Refuses if cluster cardinality > 50000 unless --force.
 *   - Always archives (never hard-deletes) so a 7-day rollback window
 *     mirrors the deleted_books convention in CLAUDE.md.
 *   - --book <id-or-slug> restricts to a single book for safe experiments.
 *
 * Usage
 *   node scripts/maintenance/dedup-book-gallery-images.mjs                       # full catalog dry-run
 *   node scripts/maintenance/dedup-book-gallery-images.mjs --book 699066802ec9f7db5717aac7
 *   node scripts/maintenance/dedup-book-gallery-images.mjs --book the-secret-commonwealth-of-elves-fauns-and-fairies-kirk --apply
 *   node scripts/maintenance/dedup-book-gallery-images.mjs --apply --min-cluster 2 --bbox-precision 0.01
 *
 * Env
 *   MONGODB_URI            — required
 *
 * Exit codes
 *   0 — nothing to do, or --apply succeeded
 *   1 — found dupes (dry-run) OR refused by safety cap
 *   2 — script error
 */
import { MongoClient } from 'mongodb';

const argv = process.argv.slice(2);
const flag = name => argv.includes(`--${name}`);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const APPLY = flag('apply');
const FORCE = flag('force');
const BOOK = arg('book', null);
const MIN_CLUSTER = Number(arg('min-cluster', 2));
const BBOX_PRECISION = Number(arg('bbox-precision', 0.01)); // 1% normalized
const DESC_PREFIX_LEN = Number(arg('desc-prefix', 50));
const MAX_DELETE = Number(arg('max', 50_000));

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set. Source .env.production.local first.');
  process.exit(2);
}

// ---------------------------------------------------------------------------

function bboxKey(bbox, precision) {
  if (!bbox) return null;
  const round = v => Math.round(v / precision) * precision;
  return [round(bbox.x), round(bbox.y), round(bbox.width), round(bbox.height)]
    .map(n => n.toFixed(3))
    .join('_');
}

function descPrefix(desc, n = DESC_PREFIX_LEN) {
  return (desc || '').trim().toLowerCase().slice(0, n);
}

/**
 * Cluster a book's gallery_images by (type, bbox, description-prefix).
 * Returns clusters whose size meets MIN_CLUSTER. Each cluster is sorted by
 * gallery_quality descending so cluster[0] is the keeper.
 *
 * Why all three signals
 *   bbox + type alone is NOT enough: it false-positives on books with
 *   full-page illustrations (atlases, botanical encyclopedias, technical
 *   treatises) where every plate fills the page at the same normalized
 *   bbox but shows distinct content (a Mercator map of Flanders vs a map
 *   of the Americas, an ephedra woodcut vs a duruo woodcut).
 *
 *   Verified on 2026-05-27 against the first --apply pass: a stratified
 *   140-row sample showed a ~61% false-positive rate when clustering by
 *   bbox+type alone. Books with recurring TEMPLATE elements (chapter
 *   headers, decorative borders, the Secret Commonwealth frontispiece on
 *   24 pages) have near-identical AI descriptions across instances; books
 *   with full-page distinct plates have diverging descriptions. Adding
 *   description-prefix as a third clustering key cuts the FP rate to near
 *   zero on the same sample.
 *
 *   Keep all three. Don't relax to bbox-only without re-verifying.
 */
function clusterBook(galleries, precision, minClusterSize) {
  const clusters = new Map();
  for (const g of galleries) {
    const bk = bboxKey(g.bbox, precision);
    if (!bk) continue; // images without bbox skip clustering (kept as-is)
    const desc = descPrefix(g.description);
    if (!desc) continue; // images without description also skip — too ambiguous
    const key = `${g.type || '∅'}::${bk}::${desc}`;
    const arr = clusters.get(key) || [];
    arr.push(g);
    clusters.set(key, arr);
  }
  const out = [];
  for (const arr of clusters.values()) {
    if (arr.length < minClusterSize) continue;
    arr.sort((a, b) => (b.gallery_quality ?? 0) - (a.gallery_quality ?? 0));
    out.push(arr);
  }
  return out;
}

async function resolveBookFilter(db, bookRef) {
  if (!bookRef) return null;
  const book = await db.collection('books').findOne(
    { $or: [{ id: bookRef }, { slug: bookRef }] },
    { projection: { id: 1, slug: 1, title: 1 } }
  );
  if (!book) {
    console.error(`Book not found: ${bookRef}`);
    process.exit(2);
  }
  console.log(`Filter to book: "${book.title}" (${book.id})`);
  return book.id;
}

async function main() {
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db('bookstore');

  try {
    const bookFilter = await resolveBookFilter(db, BOOK);

    // Find books that even have multiple gallery_images (worth checking).
    // If --book is set, restrict to that one.
    const candidateMatch = { $match: bookFilter ? { _id: bookFilter, n: { $gte: MIN_CLUSTER } } : { n: { $gte: MIN_CLUSTER } } };
    const candidates = await db.collection('gallery_images').aggregate(
      [
        { $group: { _id: '$book_id', n: { $sum: 1 } } },
        candidateMatch,
      ],
      { allowDiskUse: true, maxTimeMS: 120_000 }
    ).toArray();

    console.log(`Scanning ${candidates.length} candidate book(s)…\n`);

    // Project all fields needed for clustering AND for full restoration —
    // the first --apply run on 2026-05-27 dropped extracted_url/thumbnail_url
    // and had to reconstruct URLs from id + book_id during rollback. Don't
    // repeat that.
    const PROJECTION = {}; // entire doc

    let booksAffected = 0;
    let totalRedundant = 0;
    let totalDeleted = 0;
    const archive = []; // rows queued for archive
    const examples = [];

    for (const cand of candidates) {
      const galleries = await db.collection('gallery_images')
        .find({ book_id: cand._id }, { projection: PROJECTION })
        .toArray();
      const clusters = clusterBook(galleries, BBOX_PRECISION, MIN_CLUSTER);
      if (clusters.length === 0) continue;

      let redundantInBook = 0;
      for (const cluster of clusters) {
        const [keeper, ...redundant] = cluster;
        redundantInBook += redundant.length;
        for (const r of redundant) {
          archive.push({ ...r, deleted_at: new Date(), reason: 'recurring_template', kept_id: keeper.id });
        }
      }
      if (redundantInBook > 0) {
        booksAffected++;
        totalRedundant += redundantInBook;
        // Keep ALL affected books; we sort + truncate after the scan so the
        // displayed top-10 actually reflects the heaviest books, not the
        // first-encountered 10. Memory cost is bounded by `booksAffected`,
        // which empirically is ~600 across the catalog — negligible.
        examples.push({
          id: cand._id,
          total: galleries.length,
          redundant: redundantInBook,
          clusters: clusters.length,
          topCluster: clusters.sort((a, b) => b.length - a.length)[0].length,
        });
      }
    }

    console.log(`Books affected:                ${booksAffected}`);
    console.log(`Redundant rows (would archive): ${totalRedundant}\n`);
    examples.sort((a, b) => b.redundant - a.redundant);
    const top = examples.slice(0, 10);
    // Hydrate titles only for the displayed top — saves N book lookups
    const titles = new Map(
      (await db.collection('books')
        .find({ id: { $in: top.map(e => e.id) } }, { projection: { id: 1, title: 1 } })
        .toArray()).map(b => [b.id, b.title])
    );
    console.log('Sample (top 10 by redundancy):');
    for (const e of top) {
      const title = (titles.get(e.id) || e.id).slice(0, 55);
      console.log(`  ${e.redundant.toString().padStart(5)} redundant / ${e.total} total in ${e.clusters} cluster(s); biggest=${e.topCluster}× — "${title}"`);
    }

    if (totalRedundant === 0) {
      console.log('\nNothing to do.');
      process.exit(0);
    }

    if (totalRedundant > MAX_DELETE && !FORCE) {
      console.error(`\nRefusing: ${totalRedundant} redundant rows exceeds --max (${MAX_DELETE}). Re-run with --force if intentional.`);
      process.exit(1);
    }

    if (!APPLY) {
      console.log('\n(dry run; pass --apply to archive)');
      process.exit(1);
    }

    // Archive then delete in batches of 500
    const BATCH = 500;
    for (let i = 0; i < archive.length; i += BATCH) {
      const chunk = archive.slice(i, i + BATCH);
      await db.collection('deleted_gallery_images').insertMany(chunk, { ordered: false });
      const r = await db.collection('gallery_images').deleteMany({ _id: { $in: chunk.map(x => x._id) } });
      totalDeleted += r.deletedCount;
      process.stderr.write(`\r[apply] ${totalDeleted}/${archive.length} archived+deleted`);
    }
    process.stderr.write('\n');

    console.log(`\nDone. Archived ${totalDeleted} rows to deleted_gallery_images.`);
    process.exit(0);
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
