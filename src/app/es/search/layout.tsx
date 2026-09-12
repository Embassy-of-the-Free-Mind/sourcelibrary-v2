import { Suspense } from 'react';
import { Metadata } from 'next';
import { siteOgImage, OG_LOCALE } from '@/lib/og-locale';

// Spanish twin of src/app/search/layout.tsx. The `<Suspense>` boundary is not
// decoration: the page reads `useSearchParams`, which needs one, and the
// English route gets its own from here too.

const TITLE = 'Buscar - Source Library';
const DESCRIPTION =
  'Busca en la biblioteca en español: fuentes primarias sobre alquimia, hermetismo, cábala y filosofía natural, con los resultados y los fragmentos tomados de la edición en español.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/es/search',
    languages: { en: '/search', es: '/es/search', 'x-default': '/search' },
  },
  // Both blocks, always. Declaring only `openGraph` leaves the root layout's
  // ENGLISH `twitter` block in place, which is how /es/collections shipped an
  // English share card over a Spanish page (#4162, i18n.md "the share card").
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: OG_LOCALE.es,
    url: 'https://sourcelibrary.org/es/search',
    images: [siteOgImage('es')],
  },
  twitter: {
    card: 'summary',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('es')],
  },
};

export default function EsSearchLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <h1 className="sr-only">Buscar en Source Library</h1>
      {children}
    </Suspense>
  );
}
