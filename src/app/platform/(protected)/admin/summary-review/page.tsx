/**
 * "About This Book" summary review queue.
 *
 * Re-synthesized summaries (plain-encyclopedic prompt rewrite) land in
 * book.summary_candidate via scripts/maintenance/resynthesize-summaries.mjs,
 * NON-DESTRUCTIVELY. This page shows the live text vs the candidate so a
 * reviewer can approve (promote to live), reject, or edit-then-approve.
 *
 * Gated by the platform-protected layout (requireSuperAdmin). Mutations go
 * through /api/admin/summary-review.
 */
import { getReadDb } from '@/lib/mongodb';
import { ReviewClient, type ReviewItem } from './ReviewClient';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export default async function SummaryReviewPage({ searchParams }: { searchParams: Promise<{ limit?: string }> }) {
  const params = await searchParams;
  const limit = Math.min(Math.max(Number(params.limit) || 100, 1), 500);

  const db = await getReadDb();

  const books = await db.collection('books')
    .find({ 'summary_candidate.status': 'pending' })
    .project({ id: 1, title: 1, display_title: 1, author: 1, slug: 1, language: 1, 'summary.data': 1, summary_candidate: 1, _id: 0 })
    .limit(limit)
    .toArray();

  const ids = books.map((b) => b.id);
  const idxDocs = await db.collection('book_indexes')
    .find({ book_id: { $in: ids } })
    .project({ book_id: 1, 'bookSummary.brief': 1, _id: 0 })
    .toArray();
  const idxBrief = new Map(idxDocs.map((d) => [d.book_id, d.bookSummary?.brief as string | undefined]));

  const items: ReviewItem[] = books.map((b) => ({
    id: b.id,
    title: b.title,
    display_title: b.display_title,
    author: b.author,
    slug: b.slug,
    language: b.language,
    oldBrief: idxBrief.get(b.id) || (typeof b.summary === 'string' ? b.summary : b.summary?.data) || '',
    brief: b.summary_candidate?.brief || '',
    abstract: b.summary_candidate?.abstract || '',
    detailed: b.summary_candidate?.detailed || '',
    prompt_version: b.summary_candidate?.prompt_version,
  }));

  const countsAgg = await db.collection('books').aggregate([
    { $match: { 'summary_candidate.status': { $exists: true } } },
    { $group: { _id: '$summary_candidate.status', n: { $sum: 1 } } },
  ]).toArray();
  const counts: Record<string, number> = {};
  for (const c of countsAgg) counts[c._id] = c.n;

  return <ReviewClient initialItems={items} counts={counts} />;
}
