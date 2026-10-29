/**
 * Requests to other institutions' servers (libraries, archives, catalogues) say who we
 * are. A library that sees unusual traffic should be able to tell it is Source Library
 * and write to us, rather than block an anonymous script (#7771).
 *
 * PRIOR ART: scripts/lib/iiif-utils.mjs `rateLimitedFetch` sends the same identity and
 * rate-limits per host, but it is a Node script helper that returns a Buffer and is not
 * importable from the app. The import routes made one-book requests with no
 * User-Agent at all, so Node's default went out. This is the app-side twin for
 * identity only; per-host rate limiting stays in the script helper, where bulk runs.
 */

/** The one identity Source Library presents to other servers. Contact decided by Derek, 2026-10-29. */
export const SOURCE_LIBRARY_USER_AGENT = 'SourceLibrary/1.0 (https://sourcelibrary.org; derek@sourcelibrary.org)';

/**
 * `fetch` for a URL on someone else's server. It always sends SOURCE_LIBRARY_USER_AGENT,
 * replacing any User-Agent the caller set, so every request carries the same identity.
 * Calls to our own `/api/...` routes keep plain `fetch`.
 */
export function outboundFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('User-Agent', SOURCE_LIBRARY_USER_AGENT);
  return fetch(input, { ...init, headers });
}
