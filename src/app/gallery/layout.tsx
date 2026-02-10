import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Image Gallery - Source Library',
  description:
    'Browse illustrations, diagrams, and engravings extracted from rare Hermetic, alchemical, and philosophical texts. Searchable by subject, type, and period.',
  alternates: {
    canonical: '/gallery',
  },
  openGraph: {
    title: 'Image Gallery',
    description:
      'Browse illustrations, diagrams, and engravings from rare historical texts — digitized and catalogued with AI.',
    type: 'website',
    siteName: 'Source Library',
    locale: 'en_US',
    url: '/gallery',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Image Gallery - Source Library',
    description:
      'Browse illustrations from rare Hermetic, alchemical, and philosophical texts.',
  },
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
