import type { Metadata } from 'next';
import PageEditorPage from '@/app/book/[id]/page/[pageId]/(reader)/page';

// Iframe-target wrapper for the page reader. See sibling page.tsx for the
// embed-v1.js coupling rationale.
//
// No loading.tsx may sit above this route (see ../../../../(library)/loading.tsx):
// the reader's redirects (a hidden repeat capture to its kept page, #5056; a
// split parent to its first leaf) must answer with a real 307/308, staying
// under /embed/<tenant>. tests/unit/embed-reader-redirect.test.ts pins both.

export const revalidate = 86400;

// Same rationale as the non-embed per-page route: thin content, outnumbers
// book URLs, better to consolidate signal on the book-level URL.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function EmbedReaderPage({
    params,
}: {
    params: Promise<{ tenant: string; slug: string; pageId: string }>;
}) {
    const { tenant, slug, pageId } = await params;
    return <PageEditorPage params={Promise.resolve({ id: slug, pageId })} hrefPrefix={`/embed/${tenant}`} />;
}
