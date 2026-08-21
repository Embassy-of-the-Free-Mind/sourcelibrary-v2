import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';
import { siteOgImage } from '@/lib/og-locale';

// Spanish-language edition of the homepage — a real, server-rendered, indexable
// route (not a client string swap), sharing the same data + body as `/`.
export const revalidate = 60;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'Source Library — La mayor biblioteca de fuentes antiguas traducidas con IA',
  description:
    'Source Library digitaliza y traduce textos antiguos para estudiosos, buscadores y sistemas de IA. Explora miles de fuentes primarias de alquimia, hermética, filosofía y ciencia.',
  alternates: {
    canonical: '/es',
    languages: {
      en: '/',
      es: '/es',
      'x-default': '/',
    },
    // See src/lib/feed-links.ts — declaring `languages` here replaces the
    // layout's whole `alternates`, feed links included.
    types: FEED_TYPES,
  },
  openGraph: {
    images: [siteOgImage('es')],
    title: 'Source Library — Fuentes antiguas traducidas con IA',
    description:
      'La mayor biblioteca de acceso abierto de fuentes primarias traducidas. Alquimia, hermética, filosofía y ciencia, accesibles para todos.',
    siteName: 'Source Library',
    type: 'website',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es',
  },
  // Declaring `openGraph` replaces the layout's block whole — and X/Twitter and
  // WhatsApp fall back to `twitter:image` when they find one, which is how the
  // English card kept showing on /es pages. Both blocks must be Spanish.
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: 'Source Library — Fuentes antiguas traducidas con IA',
    description:
      'La mayor biblioteca de acceso abierto de fuentes primarias traducidas. Alquimia, hermética, filosofía y ciencia, accesibles para todos.',
    images: [siteOgImage('es')],
  },
};

export default async function HomePageEs() {
  const data = await getHomeData('es');
  return (
    <>
      {/* Arriving via the Spanish front door means "I read Spanish": books
          opened afterwards start in their Spanish edition where one exists.
          Client-side localStorage only — this page stays ISR and cache-safe. */}
      <HomeView data={data} lang="es" />
    </>
  );
}
