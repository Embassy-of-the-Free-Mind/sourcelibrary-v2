import BasePage from '@/app/book/[id]/page/[pageId]/(reader)/page';

/**
 * Dutch twin of the reader page (#6254, #6382). Identical server render with
 * `lang='nl'`: the crawler nav below the reader keeps the `/nl` prefix. The
 * reader itself is a client component and takes its language from the pathname
 * (`useLocale()`), which is also how every page flip keeps `/nl`.
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with the English reader page (ISR, 24h).
export const revalidate = 86400;

type Props = { params: Promise<{ id: string; pageId: string }> };

export default async function LaReaderPage(props: Props) {
  return BasePage({ ...props, lang: 'nl' });
}
