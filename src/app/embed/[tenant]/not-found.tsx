import type { Metadata } from 'next';
import { Suspense } from 'react';
import NotFoundContent from '@/components/layout/NotFoundContent';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false },
};

export default function EmbedTenantNotFound() {
  return (
    <Suspense>
      <NotFoundContent />
    </Suspense>
  );
}
