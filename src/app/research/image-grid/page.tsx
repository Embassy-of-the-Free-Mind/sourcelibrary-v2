import { Metadata } from 'next';
import ImageAtlasGridViz from '@/components/research/ImageAtlasGridViz';
import dataRaw from '@/data/image-constellation.json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Image Grid — Source Library',
  description: 'Browse thousands of illustrations from pre-modern texts in a dense, zoomable atlas grid.',
  alternates: { canonical: '/research/image-grid' },
};

export default function ImageGridPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;
  return (
    <main className="h-screen bg-black overflow-hidden">
      <ImageAtlasGridViz data={data} />
    </main>
  );
}
