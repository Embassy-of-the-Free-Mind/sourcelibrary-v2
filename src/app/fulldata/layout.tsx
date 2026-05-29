import { requireAdmin } from '@/lib/auth-helpers';

export default async function FullDataLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
