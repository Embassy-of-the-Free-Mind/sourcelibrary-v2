import { requireAdmin } from '@/lib/auth-helpers';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check - redirects if not admin
  await requireAdmin();

  return <>{children}</>;
}
