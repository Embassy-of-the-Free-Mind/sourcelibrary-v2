import type { Metadata } from 'next';
import BaseLayout, { generateMetadata as baseMetadata } from '@/app/book/[id]/page/[pageId]/layout';

// Dutch twin of the reader segment (#6254, #6382). Same shell, same existence gate,
// same data; only the URL identity differs — canonical under /nl with hreflang
// twins. The reader client derives its language and its URL prefix from the
// /nl pathname, and opens on the Dutch transcription rather than the English.
// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/book/[id]/page/[pageId]/layout.tsx.
export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata(props: LayoutProps): Promise<Metadata> {
  const base = await baseMetadata({ ...props, lang: 'nl' });
  const { id, pageId } = await props.params;
  const path = `/book/${id}/page/${pageId}`;
  return {
    ...base,
    alternates: {
      ...(base.alternates || {}),
      canonical: `/nl${path}`,
      languages: { en: path, nl: `/nl${path}`, 'x-default': path },
    },
    openGraph: { ...(base.openGraph || {}), locale: 'la_VA' },
  };
}

export default async function LaReaderLayout(props: LayoutProps) {
  // `lang='nl'` is what makes the base layout enforce the localized-URL promise:
  // a book that is not written in Dutch 307s to the English reader.
  return BaseLayout({ ...props, lang: 'nl' });
}
