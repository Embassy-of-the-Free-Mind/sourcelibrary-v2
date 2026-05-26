import { Suspense } from 'react';
import NotFoundContent from '@/components/layout/NotFoundContent';

// Route-segment not-found.tsx for /book/[id]. When notFound() is called from
// page.tsx or any of its children (BookInfo Suspense child included),
// Next.js renders this UI AND sets HTTP status 404. The global
// src/app/not-found.tsx renders the same body but, with ISR enabled at the
// page level (revalidate = 86400), the status sometimes commits as 200
// because streaming has already started — Vercel then caches that 200 for
// 24h. A segment-local not-found.tsx is the documented App Router escape
// hatch for that.
export default function BookNotFound() {
  return (
    <Suspense>
      <NotFoundContent />
    </Suspense>
  );
}
