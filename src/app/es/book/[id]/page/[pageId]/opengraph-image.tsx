import { renderPageOgImage, PAGE_OG_ALT, PAGE_OG_SIZE, PAGE_OG_CONTENT_TYPE } from '@/lib/og-page-card';

// Spanish twin of the reader-page share card. Same renderer, `lang='es'`: the
// Spanish title gloss, Spanish chrome, and the page's SPANISH text excerpted
// where it exists (else the English pivot, labelled as English).
export const alt = PAGE_OG_ALT.es;
export const size = PAGE_OG_SIZE;
export const contentType = PAGE_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  return renderPageOgImage(id, pageId, 'es');
}
