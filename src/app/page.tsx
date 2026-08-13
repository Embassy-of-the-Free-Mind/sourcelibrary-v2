import type { Metadata } from 'next';
import { getHomeData } from '@/lib/home-data';
import HomeView from '@/components/home/HomeView';

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
  },
};

export default async function HomePage() {
  const data = await getHomeData('en');
  return <HomeView data={data} lang="en" />;
}
