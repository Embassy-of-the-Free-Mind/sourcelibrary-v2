import { TenantSessionUpdater } from '@/components/auth/TenantSessionUpdater';

/**
 * Layout for /embed/[tenant]/* — the route group that tenant subdomains
 * (e.g. bph.sourcelibrary.org) get rewritten to by src/proxy.ts.
 *
 * Mirrors src/app/[tenant]/layout.tsx in mounting TenantSessionUpdater so
 * the user's tenant-scoped role (e.g. BPH editor) is resolved into their
 * session. Without this, client gates like <AuthCheck role="inner_circle">
 * never see the membership and editor-only UI stays hidden.
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
      {children}
    </>
  );
}
