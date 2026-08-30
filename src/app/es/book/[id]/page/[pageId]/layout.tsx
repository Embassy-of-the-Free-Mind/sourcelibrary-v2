import type { Metadata } from 'next';
import BaseLayout, { generateMetadata as baseMetadata } from '@/app/book/[id]/page/[pageId]/layout';

// Spanish twin of the reader segment (#4082). Same shell, same existence gate,
// same data; only the URL identity differs — canonical under /es with hreflang
// twins, so the Spanish reader is its own indexable page. The reader client
// derives its language and its URL prefix from the /es pathname.
// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/book/[id]/page/[pageId]/layout.tsx.
export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata(props: LayoutProps): Promise<Metadata> {
  const base = await baseMetadata({ ...props, lang: 'es' });
  const { id, pageId } = await props.params;
  const path = `/book/${id}/page/${pageId}`;
  return {
    ...base,
    alternates: {
      ...(base.alternates || {}),
      canonical: `/es${path}`,
      languages: { en: path, es: `/es${path}`, 'x-default': path },
    },
    openGraph: { ...(base.openGraph || {}), locale: 'es_ES' },
  };
}

export default async function EsReaderLayout(props: LayoutProps) {
  // `lang='es'` is what makes the base layout enforce the localized-URL promise
  // (a book with no Spanish edition 307s to the English reader) and name the
  // book in Spanish in the shell's metadata.
  return BaseLayout({ ...props, lang: 'es' });
}
