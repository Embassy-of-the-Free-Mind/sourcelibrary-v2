import { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    template: '%s | Source Library Gallery',
    default: 'Image Gallery - Source Library',
  },
  description:
    'Browse illustrations, diagrams, and engravings extracted from rare Hermetic, alchemical, and philosophical texts. Searchable by subject, type, and period.',
  alternates: {
    canonical: '/gallery',
  },
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
