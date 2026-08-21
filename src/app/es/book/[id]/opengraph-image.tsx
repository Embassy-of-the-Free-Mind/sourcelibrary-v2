import { renderBookOgImage, BOOK_OG_ALT, BOOK_OG_SIZE, BOOK_OG_CONTENT_TYPE } from '@/lib/og-book-card';

// Spanish twin of /book/[id]'s share card. Same renderer, `lang='es'`: the
// Spanish title gloss where the book has one (else the original title, never
// the English gloss), Spanish chip labels, Spanish language name.
export const alt = BOOK_OG_ALT.es;
export const size = BOOK_OG_SIZE;
export const contentType = BOOK_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderBookOgImage(id, 'es');
}
