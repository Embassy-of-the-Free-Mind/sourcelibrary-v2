import { requireInnerCircle } from '@/lib/auth-helpers';

export default async function TrafficLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side auth check — redirects if not admin or inner_circle.
  // First-party pageview data includes anonymized visitor IPs; keep it gated.
  await requireInnerCircle();

  return <>{children}</>;
}
