import { Suspense } from 'react';
import { requireAdmin } from '@/lib/auth-helpers';

export default async function ExperimentsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check - redirects if not admin
  await requireAdmin();

  return <Suspense>{children}</Suspense>;
}
