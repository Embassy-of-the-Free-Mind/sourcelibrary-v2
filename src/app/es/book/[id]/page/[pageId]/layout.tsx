import type { Metadata } from 'next';
import BaseLayout, { generateMetadata as baseMetadata } from '@/app/book/[id]/page/[pageId]/layout';

/**
 * Spanish twin of the reader segment's shell (groundwork for the reader
 * redesign's Spanish chrome — see src/lib/reader-strings.ts). Same existence
 * gate, same data fetch, same `notFound()` — only the URL identity and the
 * `alternates`/`openGraph.locale` metadata differ, so this route is its own
 * indexable page rather than a duplicate of the English one.
 *
 * UNLIKE the established pattern for the OLD reader elsewhere on `main`
 * (`.claude/docs/i18n.md`, "the promise: an /es URL means the page IS
 * Spanish" — `/es/book/<id>/page/<pageId>` 307s to English unless the book
 * has actual Spanish PAGE TEXT, via `hasLocalizedEdition`), this twin does
 * NOT gate on content translation. The task that added it was explicit that
 * clicking "Español" from the reader must keep the reader on the page being
 * read, never bounce it away — and the redesign's Spanish work is CHROME
 * (panel titles, buttons, menu labels), independent of which language the
 * page's own transcription/translation happens to be in; a reader can
 * already switch the translation pane to Spanish per-page, where available,
 * via the toggle in ReaderSpanishToggle.tsx. This divergence from the
 * documented site policy is deliberate but worth a second look before or at
 * merge time — flagged in the session report that added this file.
 */
export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata(props: LayoutProps): Promise<Metadata> {
  const base = await baseMetadata(props);
  const { id, pageId } = await props.params;
  const path = `/book/${id}/page/${pageId}`;
  return {
    ...base,
    alternates: {
      ...(base.alternates || {}),
      canonical: `/es${path}`,
      languages: { en: path, es: `/es${path}`, 'x-default': path },
    },
    openGraph: base.openGraph ? { ...base.openGraph, locale: 'es_ES' } : base.openGraph,
  };
}

export default async function EsReaderLayout(props: LayoutProps) {
  return BaseLayout(props);
}
