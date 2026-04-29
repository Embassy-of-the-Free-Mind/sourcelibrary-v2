import { requireAdmin } from '@/lib/auth-helpers';
import { AdminNav } from './AdminNav';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <>
      <AdminNav />
      {children}
    </>
  );
}
