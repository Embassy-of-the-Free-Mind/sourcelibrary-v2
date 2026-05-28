import type { Metadata } from 'next';
import GalleryQualityReview from '@/components/review/GalleryQualityReview';

export const metadata: Metadata = {
  title: 'Gallery quality — Source Library',
  description: 'Help us decide which extracted images belong in book galleries.',
};

export default function GalleryQualityPage() {
  return <GalleryQualityReview />;
}
