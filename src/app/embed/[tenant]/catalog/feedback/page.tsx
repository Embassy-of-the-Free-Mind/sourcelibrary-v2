import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath } from '@/lib/catalog-nav';

/**
 * Feedback moved into the catalogue Inbox as a tab, alongside proposed edits,
 * so librarians have one place for "things needing me" rather than two links
 * that read as redundant.
 *
 * Kept as a redirect because this URL has been handed out (the toolbar linked
 * it, and it is the natural thing to guess).
 */
export default async function CatalogFeedbackRedirect({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();
  const base = catalogBasePath((await getTenantContext())?.source ?? null, tenant);
  redirect(`${base}/inbox?tab=feedback`);
}
