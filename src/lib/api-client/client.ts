import axios, { AxiosError, AxiosInstance } from 'axios';
import { PREFIXED_LOCALES } from '@/lib/locale-path';

import { TENANT_ROOT_PATHS } from '@/lib/tenant-roots';

/**
 * Resolve the tenant slug that owns `pathname`, or null when the URL is a
 * global (corpus-wide) route.
 *
 * Segment 0 is shared by three namespaces — tenants (`/bph/…`), locale
 * prefixes (`/es/…`) and every global route root (`/book/…`, `/gallery/…`,
 * `/encyclopedia/…`) — so the order of the checks below is the whole design:
 *
 *   1. strip a locale prefix: it decorates a global route, it never owns one
 *   2. `/embed/<tenant>/…`: the slug sits in a RESERVED position, so anything
 *      well-formed there is a tenant claim (the server resolves it against the
 *      `tenants` collection and 404s an unknown one) — no global route can
 *      collide with it
 *   3. a bare first segment is a tenant ONLY if it is on TENANT_ROOT_PATHS,
 *      the same allowlist the proxy gates on
 *
 * Step 3 used to be a denylist of global route roots, which is the wrong
 * shape: it has to name every route that has ever been added, and it was 39
 * entries short — `/es`, `/encyclopedia`, `/upload`, `/qa`, `/give` and the
 * rest all read as tenants, so client calls from those pages went to
 * `/api/<route>/…` and 404'd. See `@/lib/tenant-roots`.
 */
export function getTenantSlugFromPathname(pathname: string): string | null {
  const segments = pathname.split('/').filter(Boolean);

  if (segments[0] && (PREFIXED_LOCALES as string[]).includes(segments[0])) {
    segments.shift();
  }

  if (segments[0] === 'embed' && segments[1]) {
    return /^[a-z0-9-]+$/.test(segments[1]) ? segments[1] : null;
  }

  const slug = segments[0] || '';
  return TENANT_ROOT_PATHS.has(slug) ? slug : null;
}

// Browser-only wrapper. Returns the tenant slug for the current page, or ''
// for SSR or non-tenant root routes (`/book/...`, `/gallery/...`, etc).
// Used by sibling api-client modules to build tenant-scoped URLs.
export function getTenantSlug(): string {
  if (typeof window === 'undefined') return '';
  return getTenantSlugFromPathname(window.location.pathname) ?? '';
}

// Create axios instance with defaults
export const apiClient: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 30000, // 30 second timeout
});

// Request interceptor - add headers automatically
// TODO: Robust system for setting headers based on auth state, tenant, etc.
apiClient.interceptors.request.use(
  (config) => {
    // Collapse `/api//foo` to `/api/foo`. Callers that interpolate an empty
    // tenant slug (e.g. `/api/${tenant}/pages/...` on the global main domain)
    // would otherwise force a 308 redirect on every request.
    if (config.url) {
      config.url = config.url.replace(/^(\/api)\/+/, '$1/');
    }

    // Add auth token if available
    const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    // Add visitor ID for anonymous tracking
    const visitorId = typeof window !== 'undefined' ? localStorage.getItem('visitor_id') : null;
    if (visitorId) {
      config.headers['X-Visitor-ID'] = visitorId;
    }

    // Add tenant slug from current page URL (e.g. /bph/search → 'bph').
    // Skip known global root segments like /search, /gallery, etc.
    if (typeof window !== 'undefined') {
      const slug = getTenantSlugFromPathname(window.location.pathname);
      if (slug) {
        config.headers['X-Tenant-Slug'] = slug;
      }
    }

    // If data is FormData, remove Content-Type header to let browser set it with boundary
    if (config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - handle errors automatically
apiClient.interceptors.response.use(
  (response) => response.data, // Auto-unwrap data (response.data.data becomes response.data)
  (error: AxiosError) => {
    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      // TODO: Add auth redirect or token refresh logic
      console.error('Unauthorized - redirect to login');
      // window.location.href = '/auth/login';
    }

    // Handle 403 Forbidden
    if (error.response?.status === 403) {
      throw new Error('You do not have permission to perform this action');
    }

    // Extract error message from response
    const message = (error.response?.data as any)?.error || error.message || 'Request failed';
    throw new Error(message);
  }
);

/**
 * Streaming request helper that applies interceptor logic
 * Use this for Server-Sent Events (SSE) or streaming responses
 */
export async function streamRequest(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // Build headers by applying request interceptor logic
  const headers = new Headers(options.headers);

  // Add auth token if available
  const token = typeof window !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  // Add visitor ID for anonymous tracking
  const visitorId = typeof window !== 'undefined' ? localStorage.getItem('visitor_id') : null;
  if (visitorId) {
    headers.set('X-Visitor-ID', visitorId);
  }

  // Add tenant slug from current page URL (tenant routes only)
  if (typeof window !== 'undefined') {
    const slug = getTenantSlugFromPathname(window.location.pathname);
    if (slug) {
      headers.set('X-Tenant-Slug', slug);
    }
  }

  // Make the streaming request
  const response = await fetch(url, {
    ...options,
    headers,
  });

  // Apply error handling (similar to response interceptor)
  if (!response.ok) {
    if (response.status === 401) {
      console.error('Unauthorized - redirect to login');
      // window.location.href = '/auth/login';
    }

    if (response.status === 403) {
      throw new Error('You do not have permission to perform this action');
    }

    // Try to extract error message from response
    let message = 'Request failed';
    try {
      const errorData = await response.json();
      message = errorData.error || message;
    } catch {
      message = response.statusText || message;
    }

    throw new Error(message);
  }

  return response;
}
