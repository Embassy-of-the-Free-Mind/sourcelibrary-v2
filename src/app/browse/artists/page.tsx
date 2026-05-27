import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

export default async function BrowseArtistsIndex() {
  const h = await headers();
  const tenantSlug = h.get('x-tenant-slug');
  redirect(tenantSlug ? `/${tenantSlug}/browse/artists/A` : '/browse/artists/A');
}
