import BasePage from '@/app/book/[id]/page/[pageId]/(reader)/page';

/**
 * Spanish twin of the reader page (#4082). Identical server render with
 * `lang='es'`: the crawler nav below the reader keeps the `/es` prefix and
 * names the book by its Spanish title. The reader itself is a client
 * component and takes its language from the pathname (`useLocale()`), which is
 * also how every page flip keeps `/es`. See .claude/docs/i18n.md rule 5.
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with the English reader page (ISR, 24h).
export const revalidate = 86400;

type Props = { params: Promise<{ id: string; pageId: string }> };

export default async function EsReaderPage(props: Props) {
  return BasePage({ ...props, lang: 'es' });
}
