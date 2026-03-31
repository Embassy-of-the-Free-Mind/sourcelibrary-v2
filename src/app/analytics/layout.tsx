import { requireInnerCircle } from '@/lib/auth-helpers';

export default async function AnalyticsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check - redirects if not admin or inner_circle
  await requireInnerCircle();

  return <>{children}</>;
}
