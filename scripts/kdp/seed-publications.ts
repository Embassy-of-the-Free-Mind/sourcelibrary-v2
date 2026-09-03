/**
 * seed-publications.ts — score KDP candidates and seed the admin dashboard queue.
 *
 * Runs the same scoring as POST /api/admin/kdp/score, then inserts the top N
 * scored books (that don't already have a publication row) as `candidate`
 * publications — the same row shape as POST /api/admin/kdp/publications.
 *
 * Usage:
 *   set -a; source .env.production.local; set +a
 *   npx tsx scripts/kdp/seed-publications.ts            # dry run: score + show top N
 *   npx tsx scripts/kdp/seed-publications.ts --apply    # also insert candidate rows
 *   npx tsx scripts/kdp/seed-publications.ts --top 30 --apply
 */
import crypto from 'node:crypto';
import { getDb } from '@/lib/mongodb';
import {
  scoreBooksKdp,
  generateKdpMetadata,
  computeQualityFlags,
  BPH_COLLECTIONS,
  EXCLUDED_COLLECTIONS,
} from '@/lib/kdp-scoring';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const skipScore = args.includes('--skip-score');
const topIdx = args.indexOf('--top');
const topN = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 20;

async function main() {
  const db = await getDb();

  if (skipScore) {
    console.log('Skipping scoring (--skip-score), using existing kdp_score values.\n');
  } else {
    console.log('Scoring eligible books (pipeline complete, translated, BPH collections)...');
    const { scored } = await scoreBooksKdp(db);
    console.log(`Scored ${scored} books.\n`);
  }

  const existing = await db
    .collection('kdp_publications')
    .find({}, { projection: { book_id: 1 } })
    .toArray();
  const existingIds = new Set(existing.map((p) => p.book_id));

  const top = await db
    .collection('books')
    .find(
      {
        // Same eligibility filter as the dashboard GET, so the seeded queue
        // matches what /admin/kdp itself ranks.
        kdp_score: { $gt: 0 },
        id: { $nin: [...existingIds] },
        'pipeline_auto.status': 'complete',
        pages_translated: { $gt: 0 },
        collections: { $in: BPH_COLLECTIONS, $nin: EXCLUDED_COLLECTIONS },
      },
      {
        projection: {
          _id: 0, id: 1, title: 1, display_title: 1, author: 1, language: 1,
          published: 1, categories: 1, slug: 1, kdp_score: 1, is_first_translation: 1,
          thumbnail: 1, thumbnail_blob: 1, reading_summary: 1, index: 1,
          chapters: 1, quality_score: 1, pages_count: 1,
        },
      },
    )
    .sort({ kdp_score: -1 })
    .limit(topN)
    .toArray();

  console.log(`Top ${top.length} unqueued candidates:`);
  let inserted = 0;
  for (const book of top) {
    const plates = await db.collection('gallery_images').countDocuments({
      book_id: book.id,
      gallery_quality: { $gte: 0.7 },
      type: { $nin: ['decorative'] },
    });
    const ft = book.is_first_translation ? ' [FIRST TRANSLATION]' : '';
    console.log(
      `  ${String(book.kdp_score).padStart(3)}  ${(book.display_title || book.title).slice(0, 60)} — ${book.author} (${book.published || 'n.d.'}), ${plates} plates${ft}`,
    );

    if (!apply) continue;

    const kdpMetadata = generateKdpMetadata(book as Parameters<typeof generateKdpMetadata>[0]);
    const qualityFlags = await computeQualityFlags(db, book.id, book as Parameters<typeof computeQualityFlags>[2]);
    await db.collection('kdp_publications').insertOne({
      id: crypto.randomUUID(),
      book_id: book.id,
      status: 'candidate' as const,
      kdp_metadata: kdpMetadata,
      cover_image_url: (book.thumbnail_blob || book.thumbnail) as string | undefined,
      quality_flags: qualityFlags,
      kdp_score_snapshot: book.kdp_score || 0,
      created_at: new Date(),
      updated_at: new Date(),
    });
    inserted++;
  }

  console.log(
    apply
      ? `\nInserted ${inserted} candidate publications.`
      : `\nDry run — re-run with --apply to insert these as candidates.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
