import { Suspense } from 'react';
import NotFoundContent from '@/components/layout/NotFoundContent';

export default function NotFound() {
  return (
    <Suspense>
      <NotFoundContent />
    </Suspense>
  );
}
