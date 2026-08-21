import type { Metadata } from 'next';

// Social-card invariant (CLAUDE.md): a page that defines openGraph must set
// images explicitly and mirror them in a twitter block.
export const metadata: Metadata = {
  title: 'Identify an Artwork | Source Library',
  description:
    'Photograph any print or engraving — on a museum wall or the open page of an old book — and find the original in Source Library, with the book it belongs to.',
  openGraph: {
    title: 'Every picture on these walls comes from a book',
    description:
      'Photograph any print or engraving and find the original in Source Library, with the book it belongs to.',
    images: ['/images/identify-hero.jpg'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Every picture on these walls comes from a book',
    description:
      'Photograph any print or engraving and find the original in Source Library, with the book it belongs to.',
    images: ['/images/identify-hero.jpg'],
  },
};

export default function IdentifyLayout({ children }: { children: React.ReactNode }) {
  return children;
}
