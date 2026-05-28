import type { Filter } from 'mongodb';
import type { TenantContext } from './tenant-context';

/**
 * Constrain a Mongo query to the active tenant.
 *
 * Tenants act like RLS: a filter overlay on a global library, not a fork of
 * the route tree. Replaces the ~160 scattered `if (tenantId) query.tenantId = …`
 * blocks across API routes — every query site uses this single helper so the
 * "is this tenant-scoped?" decision lives in one place.
 *
 * A null/empty context yields the global query unchanged.
 */
export function applyTenantFilter<T extends Record<string, unknown>>(
  filter: Filter<T>,
  ctx: TenantContext | null,
): Filter<T> {
  if (!ctx?.id) return filter;
  return { ...filter, tenantId: ctx.id } as Filter<T>;
}
