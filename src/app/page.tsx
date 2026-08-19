import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { FEED_TYPES } from '@/lib/feed-links';

// ISR: serve cached HTML, revalidate in background every 60 seconds.
// The homepage uses $sample for randomness — content rotates every revalidation cycle.
export const revalidate = 60;
export const maxDuration = 60;

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
    languages: {
      en: '/',
      es: '/es',
      'x-default': '/',
    },
    // Next.js replaces the layout's whole `alternates` object rather than
    // merging it, so declaring `languages` here was silently dropping every
    // feed link from the site's most-linked page. See src/lib/feed-links.ts.
    types: FEED_TYPES,
  },
};

export default async function HomePage() {
  const data = await getHomeData('en');
  return <HomeView data={data} lang="en" />;
}
