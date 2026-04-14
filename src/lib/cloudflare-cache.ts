/**
 * Cloudflare CDN cache purge helper.
 *
 * Purges specific URLs from Cloudflare's edge cache after on-demand revalidation.
 * This ensures Cloudflare serves fresh content after pipeline updates, not a
 * stale cached copy.
 *
 * Requires env vars:
 *   CLOUDFLARE_ZONE_ID   — from Cloudflare dashboard (Overview page)
 *   CLOUDFLARE_API_TOKEN  — with Zone.Cache Purge permission only
 *
 * Gracefully no-ops if env vars are missing (safe for local dev).
 */

const BASE_URL = 'https://sourcelibrary.org';

export async function purgeCloudflareUrls(paths: string[]): Promise<void> {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zoneId || !token || paths.length === 0) return;

  const urls = paths.map(p => `${BASE_URL}${p}`);

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
