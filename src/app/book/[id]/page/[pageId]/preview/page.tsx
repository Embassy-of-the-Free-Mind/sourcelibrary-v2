/**
 * Dynamic, EDITOR-ONLY per-page reader that can render pages of HIDDEN
 * (visible:false) books.
 *
 * The public /book/[id]/page/[pageId] route is ISR (it is the highest-volume
 * URL set on the site and must stay statically cacheable), so it gates hidden
 * books uniformly to a 404. Editors who need to read an unpublished book's
 * scanned pages in the browser use this force-dynamic, auth-gated twin —
 * mirrors /book/[id]/preview at the page level.
 *
 * Logged-out / non-editor visitors get a 404. Read-only; no mutations.
 */
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
// The public reader lives in the URL-neutral `(reader)` route group so its
// visibility gate (that group's layout.tsx) does not apply to this route — see
// #3385. This import reaches the same component it always did.
import PageEditorPage from '../(reader)/page';
import { isInnerCircle } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function PageEditorPreviewPage({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  if (!(await isInnerCircle())) {
    notFound();
  }
  return <PageEditorPage params={params} allowHidden />;
}
