import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { auth } from '@/lib/auth';
import { ROLE_LEVEL } from '@/lib/auth';
import { getTenantContext } from '@/lib/tenant-context';
import { effectiveCatalogRole, normalizeCatalogRole } from '@/lib/catalog-role';
import { catalogBasePath, catalogIndexPath } from '@/lib/catalog-nav';
import { fetchRecentRevisions, type RevisionRow } from '@/lib/bph-catalogue-activity';
import CatalogChangeLog from '@/components/catalog/CatalogChangeLog';

/**
 * The catalogue change log.
 *
 * Was a section at the bottom of the workspace page, which put a record of the
 * whole catalogue inside a page about one person's work. It is its own page
 * now, with its own nav link.
 */

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Changes — BPH catalogue',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ tenant: string }>;
}

export default async function CatalogChangesPage({ params }: Props) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();

  const ctx = await getTenantContext();
  const base = catalogBasePath(ctx?.source ?? null, tenant);
  const indexHref = catalogIndexPath(ctx?.source ?? null, tenant);

  const session = await auth();
  if (!session?.user) {
    redirect(`/${tenant}/login?callbackUrl=${encodeURIComponent(`${base}/changes`)}`);
  }

  const role = await effectiveCatalogRole(
    session.user.email,
    normalizeCatalogRole((session.user as { role?: unknown }).role),
    tenant
  );
  if (ROLE_LEVEL[role] < ROLE_LEVEL['editor']) redirect(indexHref);

  let revisions: RevisionRow[] = [];
  try {
    revisions = await fetchRecentRevisions(100);
  } catch (error) {
    console.error('[changes] load failed:', error);
  }

  return (
    <div className="bg-cream min-h-screen">
      <div className="max-w-[1500px] mx-auto px-6 py-8">
        <h1 className="text-2xl sm:text-3xl text-primary font-display leading-tight mb-1">
          Changes
        </h1>
        <p className="text-sm text-muted mb-5">
          Every edit to this catalogue, by a person or by our software, with what changed and why.
        </p>

        <CatalogChangeLog revisions={revisions} basePath={base} />

        <p className="text-xs text-muted mt-3">
          Showing the {revisions.length} most recent. Every record also has its own full history,
          linked from the record itself.
        </p>
      </div>
    </div>
  );
}
