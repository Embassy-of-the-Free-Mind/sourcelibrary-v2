import { renderBookOgImage, BOOK_OG_ALT, BOOK_OG_SIZE, BOOK_OG_CONTENT_TYPE } from '@/lib/og-book-card';

// The card itself lives in src/lib/og-book-card.tsx so `/es/book/[id]` renders
// the SAME card in Spanish — a file-based opengraph-image only covers its own
// route segment, so the Spanish twin needs its own two-line file (#4162).
export const alt = BOOK_OG_ALT.en;
export const size = BOOK_OG_SIZE;
export const contentType = BOOK_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderBookOgImage(id, 'en');
}
