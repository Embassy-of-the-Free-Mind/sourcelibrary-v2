import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The Librarian — Source Library',
  description: 'Ask the Librarian about any text in the collection. Alchemy, Hermetica, Kabbalah, astrology, natural philosophy — thousands of rare books, many translated into English for the first time.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'The Librarian — Source Library',
    description: 'Ask the Librarian about any text in the collection.',
    siteName: 'Source Library',
    type: 'website',
  },
};

export default function LibrarianLayout({ children }: { children: React.ReactNode }) {
  return children;
}
