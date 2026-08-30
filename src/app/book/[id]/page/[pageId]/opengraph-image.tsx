import { renderPageOgImage, PAGE_OG_ALT, PAGE_OG_SIZE, PAGE_OG_CONTENT_TYPE } from '@/lib/og-page-card';

// The card itself lives in src/lib/og-page-card.tsx so the `/es` reader renders
// the SAME card in Spanish — a file-based opengraph-image only covers its own
// route segment, so the Spanish twin needs its own two-line file (#4162).
export const alt = PAGE_OG_ALT.en;
export const size = PAGE_OG_SIZE;
export const contentType = PAGE_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string; pageId: string }> }) {
  const { id, pageId } = await params;
  return renderPageOgImage(id, pageId, 'en');
}
