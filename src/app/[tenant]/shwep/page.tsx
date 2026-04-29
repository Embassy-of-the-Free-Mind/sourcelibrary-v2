import { Metadata } from 'next';
import { getShwepIndexData } from './shwep-data';
import ShwepClient from './ShwepClient';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
export const revalidate = false;
export const maxDuration = 60;

export const metadata: Metadata = {
  title: 'SHWEP Reading Room - Source Library',
  description: 'Read the primary sources discussed on the Secret History of Western Esotericism Podcast. Browse episodes and access original texts in Latin, Greek, and other languages.',
  alternates: { canonical: '/shwep' },
  openGraph: {
    title: 'SHWEP Reading Room - Source Library',
    description: 'Read the primary sources discussed on the Secret History of Western Esotericism Podcast.',
    url: 'https://sourcelibrary.org/shwep',
  },
};

export default async function ShwepPage() {
  let data;
  try {
    data = await getShwepIndexData();
  } catch (err) {
    console.error('SHWEP data fetch failed:', err);
    data = {
      periods: [],
      galleryImages: [],
      stats: { totalEpisodes: 0, episodesWithBooks: 0, totalMatches: 0, totalBooksInCollection: 0 },
    };
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <ShwepClient data={data} />
    </div>
  );
}
