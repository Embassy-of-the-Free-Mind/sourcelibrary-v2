import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function BrowseAuthorsIndex() {
  const h = await headers();
  const tenantSlug = h.get('x-tenant-slug');
  redirect(tenantSlug ? `/${tenantSlug}/browse/authors/A` : '/browse/authors/A');
}
