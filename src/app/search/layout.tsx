import { Suspense } from 'react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search - Source Library',
  description: 'Search over 10,000 translated primary sources — alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
  alternates: {
    canonical: '/search',
    languages: { en: '/search', es: '/es/search', 'x-default': '/search' },
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Search - Source Library',
    description: 'Search over 10,000 translated primary sources — alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/search',
  },
  twitter: {
    card: 'summary',
    title: 'Search - Source Library',
    description: 'Search over 10,000 translated primary sources — alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense>
      <h1 className="sr-only">Search Source Library</h1>
      {children}
    </Suspense>
  );
}
