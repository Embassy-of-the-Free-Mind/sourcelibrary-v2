import type { Metadata } from 'next';
import { Suspense } from 'react';
import ShelfViewer from './ShelfViewer';

export const metadata: Metadata = {
  title: 'Shelf (prototype) | Source Library',
  description: 'A prototype 3D bookcase for browsing one collection.',
  robots: { index: false, follow: false },
};

/**
 * Prototype only (#6855). One collection as a 3D bookcase: `?c=<collection-slug>`.
 * Reads the public collection API; writes nothing.
 */
export default function ShelfPage() {
  return (
    <Suspense>
      <ShelfViewer />
    </Suspense>
  );
}
