import type { Metadata } from 'next';
import ImageWall from '@/components/gallery/ImageWall';

export const metadata: Metadata = {
  title: 'Image Wall — Source Library',
  description: 'Explore thousands of illustrations, engravings, woodcuts, and diagrams extracted from rare historical texts — all on a single zoomable canvas.',
  robots: { index: true, follow: true },
};

/**
 * /gallery/wall — Zoomable image wall displaying all gallery images on a single canvas.
 *
 * The manifest is fetched client-side (2-5MB) to avoid blocking SSR.
 * The component handles loading state, viewport culling, and image eviction.
 */
export default function ImageWallPage() {
  return <ImageWall />;
}
