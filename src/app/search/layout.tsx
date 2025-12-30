import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Search - Source Library',
  description: 'Search translated historical texts. Find primary sources on alchemy, Hermeticism, natural philosophy, and early modern science.',
  alternates: {
    canonical: '/search',
  },
  openGraph: {
    title: 'Search - Source Library',
    description: 'Search translated historical texts. Find primary sources on alchemy, Hermeticism, natural philosophy, and early modern science.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/search',
  },
  twitter: {
    card: 'summary',
    title: 'Search - Source Library',
    description: 'Search translated historical texts. Find primary sources on alchemy, Hermeticism, natural philosophy, and early modern science.',
  },
};

export default function SearchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
