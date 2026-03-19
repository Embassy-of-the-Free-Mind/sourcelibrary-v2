import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'The Ficino Society',
  description: 'A circle of scholars and readers translating the Western esoteric tradition. Join the community — free and open to everyone.',
  openGraph: {
    title: 'The Ficino Society',
    description: 'A circle of scholars and readers translating the Western esoteric tradition.',
    siteName: 'The Ficino Society',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Ficino Society',
    description: 'A circle of scholars and readers translating the Western esoteric tradition.',
  },
};

export default function FicinoSocietyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
