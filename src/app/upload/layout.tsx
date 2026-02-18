import { requireAdmin } from '@/lib/auth-helpers';

export default async function UploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <>{children}</>;
}
