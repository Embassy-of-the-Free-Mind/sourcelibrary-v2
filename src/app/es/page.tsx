import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';

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
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Source Library — Fuentes antiguas traducidas con IA',
    description:
      'La mayor biblioteca de acceso abierto de fuentes primarias traducidas. Alquimia, hermética, filosofía y ciencia, accesibles para todos.',
    locale: 'es_ES',
    url: 'https://sourcelibrary.org/es',
  },
};

export default async function HomePageEs() {
  const data = await getHomeData('es');
  return <HomeView data={data} lang="es" />;
}
