/**
 * The origin an absolute redirect points at (#8374).
 *
 * PRIOR ART: `getRequestBaseUrl()` in src/lib/shortlinks.ts — it builds share
 * URLs from headers on every host, so switching it would change Vercel output;
 * this helper is inert unless SL_PUBLIC_ORIGIN is set.
 *
 * On Vercel, `request.url` in a route handler carries the public host, so
 * `new URL(path, request.url)` is right. Under a plain `next start` it carries
 * the bind address: #8306 measured `/q/<code>` sending readers to
 * `https://localhost:3100/book/…`. Set `SL_PUBLIC_ORIGIN` (e.g.
 * `https://sourcelibrary.org`) on such a host and route handlers build their
 * Location from it instead.
 *
 * The request's own Host is kept when it is the configured host or one of its
 * subdomains, so a redirect on bph.sourcelibrary.org stays on that subdomain
 * (tenant-lockdown.md, invariant 1). Any other Host — a forged one, or an alias
 * domain — gets the configured origin, never itself.
 *
 * Unset (every Vercel deployment), this is exactly `new URL(path, request.url)`.
 */
export function publicUrl(path: string, request: Request): URL {
  const configured = process.env.SL_PUBLIC_ORIGIN;
  if (!configured) return new URL(path, request.url);
  const base = new URL(configured);
  const host = (request.headers.get('x-forwarded-host') || request.headers.get('host') || '')
    .split(',')[0].trim().toLowerCase();
  if (host && isServedHost(host, base.hostname)) base.host = host;
  return new URL(path, base.origin);
}

function isServedHost(host: string, configuredHostname: string): boolean {
  const hostname = host.replace(/:\d+$/, '');
  if (!/^[a-z0-9.-]+$/.test(hostname)) return false;
  return hostname === configuredHostname || hostname.endsWith(`.${configuredHostname}`);
}
