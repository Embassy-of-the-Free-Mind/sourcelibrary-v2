import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';
import { siteOgImage } from '@/lib/og-locale';

// Dutch edition of the homepage (#6382), the mirror of `/la` (#6254): a
// front door onto books WRITTEN in Dutch, read in the original. Nothing is
// translated into Dutch; the shelf under the hero (`nativeShelf`) is the one
// section whose books are in the page's language.
export const revalidate = 60;
export const maxDuration = 60;

const TITLE = 'Source Library: bibliotheek van historische bronnen';
const DESCRIPTION =
  'Source Library digitaliseert, transcribeert en vertaalt oude teksten. Honderden boeken die in het Nederlands zijn geschreven lees je hier in de oorspronkelijke tekst, naast de scan.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: {
    canonical: '/nl',
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
  // The image is the English card until art in this language exists (see og-locale.ts).
  openGraph: {
    images: [siteOgImage('nl')],
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'Source Library',
    type: 'website',
    locale: 'nl_NL',
    url: 'https://sourcelibrary.org/nl',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@SourceLibrary_',
    title: TITLE,
    description: DESCRIPTION,
    images: [siteOgImage('nl')],
  },
};

export default async function HomePageNl() {
  const data = await getHomeData('nl');
  // Reading language is the URL prefix and nothing else: links out of this page
  // keep `/nl` where a twin route exists (localePath), and no preference is
  // stored anywhere (.claude/docs/i18n.md rule 6).
  return <HomeView data={data} lang="nl" />;
}
