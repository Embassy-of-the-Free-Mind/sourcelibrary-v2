import LibrarianPage from '@/app/librarian/page';

/**
 * Chinese Librarian (图书馆员). The SAME page as `/librarian`, rendered with
 * `lang='zh'` (#8576): Chinese chrome from `src/lib/librarian-i18n.ts`,
 * `/zh`-prefixed links, and `lang: 'zh'` on every chat request so the Librarian
 * answers in Chinese. We hold no Chinese edition of the pages, so passages are
 * quoted as they stand (English translation or the original text).
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/librarian/page.tsx.
export const revalidate = 86400;

export default async function ZhLibrarianPage() {
  return LibrarianPage({ lang: 'zh' });
}
