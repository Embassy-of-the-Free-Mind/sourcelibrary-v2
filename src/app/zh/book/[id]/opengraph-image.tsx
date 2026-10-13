import { renderBookOgImage, BOOK_OG_ALT, BOOK_OG_SIZE, BOOK_OG_CONTENT_TYPE } from '@/lib/og-book-card';

// Chinese twin of /book/[id]'s share card (#6254, #6382). Same renderer, `lang='zh'`:
// the original title, Chinese chip labels.
export const alt = BOOK_OG_ALT.zh;
export const size = BOOK_OG_SIZE;
export const contentType = BOOK_OG_CONTENT_TYPE;

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return renderBookOgImage(id, 'zh');
}
