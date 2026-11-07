import { Suspense } from 'react';
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search - Source Library',
  description: 'Search over 10,000 translated primary sources: alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
  alternates: {
    canonical: '/search',
    languages: { en: '/search', es: '/es/search', la: '/la/search', zh: '/zh/search', 'x-default': '/search' },
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library: Digitizing and translating ancient texts' }],
    title: 'Search - Source Library',
    description: 'Search over 10,000 translated primary sources: alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/search',
  },
  twitter: {
    card: 'summary',
    title: 'Search - Source Library',
    description: 'Search over 10,000 translated primary sources: alchemy, Hermetica, Kabbalah, natural philosophy, Sanskrit, Chinese classics, Arabic philosophy, and more.',
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
      {/* A tool that runs no JavaScript sees an empty page here. Plain text rather
          than a link: this layout is static and also serves partner hosts, where
          that address is refused (#8161). */}
      <noscript>
        <p>This page needs JavaScript. Without it, results are at /search/text?q=YOUR+WORDS on sourcelibrary.org.</p>
      </noscript>
      {children}
    </Suspense>
  );
}
