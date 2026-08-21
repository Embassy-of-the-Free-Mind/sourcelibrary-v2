import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Encyclopedia - Source Library',
  description: 'Explore people, places, and concepts from historical texts. Discover connections between alchemists, philosophers, and esoteric ideas across the collection.',
  alternates: {
    canonical: '/encyclopedia',
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Encyclopedia - Source Library',
    description: 'Explore people, places, and concepts from historical texts. Discover connections between alchemists, philosophers, and esoteric ideas across the collection.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/encyclopedia',
  },
  twitter: {
    card: 'summary',
    title: 'Encyclopedia - Source Library',
    description: 'Explore people, places, and concepts from historical texts. Discover connections between alchemists, philosophers, and esoteric ideas.',
  },
};

export default function EncyclopediaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
