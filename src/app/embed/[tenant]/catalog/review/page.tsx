import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath } from '@/lib/catalog-nav';

/**
 * The pending-changes review queue moved into the catalogue Inbox as a tab,
 * alongside reader feedback, so librarians have one place for "things needing
 * me" rather than two links that read as redundant.
 *
 * Kept as a redirect: this URL was in the toolbar, in the onboarding email
 * sent to the cataloguers, and is bookmarked. The page body, its role gate and
 * its Supabase queries now live in ../inbox.
 */
export default async function CatalogReviewRedirect({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();
  const base = catalogBasePath((await getTenantContext())?.source ?? null, tenant);
  redirect(`${base}/inbox?tab=edits`);
}
