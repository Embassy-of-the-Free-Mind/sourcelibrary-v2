import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';

export interface TenantContext {
  slug: string | null;
  id: string | null;
}

/**
 * Read the tenant ID injected by the proxy middleware.
 * Throws if the request was not routed through a tenant path.
 */
export async function getTenantId(): Promise<string> {
  const h = await headers();
  const id = h.get('x-tenant-id');
  if (!id) throw new Error('No tenant context — request not routed through a tenant path');
  return id;
}

/**
 * Read the tenant slug injected by the proxy middleware.
 * Throws if the request was not routed through a tenant path.
 */
export async function getTenantSlug(): Promise<string> {
  const h = await headers();
  const slug = h.get('x-tenant-slug');
  if (!slug) throw new Error('No tenant slug in headers');
  return slug;
}

/**
 * Read proxy-injected tenant headers from a route handler request.
 * Returns null values when request is not tenant-scoped.
 */
export function getTenantContextFromRequest(request: NextRequest): TenantContext {
  return {
    slug: request.headers.get('x-tenant-slug'),
    id: request.headers.get('x-tenant-id'),
  };
}

/**
 * Resolve a tenant slug → UUID, using KV cache (5 min TTL) with DB fallback.
 * Returns null if no active/suspended tenant exists for the slug.
 * Used in API routes and server actions that receive a slug param but run
 * outside the [tenant] layout (e.g. /api/platform/tenants/[slug]/invite).
 */
export async function resolveTenantId(slug: string): Promise<string | null> {
  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({
    slug,
    status: { $ne: 'deleted' },
  });
  return tenant ? (tenant.id as string) : null;
}
