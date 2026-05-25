import type { Metadata } from 'next';
import PageEditorPage from '@/app/[tenant]/book/[id]/page/[pageId]/page';

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
    return <PageEditorPage params={Promise.resolve({ tenant, id: slug, pageId })} />;
}
