import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Explore — Source Library',
  description:
    'Explore 12,500+ entities across the Western esoteric tradition — interactive map, timeline, and knowledge network built from AI-indexed historical texts and Wikidata.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Explore — Source Library',
    description:
      'Interactive visualizations of people, places, and concepts from 1,200+ digitized historical texts.',
    url: 'https://sourcelibrary.org/explore',
    siteName: 'Source Library',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Explore — Source Library',
    description:
      'Interactive visualizations of people, places, and concepts from 1,200+ digitized historical texts.',
  },
};

export default function ExploreLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
