import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';
import { siteOgImage } from '@/lib/og-locale';

// Latin edition of the homepage (#6254) — a real, server-rendered, indexable
// route sharing the same data + body as `/` and `/es`.
//
// Latin is the reverse of the Spanish case. Nothing is translated INTO it; it
// is the language the largest share of the library was WRITTEN in. So this is
// a Latin front door onto books that are already Latin, and the shelf under the
// hero (`latinShelf`) is the one section whose books are in the page's language.
export const revalidate = 60;
export const maxDuration = 60;

const TITLE = 'Source Library: bibliotheca fontium antiquorum';
const DESCRIPTION =
  'Source Library textus antiquos photographice describit, transcribit, convertit. Milia librorum Latine scriptorum hic in ipso textu Latino leguntur: alchemia, Hermetica, philosophia, scientia.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/la',
    languages: {
      en: '/',
      es: '/es',
      la: '/la',
      nl: '/nl',
      zh: '/zh',
      'x-default': '/',
    },
    // See src/lib/feed-links.ts — declaring `languages` here replaces the
    // layout's whole `alternates`, feed links included.
    types: FEED_TYPES,
  },
  // Both blocks, or neither: declaring `openGraph` replaces the layout's block
  // whole while its `twitter` block survives (.claude/docs/i18n.md, share card).
  // The image is the English card until Latin art exists (see og-locale.ts).
  openGraph: {
    images: [siteOgImage('la')],
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'la_VA',
    url: 'https://sourcelibrary.org/la',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('la')],
  },
};

export default async function HomePageLa() {
  const data = await getHomeData('la');
  // Reading language is the URL prefix and nothing else: links out of this page
  // keep `/la` where a twin route exists (localePath), and no preference is
  // stored anywhere (.claude/docs/i18n.md rule 6).
  return <HomeView data={data} lang="la" />;
}
