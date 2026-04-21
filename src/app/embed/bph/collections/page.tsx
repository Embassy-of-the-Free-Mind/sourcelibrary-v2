import { Suspense } from 'react';
import BPHCollections from './BPHCollections';

export const revalidate = 3600; // 1h ISR

export default function BPHCollectionsPage() {
  return (
    <Suspense fallback={
      <div className="p-6 max-w-7xl mx-auto">
        <div className="h-8 w-48 bg-stone-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-32 bg-stone-200 rounded animate-pulse" />
          ))}
        </div>
      </div>
    }>
      <BPHCollections />
    </Suspense>
  );
}
