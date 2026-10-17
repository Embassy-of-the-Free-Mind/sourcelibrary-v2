import { permanentRedirect } from 'next/navigation';

/**
 * The catalogue moved to /library. Every old link, bookmark and search URL
 * keeps working: the query string comes along.
 *
 * Done here rather than in next.config `redirects`: config redirects run
 * before the proxy, and on a partner subdomain the proxy rewrites /catalog to
 * that partner's own catalogue (tenant-lockdown.md). This page is only
 * reached on the main site, so only the main site is redirected. No
 * loading.tsx sits above it, so this is a real 308, not a meta refresh
 * (rendering-and-seo.md).
 */
export default async function CatalogMoved({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) for (const one of [v].flat()) if (one != null) sp.append(k, one);
  const qs = sp.toString();
  permanentRedirect(qs ? `/library?${qs}` : '/library');
}
