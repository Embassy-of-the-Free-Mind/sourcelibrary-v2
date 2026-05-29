import { requireAdmin } from '@/lib/auth-helpers';

export default async function ScanLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
