import PageEditorPage from '@/app/[tenant]/book/[id]/page/[pageId]/page';

export const revalidate = 86400;

export default async function EmbedReaderPage({
    params,
}: {
    params: Promise<{ tenant: string; slug: string; pageId: string }>;
}) {
    const { tenant, slug, pageId } = await params;
    return <PageEditorPage params={Promise.resolve({ tenant, id: slug, pageId })} />;
}
