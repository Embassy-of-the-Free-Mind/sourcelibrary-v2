import { Suspense } from 'react';
import { Metadata } from 'next';
import { siteOgImage, OG_LOCALE } from '@/lib/og-locale';

// Latin twin of src/app/search/layout.tsx (#7175). The `<Suspense>` boundary is
// load-bearing: the page reads `useSearchParams`.

const TITLE = 'Quaere - Source Library';
const DESCRIPTION =
  'Quaere in libris Latine scriptis: alchemia, Hermetica, philosophia, scientia. Loci ex ipso textu Latino afferuntur.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/la/search',
    languages: { en: '/search', es: '/es/search', la: '/la/search', zh: '/zh/search', 'x-default': '/search' },
  },
  // Both blocks, always (i18n.md, "the share card").
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: OG_LOCALE.la,
    url: 'https://sourcelibrary.org/la/search',
    images: [siteOgImage('la')],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('la')],
  },
};

export default function LaSearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <h1 className="sr-only">Quaere in Source Library</h1>
      {children}
    </Suspense>
  );
}
