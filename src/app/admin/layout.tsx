import { requireAdmin } from '@/lib/auth-helpers';
import { resolveSpendViewer } from '@/lib/spend-report';
import { AdminNav } from './AdminNav';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  // The spend report (#5225) is allow-listed, narrower than "admin": only show
  // the link to accounts the page itself would admit. The page re-checks.
  const spend = await resolveSpendViewer(session);

  return (
    <>
      <AdminNav extraLinks={spend ? [{ href: '/admin/spend', label: 'Spend' }] : []} />
      {children}
    </>
  );
}
