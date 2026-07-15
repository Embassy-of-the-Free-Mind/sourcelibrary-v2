import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Categories - Source Library',
  description: 'Browse books by category: alchemy, astrology, Hermetica, Kabbalah, natural philosophy, and more. Explore the Western esoteric tradition.',
  alternates: {
    canonical: '/categories',
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Categories - Source Library',
    description: 'Browse books by category: alchemy, astrology, Hermetica, Kabbalah, natural philosophy, and more.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/categories',
  },
  twitter: {
    card: 'summary',
    title: 'Categories - Source Library',
    description: 'Browse books by category: alchemy, astrology, Hermetica, Kabbalah, natural philosophy, and more.',
  },
};

export default function CategoriesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
