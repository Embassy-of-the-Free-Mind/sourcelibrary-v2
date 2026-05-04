import { Db, Document } from 'mongodb';
import { findBookByIdOrSlug, BookLookupResult } from '@/lib/book-lookup';
import { resolveTenantId } from '@/lib/tenant-context';

/**
 * Resolve a tenant slug to tenantId and enforce tenant-scoped book lookup.
 * Returns null when tenant does not exist or the book is not in that tenant.
 */
export async function findTenantBookByIdOrSlug(
  db: Db,
  tenantSlug: string,
  idOrSlug: string,
  projection?: Document
): Promise<BookLookupResult | null> {
  const tenantId = await resolveTenantId(tenantSlug);
  if (!tenantId) return null;
  return findBookByIdOrSlug(db, idOrSlug, projection, tenantId, tenantSlug);
}
