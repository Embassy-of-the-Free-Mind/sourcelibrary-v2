/**
 * Purge exact URLs from the Cloudflare edge cache, for scripts (#8277).
 *
 * PRIOR ART: src/lib/cloudflare-cache.ts (purgeCloudflareUrls) — same API and the same 30-URL
 * batch, but it is TypeScript for the app, prefixes bare paths with sourcelibrary.org, and
 * only warns on failure. Scripts that just rewrote a book's images need the opposite: refuse
 * to start without credentials, read every response, and report how many URLs were purged.
 * Several maintenance scripts inline the same loop (shift-repairs-5803-driver.mjs,
 * cleanup-orphan-gallery-images.mjs); this is the shared copy for new callers.
 *
 * Never purge_everything: that empties the whole site's cache.
 */

const BATCH = 30; // Cloudflare's per-request limit for `files`

/** Throws unless the purge credentials are present. Call before any write. */
export function assertPurgeCredentials() {
  const missing = ['CLOUDFLARE_ZONE_ID', 'CLOUDFLARE_API_TOKEN'].filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(
      `Cloudflare purge credentials missing (${missing.join(', ')}). ` +
      'Run from a checkout whose env holds a purge-capable CLOUDFLARE_API_TOKEN (the laptop .env.production.local does; ' +
      'main\'s holds only CLOUDFLARE_API_TOKEN_READ), or pass --no-purge and purge by hand.',
    );
  }
}

/**
 * Purge each URL by exact match. Returns { requested, purged, failed, errors }.
 * A batch counts as purged only when Cloudflare answers success: true.
 */
export async function purgeUrls(urls) {
  assertPurgeCredentials();
  const list = [...new Set(urls.filter(Boolean))];
  const out = { requested: list.length, purged: 0, failed: 0, errors: [] };
  for (let i = 0; i < list.length; i += BATCH) {
    const files = list.slice(i, i + BATCH);
    try {
      const r = await fetch(`https://api.cloudflare.com/client/v4/zones/${process.env.CLOUDFLARE_ZONE_ID}/purge_cache`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.success === true) out.purged += files.length;
      else { out.failed += files.length; out.errors.push(`HTTP ${r.status} ${JSON.stringify(j.errors || '').slice(0, 160)}`); }
    } catch (e) {
      out.failed += files.length;
      out.errors.push(e.message);
    }
  }
  return out;
}
