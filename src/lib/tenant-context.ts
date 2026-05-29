import { NextRequest } from 'next/server';
import { getDb } from '@/lib/mongodb';

/**
 * Resolved tenant context for a request.
 *
 * `id` + `slug` come from the `tenants` Mongo collection. `isEmbedded` is true
 * when the request is served under `/embed/*` or via a tenant subdomain
 * rewrite. `source` records which resolution branch fired so debugging
 * cross-tenant leaks isn't a guessing game.
 *
 * A null context means the request is global (no tenant-filter overlay).
 */
export interface TenantContext {
  slug: string | null;
  id: string | null;
  isEmbedded: boolean;
  source: TenantSource | null;
}

export type TenantSource = 'subdomain' | 'path' | 'header' | 'query' | 'api-segment' | 'referer' | 'embed-path';

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
 * Read tenant context for the current Server Component / Route Handler request.
 * Returns null when the request is global (no tenant resolved by middleware).
 *
 * This is the canonical reader — prefer it over the lower-level `getTenantId()`
 * / `getTenantSlug()` helpers and over hand-rolled header reads. The shape
 * carries every field a downstream caller needs to decide UI policy
 * (`isEmbedded`) and apply query filters (`id`).
 */
export async function getTenantContext(): Promise<TenantContext | null> {
  const { headers } = await import('next/headers');
  const h = await headers();
  return readTenantContextFromHeaders(h);
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
    return { slug: null, id: null, isEmbedded: false, source: null };
  }

  return readHeadersObject(headersObj);
}

function readTenantContextFromHeaders(h: Headers): TenantContext | null {
  const ctx = readHeadersObject(h);
  return ctx.id || ctx.slug ? ctx : null;
}

function readHeadersObject(headersObj: { get: (name: string) => string | null }): TenantContext {
  const slug = headersObj.get('x-tenant-slug');
  const id = headersObj.get('x-tenant-id');
  const isEmbedded = headersObj.get('x-tenant-embedded') === '1';
  const source = (headersObj.get('x-tenant-source') as TenantSource | null) ?? null;
  return { slug, id, isEmbedded, source };
}

/**
 * Resolve a tenant slug → UUID, with a 5-minute in-memory cache.
 * Returns null if no active/suspended tenant exists for the slug.
 * Used in API routes and server actions that receive a slug param but run
 * outside the [tenant] layout (e.g. /api/platform/tenants/[slug]/invite).
 *
 * Slug → id mapping is essentially immutable in practice (renames are rare
 * and require migration), so the cache is safe to keep long. Negative
 * results are cached too — a 5-minute window of "no such tenant" is fine
 * because new tenants take longer than that to fully provision.
 */
const TENANT_ID_TTL_MS = 5 * 60_000;
const cachedTenantId = new Map<string, { value: string | null; expiresAt: number }>();

export async function resolveTenantId(slug: string): Promise<string | null> {
  const now = Date.now();
  const hit = cachedTenantId.get(slug);
  if (hit && hit.expiresAt > now) return hit.value;
  const db = await getDb();
  const tenant = await db.collection('tenants').findOne({
    slug,
    status: { $ne: 'deleted' },
  });
  const value = tenant ? (tenant.id as string) : null;
  cachedTenantId.set(slug, { value, expiresAt: now + TENANT_ID_TTL_MS });
  return value;
}
