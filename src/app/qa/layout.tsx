import { requireAdmin } from '@/lib/auth-helpers';

export default async function QALayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <>{children}</>;
}
