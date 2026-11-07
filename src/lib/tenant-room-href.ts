/**
 * Links a server-rendered catalogue page writes for a partner's reading room.
 *
 * PRIOR ART: src/lib/EmbedContext.tsx useEmbedHref() is the same rule for client components (it
 * reads the browser path, which a server component cannot); src/lib/tenant-signin-url.ts holds the
 * host test used here. A server page cannot read the browser path at all: the proxy rewrites
 * bph.sourcelibrary.org/catalog/X to /embed/bph/catalog/X, so the route params look the same on
 * both surfaces. Only the host tells them apart (tenant-lockdown.md).
 *
 * On a subdomain `/catalog` is the room. On sourcelibrary.org it is the GLOBAL catalogue, so inside
 * the Embassy's iframe a bare `/catalog` left the room and hit X-Frame-Options: DENY (#8047).
 */
import { headers } from 'next/headers';
import { isTenantSubdomain } from '@/lib/tenant-signin-url';

export function tenantRoomPrefix(tenant: string, host: string): string {
  return isTenantSubdomain(host) ? '' : `/embed/${tenant}`;
}

/** `room('/catalog')` for the visitor's own surface. */
export async function getRoomHref(tenant: string): Promise<(path: string) => string> {
  const requestHeaders = await headers();
  const prefix = tenantRoomPrefix(tenant, requestHeaders.get('host') || '');
  return (path: string) => `${prefix}${path}`;
}
