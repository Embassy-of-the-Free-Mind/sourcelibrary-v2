import type { Metadata } from 'next';
import BaseLayout, { generateMetadata as baseMetadata } from '@/app/book/[id]/page/[pageId]/layout';

// Latin twin of the reader segment (#6254). Same shell, same existence gate,
// same data; only the URL identity differs — canonical under /la with hreflang
// twins. The reader client derives its language and its URL prefix from the
// /la pathname, and opens on the Latin transcription rather than the English.
// Segment config must be a static literal (Next parses it at build time) —
// keep in step with src/app/book/[id]/page/[pageId]/layout.tsx.
export const preferredRegion = 'fra1';

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string; pageId: string }>;
}

export async function generateMetadata(props: LayoutProps): Promise<Metadata> {
  const base = await baseMetadata({ ...props, lang: 'la' });
  const { id, pageId } = await props.params;
  const path = `/book/${id}/page/${pageId}`;
  return {
    ...base,
    alternates: {
      ...(base.alternates || {}),
      canonical: `/la${path}`,
      languages: { en: path, la: `/la${path}`, 'x-default': path },
    },
    openGraph: { ...(base.openGraph || {}), locale: 'la_VA' },
  };
}

export default async function LaReaderLayout(props: LayoutProps) {
  // `lang='la'` is what makes the base layout enforce the localized-URL promise:
  // a book that is not written in Latin 307s to the English reader.
  return BaseLayout({ ...props, lang: 'la' });
}
