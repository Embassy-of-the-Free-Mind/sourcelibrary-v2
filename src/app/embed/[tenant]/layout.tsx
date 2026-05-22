import { TenantSessionUpdater } from '@/components/auth/TenantSessionUpdater';
import TenantUserChrome from '@/components/tenant/TenantUserChrome';

/**
 * Layout for /embed/[tenant]/* — the route group that tenant subdomains
 * (e.g. bph.sourcelibrary.org) get rewritten to by src/proxy.ts.
 *
 * Mirrors src/app/[tenant]/layout.tsx in mounting TenantSessionUpdater so
 * the user's tenant-scoped role (e.g. BPH editor) is resolved into their
 * session. Without this, client gates like <AuthCheck role="inner_circle">
 * never see the membership and editor-only UI stays hidden.
 *
 * TenantUserChrome is the only sign-out affordance on tenant subdomains —
 * the standard SiteHeader is hidden in embed mode. It renders null for
 * anonymous visitors so public browsing stays uncluttered.
 */
export default async function EmbedTenantLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return (
    <>
      <TenantSessionUpdater tenantSlug={tenant} />
      <TenantUserChrome />
      {children}
    </>
  );
}
