import { Metadata } from 'next';
import { TaxonomyExplorer } from '@/components/taxonomy/TaxonomyExplorer';
import TaxonomyScatter from '@/components/taxonomy/TaxonomyScatter';
import scatterDataRaw from '@/data/taxonomy-scatter.json';

export const metadata: Metadata = {
  title: 'Taxonomy Explorer | Source Library',
  robots: 'noindex',
};

export const dynamic = 'force-dynamic';

export default function TaxonomyPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scatterData = scatterDataRaw as any;
  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <TaxonomyScatter data={scatterData} />
        <div className="mt-12">
          <TaxonomyExplorer />
        </div>
      </div>
    </div>
  );
}
