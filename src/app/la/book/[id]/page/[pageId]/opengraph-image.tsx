import { renderPageOgImage, PAGE_OG_ALT, PAGE_OG_SIZE, PAGE_OG_CONTENT_TYPE } from '@/lib/og-page-card';

// Latin twin of the reader-page share card (#6254). Same renderer, `lang='la'`:
// Latin chrome, and the page's own LATIN text excerpted (the transcription),
// labelled as such.
export const alt = PAGE_OG_ALT.la;
export const size = PAGE_OG_SIZE;
export const contentType = PAGE_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  return renderPageOgImage(id, pageId, 'la');
}
