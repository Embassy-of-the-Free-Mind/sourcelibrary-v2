/**
 * Dynamic, EDITOR-ONLY review-preview of a book.
 *
 * /book/<id-or-slug>/preview renders the same book page but (a) shows the
 * proposed summary (book.summary_candidate) in place of the live one with a
 * banner, and (b) can render HIDDEN books (visible:false) via allowHidden.
 * Kept as a separate route because the main /book/[id] page is ISR/static
 * (export const revalidate) and cannot read request-time params or run a
 * per-user auth check without losing edge caching; this route is force-dynamic.
 *
 * Because it can expose hidden (often in-copyright) books, it is gated to
 * editor/admin sessions. Logged-out / non-editor visitors get a 404.
 * No promotion happens here — read-only preview for reviewers.
 */
import { notFound } from 'next/navigation';
import BookDetailPage, { generateMetadata as parentGenerateMetadata } from '../page';
import { isInnerCircle } from '@/lib/auth-helpers';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  // Always noindex the preview surface (parent already noindexes hidden books).
  const meta = await parentGenerateMetadata({ params });
  return { ...meta, robots: { index: false, follow: false } };
}

export default async function BookSummaryPreviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await isInnerCircle())) {
    notFound();
  }
  return <BookDetailPage params={params} previewProposed allowHidden />;
}
