import { Suspense } from 'react';
import BPHCatalogue from './BPHCatalogue';

export const revalidate = 300; // 5 min ISR

export default function BPHEmbedPage() {
  return (
    <Suspense fallback={<CatalogueSkeleton />}>
      <BPHCatalogue />
    </Suspense>
  );
}

function CatalogueSkeleton() {
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="h-10 w-64 bg-stone-200 rounded animate-pulse mb-6" />
      <div className="h-10 w-full bg-stone-100 rounded animate-pulse mb-8" />
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
        {Array.from({ length: 24 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] bg-stone-200 rounded animate-pulse" />
        ))}
      </div>
    </div>
  );
}
