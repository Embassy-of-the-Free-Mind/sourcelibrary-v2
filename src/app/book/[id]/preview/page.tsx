/**
 * Dynamic review-preview of a book's STAGED summary candidate.
 *
 * /book/<id-or-slug>/preview renders the same book page but with the proposed
 * summary (book.summary_candidate) shown in place of the live one, plus a
 * banner. Kept as a separate route because the main /book/[id] page is
 * ISR/static (export const revalidate) and cannot read request-time params;
 * this route is force-dynamic so it always reflects the current candidate.
 *
 * No promotion happens here — read-only preview for reviewers.
 */
import BookDetailPage, { generateMetadata as parentGenerateMetadata } from '../page';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  return parentGenerateMetadata({ params });
}

export default async function BookSummaryPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return <BookDetailPage params={params} previewProposed />;
}
