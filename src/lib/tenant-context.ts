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
  const { headers } = await import('next/headers');
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
  const { headers } = await import('next/headers');
  const h = await headers();
  const slug = h.get('x-tenant-slug');
  if (!slug) throw new Error('No tenant slug in headers');
  return slug;
}

/**
 * Read proxy-injected tenant headers from a request-like object.
 * Accepts either a NextRequest (for route handlers) or Headers object (for Server Components).
 * Returns null values when request is not tenant-scoped.
 * 
 * Falls back to x-tenant-slug header from API client interceptor (browser sends it).
 */
export function getTenantContextFromRequest(
  requestOrHeaders: NextRequest | Headers
): TenantContext {
  // Handle both NextRequest and Headers objects
  // Check for .headers property (NextRequest) vs direct .get method (Headers from next/headers)
  let headersObj: any;
  
  if (requestOrHeaders && typeof requestOrHeaders === 'object') {
    // If it has a .headers property with a .get method, it's likely a NextRequest
    if ('headers' in requestOrHeaders && requestOrHeaders.headers && typeof requestOrHeaders.headers.get === 'function') {
      headersObj = requestOrHeaders.headers;
    } 
    // If it directly has a .get method, it's a Headers object
    else if ('get' in requestOrHeaders && typeof requestOrHeaders.get === 'function') {
      headersObj = requestOrHeaders;
    }
  }

  if (typeof headersObj?.get !== 'function') {
    // Return empty context if headers are invalid (e.g. from test mocks)
    return { slug: null, id: null };
  }

  const slug = headersObj.get('x-tenant-slug');
  const id = headersObj.get('x-tenant-id');
  
  return { slug, id };
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
