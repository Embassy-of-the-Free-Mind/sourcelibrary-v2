import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath } from '@/lib/catalog-nav';

/**
 * Feedback is a tab of Review, alongside proposed edits and the board, so
 * librarians have one place for "things needing me".
 *
 * Kept as a redirect because this URL has been handed out — the toolbar linked
 * it, and it is the natural thing to guess.
 */
export default async function CatalogFeedbackRedirect({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();
  const base = catalogBasePath((await getTenantContext())?.source ?? null, tenant);
  redirect(`${base}/review?tab=feedback`);
}
