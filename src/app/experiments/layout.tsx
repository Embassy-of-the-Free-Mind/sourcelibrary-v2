import { Suspense } from 'react';
import { requireInnerCircle } from '@/lib/auth-helpers';

export default async function ExperimentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check - redirects if not admin or inner_circle
  await requireInnerCircle();

  return <Suspense>{children}</Suspense>;
}
