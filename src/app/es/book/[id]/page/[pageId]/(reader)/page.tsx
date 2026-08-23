import BasePage from '@/app/book/[id]/page/[pageId]/(reader)/page';

/**
 * Spanish twin of the reader page. Identical server render with `lang='es'`:
 * the crawler nav below the reader keeps the `/es` prefix on the links that
 * have a twin (prev/next page) and leaves the ones that don't (book detail,
 * overview) pointed at English — see the `lp()` helper added to the base
 * page for this. `Reader2C` itself is a client component and reads its own
 * locale from the URL via `useLocale()` (src/lib/i18n.ts), then its chrome
 * from `src/lib/reader-strings.ts` — the same as every other localized client
 * component on the site — so nothing here threads `lang` into it.
 */

// Segment config must be a static literal (Next parses it at build time) —
// keep in step with the English reader page (ISR, 24h).
export const revalidate = 86400;

type Props = { params: Promise<{ id: string; pageId: string }> };

export default async function EsReaderPage(props: Props) {
  return BasePage({ ...props, lang: 'es' });
}
