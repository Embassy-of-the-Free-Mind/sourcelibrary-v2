import { Metadata } from 'next';
import ImageDeepZoomViz from '@/components/research/ImageDeepZoomViz';
import dataRaw from '@/data/image-constellation.json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Image Atlas — Source Library',
  description:
    'Explore thousands of illustrations from pre-modern texts as an interactive constellation, clustered by visual content similarity.',
  alternates: { canonical: '/research/image-atlas' },
};

export default function ImageAtlasPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;
  return (
    <main className="h-screen bg-black overflow-hidden">
      <ImageDeepZoomViz data={data} />
    </main>
  );
}
