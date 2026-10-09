import type { Metadata } from 'next';
import { Suspense } from 'react';
import NotFoundContent from '@/components/layout/NotFoundContent';

// Without this the 404 inherits the homepage <title>, so a missing page reads
// as the homepage in browser tabs, history and crawler reports (#6092).
export const metadata: Metadata = {
  title: 'Page not found | Source Library',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <Suspense>
      <NotFoundContent />
    </Suspense>
  );
}
