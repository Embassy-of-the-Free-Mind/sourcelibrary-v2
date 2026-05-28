import { Metadata } from 'next';
import { TaxonomyExplorer } from '@/components/taxonomy/TaxonomyExplorer';

export const metadata: Metadata = {
  title: 'Taxonomy Explorer | Source Library',
  robots: 'noindex',
};

export const revalidate = false;

export default function TaxonomyPage() {
  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <TaxonomyExplorer />
      </div>
    </div>
  );
}
