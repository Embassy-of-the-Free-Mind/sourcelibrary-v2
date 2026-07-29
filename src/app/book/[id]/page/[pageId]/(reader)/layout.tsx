import { notFound } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { isHiddenBook } from '@/lib/book-access';
import { getPageData } from '../page-data';

/**
 * Route group holding ONLY the public reader (`/book/[id]/page/[pageId]`).
 *
 * `(reader)` is URL-neutral — it exists so the public page can have a layout
 * that its editor twin does NOT inherit. `page/[pageId]/preview` renders
 * hidden books on purpose (allowHidden, auth-gated), and it lives beside this
 * group rather than inside it, so the gate below cannot reach it.
 *
 * Why a layout and not page.tsx: the reader keeps its loading.tsx (the skeleton
 * shows on every page turn), and a loading.tsx wraps its page in an automatic
 * <Suspense>. Next.js flushes that 200 shell the moment the page's data fetch
 * suspends, so a notFound() inside page.tsx can only swap the body — the status
 * is already committed. That soft-404 was fixed for missing books/pages in
 * #3376 by moving the check into the segment layout; the visibility gate could
 * not follow it there, because a layout gets no signal about which child
 * segment is rendering and gating in the shared layout would have 404'd
 * /preview (#3385). The group is that missing signal.
 *
 * loading.tsx moved down here with page.tsx, so the boundary it creates now
 * sits BELOW this layout — the gate runs first and sets a real 404 status.
 * /preview loses the skeleton it never needed (it is force-dynamic, editors
 * only).
 */

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export default async function PublicReaderLayout({ children, params }: LayoutProps) {
  const { id, pageId } = await params;
  const ctx = await getTenantContext();
  // Same cache()d lookup the parent layout and generateMetadata already made
  // this request — no extra query.
  const { book } = await getPageData(id, pageId, ctx?.id ?? undefined);

  // Hidden (visible:false) books are not public — takedowns and copyright holds
  // live here. page.tsx still gates too (it is the shared component /preview
  // renders with allowHidden); this is what makes the STATUS a 404 rather than
  // a 200 carrying the not-found body.
  if (book && isHiddenBook(book as unknown as object)) notFound();

  return children;
}
