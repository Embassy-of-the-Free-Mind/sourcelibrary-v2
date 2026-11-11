import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';
import { huntDoorHtmlComment } from '@/lib/hunt-doors';
import { homeAssistantGuide } from '@/lib/assistant-guide';

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
      la: '/la',
      nl: '/nl',
      zh: '/zh',
      'x-default': '/',
    },
    // Next.js replaces the layout's whole `alternates` object rather than
    // merging it, so declaring `languages` here was silently dropping every
    // feed link from the site's most-linked page. See src/lib/feed-links.ts.
  },
};

export default async function HomePage() {
  const data = await getHomeData('en');
  return (
    <>
      {/* The HTML-comment door of the hunt (#8150 slice 4). Global home only: a partner
          subdomain's "/" is rewritten to /embed/<tenant> and never renders this page. */}
      <div hidden dangerouslySetInnerHTML={{ __html: `<!--${huntDoorHtmlComment()}-->` }} />
      <p className="sr-only">{homeAssistantGuide()}</p>
      <HomeView data={data} lang="en" />
    </>
  );
}
