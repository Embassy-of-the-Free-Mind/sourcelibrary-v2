import { Suspense } from 'react';
import CurateClient from '@/components/gallery/CurateClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Curate Gallery — Source Library',
  description: 'Review and curate gallery images by quality',
  robots: { index: false },
};

export default function CuratePage() {
  return (
    <div className="min-h-screen bg-cream">
      <Suspense>
        <CurateClient />
      </Suspense>
    </div>
  );
}
