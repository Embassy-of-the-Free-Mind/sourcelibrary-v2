import { requireAuth } from '@/lib/auth-helpers';

export default async function JobsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check - redirects to /auth/signin if not authenticated
  await requireAuth();

  return <>{children}</>;
}
