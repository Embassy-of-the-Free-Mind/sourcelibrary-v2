/**
 * Sister sites whose readers file feedback into this library's inbox.
 *
 * The Nature Library (thenaturelibrary.org, a separate repo and Vercel project)
 * has no database of its own; its feedback widget posts straight to
 * `/api/feedback` from the visitor's browser, so a sister-site message lands in
 * the same queue, with the same rate limit keyed on the visitor's own address,
 * as one written here.
 *
 * Write routes otherwise keep the browser's same-origin default (see the CORS
 * note in next.config.ts), so this list is the whole of the exception: an exact
 * origin match, no wildcards, and only for the routes that call it.
 */
const SISTER_SITES: Record<string, string> = {
  'https://thenaturelibrary.org': 'thenaturelibrary.org',
  'https://www.thenaturelibrary.org': 'thenaturelibrary.org',
  'https://nature-library.vercel.app': 'thenaturelibrary.org',
};

/** The sister site a request's Origin header names, or null for anything else. */
export function sisterSite(request: Request): { origin: string; site: string } | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  const site = SISTER_SITES[origin.toLowerCase()];
  return site ? { origin, site } : null;
}

/** CORS headers for a sister-site origin; empty for any other caller. */
export function sisterCorsHeaders(request: Request): Record<string, string> {
  const sister = sisterSite(request);
  if (!sister) return {};
  return {
    'Access-Control-Allow-Origin': sister.origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
