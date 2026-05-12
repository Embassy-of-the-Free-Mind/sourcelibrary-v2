/**
 * Cloudflare CDN cache purge helper.
 *
 * Purges specific URLs from Cloudflare's edge cache after on-demand revalidation.
 * This ensures Cloudflare serves fresh content after pipeline updates, not a
 * stale cached copy.
 *
 * Tenant-aware: when a path is tenant-scoped (e.g. `/bph/book/foo`), the
 * book is also served from the tenant subdomain (`bph.sourcelibrary.org`)
 * which has a SEPARATE Cloudflare cache entry. We must purge both forms or
 * the subdomain keeps serving stale HTML after backfills.
 *
 * Requires env vars:
 *   CLOUDFLARE_ZONE_ID   — from Cloudflare dashboard (Overview page)
 *   CLOUDFLARE_API_TOKEN  — with Zone.Cache Purge permission only
 *
 * Gracefully no-ops if env vars are missing (safe for local dev).
 */

const APEX = 'https://sourcelibrary.org';

// Tenant slug → public subdomain. Visitors reach tenant routes via the
// subdomain proxy; if we only purge the apex form (`/{tenant}/book/...`),
// the subdomain cache stays stale. Add subdomains here when new tenants
// launch.
const TENANT_SUBDOMAINS: Record<string, string> = {
  bph: 'https://bph.sourcelibrary.org',
};

/**
 * Expand a route path into every public URL that Cloudflare may have
 * cached for it. Always returns the apex form; if the path is tenant-
 * scoped, also returns the subdomain forms (with and without /embed/).
 */
function publicUrlsForPath(path: string): string[] {
  const out: string[] = [`${APEX}${path}`];

  const m = path.match(/^\/(?:embed\/)?([a-z0-9_-]+)(\/.*)?$/i);
  if (m) {
    const tenant = m[1];
    const rest = m[2] || '';
    const subdomain = TENANT_SUBDOMAINS[tenant];
    if (subdomain) {
      out.push(`${subdomain}${rest}`);
      // The subdomain proxy rewrites to /embed/{tenant}/... internally —
      // Vercel/Cloudflare may also have cached that form.
      if (!path.startsWith('/embed/')) {
        out.push(`${subdomain}/embed/${tenant}${rest}`);
      }
    }
  }
  return out;
}

export async function purgeCloudflareUrls(paths: string[]): Promise<void> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token || paths.length === 0) return;

  const urlSet = new Set<string>();
  for (const p of paths) {
    for (const u of publicUrlsForPath(p)) urlSet.add(u);
  }
  const urls = Array.from(urlSet);

  // Cloudflare allows 30 URLs per purge call
  for (let i = 0; i < urls.length; i += 30) {
    const batch = urls.slice(i, i + 30);
    try {
      await fetch(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ files: batch }),
        }
      );
    } catch {
      // Non-fatal — page will expire naturally at TTL
      console.warn(`[cloudflare] Failed to purge ${batch.length} URLs`);
    }
  }
}
