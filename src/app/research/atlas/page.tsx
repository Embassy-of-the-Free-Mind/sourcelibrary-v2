import { Metadata } from 'next';
import BookConstellationViz from '@/components/research/BookConstellationViz';
import dataRaw from '@/data/book-constellation.json';

export const metadata: Metadata = {
  title: 'Book Atlas — Source Library',
  description:
    'Explore 3,500 pre-modern texts as a navigable constellation, clustered by content similarity using AI embeddings and UMAP dimensionality reduction.',
  alternates: { canonical: '/research/atlas' },
};

export default function BookAtlasPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;
  return (
    <main className="h-screen bg-black overflow-hidden">
      <BookConstellationViz data={data} />
    </main>
  );
}
