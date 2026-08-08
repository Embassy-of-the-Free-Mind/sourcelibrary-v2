import { notFound, redirect } from 'next/navigation';
import { getTenantContext } from '@/lib/tenant-context';
import { catalogBasePath } from '@/lib/catalog-nav';

/**
 * The queue page is called Review, not Inbox: "inbox" suggests reading, and
 * what happens here is deciding. This URL existed briefly and is kept as a
 * redirect so any bookmark or link from that window still lands.
 */
export default async function CatalogInboxRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tenant } = await params;
  if (tenant !== 'bph') notFound();
  const { tab } = await searchParams;
  const base = catalogBasePath((await getTenantContext())?.source ?? null, tenant);
  redirect(`${base}/review${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`);
}
