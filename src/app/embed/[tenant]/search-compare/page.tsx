import SearchCompareClient from './SearchCompareClient';

// Internal librarian tool: compare the current search ranking ("ladder") against
// the new Reciprocal Rank Fusion ranking, side by side, and record which the
// librarian prefers. Lives under the tenant embed tree so it scopes to the
// tenant's corpus (bph) and works on a preview deploy via the [tenant] path
// segment. Tenant purity is enforced server-side in compareSearch().
export default async function SearchComparePage({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  const { tenant } = await params;
  return <SearchCompareClient tenant={tenant} />;
}
