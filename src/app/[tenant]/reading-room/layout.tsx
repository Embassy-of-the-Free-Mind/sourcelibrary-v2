import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The Reading Room — Source Library',
  description: 'Ask the Librarian about any text in the collection. Alchemy, Hermetica, Kabbalah, astrology, natural philosophy — thousands of rare books, many translated into English for the first time.',
  openGraph: {
    title: 'The Reading Room — Source Library',
    description: 'Ask the Librarian about any text in the collection.',
    siteName: 'Source Library',
    type: 'website',
  },
};

export default function ReadingRoomLayout({ children }: { children: React.ReactNode }) {
  return children;
}
