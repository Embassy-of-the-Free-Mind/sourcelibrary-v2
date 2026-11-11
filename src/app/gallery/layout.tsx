import { Metadata } from 'next';
import GallerySchema from '@/components/seo/GallerySchema';

const galleryTitle = 'Image Gallery - Source Library';
const galleryDescription =
  'Browse illustrations, diagrams, and engravings extracted from rare Hermetic, alchemical, and philosophical texts. Searchable by subject, type, and period.';

export const metadata: Metadata = {
  title: {
    template: '%s | Source Library Gallery',
    default: galleryTitle,
  },
  description: galleryDescription,
  alternates: {
    canonical: '/gallery',
  },
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image-gallery.jpg', width: 1600, height: 840, alt: 'Illustrations from rare books in the Source Library gallery' }],
    title: galleryTitle,
    description: galleryDescription,
  },
  twitter: {
    card: 'summary_large_image',
    images: ['https://sourcelibrary.org/og-image-gallery.jpg'],
    title: galleryTitle,
    description: galleryDescription,
  },
};

export default function GalleryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <GallerySchema />
      {children}
    </>
  );
}
