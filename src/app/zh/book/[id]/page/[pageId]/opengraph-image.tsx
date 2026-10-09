import { renderPageOgImage, PAGE_OG_ALT, PAGE_OG_SIZE, PAGE_OG_CONTENT_TYPE } from '@/lib/og-page-card';

// Chinese twin of the reader-page share card (#6254, #6382). Same renderer, `lang='zh'`:
// Chinese chrome, and the page's own CHINESE text excerpted (the transcription),
// labelled as such.
export const alt = PAGE_OG_ALT.zh;
export const size = PAGE_OG_SIZE;
export const contentType = PAGE_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  return renderPageOgImage(id, pageId, 'zh');
}
