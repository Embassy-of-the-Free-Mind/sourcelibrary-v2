import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The Embassy of the Free Mind',
  description: 'A digital scholarly institution for the Western esoteric tradition. Talk to the Librarian, explore the collection, and meet fellow seekers.',
  openGraph: {
    title: 'The Embassy of the Free Mind',
    description: 'A digital scholarly institution for the Western esoteric tradition.',
    siteName: 'Source Library',
    type: 'website',
  },
};

export default function EmbassyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
