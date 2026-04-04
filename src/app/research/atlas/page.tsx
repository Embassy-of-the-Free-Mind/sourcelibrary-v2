import { Metadata } from 'next';
import BookConstellationViz from '@/components/research/BookConstellationViz';
import dataRaw from '@/data/book-constellation.json';

export const metadata: Metadata = {
  title: 'Book Atlas — Source Library',
  description:
    'Explore 8,900+ pre-modern texts as a navigable constellation, clustered by content similarity using AI embeddings and UMAP dimensionality reduction.',
  alternates: { canonical: '/research/atlas' },
};

export default async function BookAtlasPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode } = await searchParams;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = dataRaw as any;
  const initialColorMode = mode === 'taxonomy' ? 'taxonomy' : undefined;
  return (
    <main className="h-screen bg-black overflow-hidden">
      <BookConstellationViz data={data} initialColorMode={initialColorMode} />
    </main>
  );
}
