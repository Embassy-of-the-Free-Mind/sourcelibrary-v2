import type { Metadata } from 'next';
import BaseLayout, { generateMetadata as baseMetadata, preferredRegion as basePreferredRegion } from '@/app/book/[id]/page/[pageId]/layout';

// Spanish twin of the reader segment (#4082). Same shell, same existence gate,
// same data; only the URL identity differs — canonical under /es with hreflang
// twins, so the Spanish reader is its own indexable page. The reader client
// derives its language and its URL prefix from the /es pathname.
export const preferredRegion = basePreferredRegion;

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
    openGraph: { ...(base.openGraph || {}), locale: 'es_ES' },
  };
}

export default BaseLayout;
