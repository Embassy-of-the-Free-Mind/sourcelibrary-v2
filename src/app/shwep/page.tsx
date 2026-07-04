import { Metadata } from 'next';
import { getShwepIndexData } from './shwep-data';
import ShwepClient from './ShwepClient';

// ISR: rebuild every 6 hours. Allow 60s for first-hit generation.
// Must be a finite number — `false` would cache a bad-render fallback forever.
export const revalidate = 21600;
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

// No try/catch: a thrown error during ISR revalidation keeps serving the
// last good page, while catching it here would render (and cache) an
// all-zero episode index for the full revalidate window. Cold failures land
// on src/app/error.tsx.
export default async function ShwepPage() {
  const data = await getShwepIndexData();

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#f6f3ee] to-[#f3ede6]">
      <ShwepClient data={data} />
    </div>
  );
}
