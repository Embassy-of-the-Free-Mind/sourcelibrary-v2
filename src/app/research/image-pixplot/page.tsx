import { Metadata } from 'next';
import ImagePixPlotViz from '@/components/research/ImagePixPlotViz';
import dataRaw from '@/data/image-constellation.json';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Image PixPlot — Source Library',
  description: 'Browse thousands of illustrations from pre-modern texts arranged by visual similarity. Zoom in to see actual thumbnails.',
  alternates: { canonical: '/research/image-pixplot' },
};

export default function ImagePixPlotPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;
  return (
    <main className="h-screen bg-black overflow-hidden">
      <ImagePixPlotViz data={data} />
    </main>
  );
}
