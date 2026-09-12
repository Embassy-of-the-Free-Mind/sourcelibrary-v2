/**
 * Host policy for the server-side image proxy (`/api/image`).
 *
 * `/api/image?url=…` performs a server-side fetch of a caller-supplied URL, so
 * the allowlist here is the only thing standing between a stranger and our
 * outbound network. Two rules, both learned the hard way:
 *
 *  1. Match on a DOT BOUNDARY, never a bare suffix. The original check was
 *     `hostname.endsWith(host)`, under which `evilarchive.org`, `xr2.dev` and
 *     `notamazonaws.com` all passed — an attacker only had to register a
 *     domain that ends in one of our allowlisted strings to make us fetch
 *     anything they liked.
 *  2. Re-validate on EVERY redirect hop. axios follows up to 5 redirects by
 *     default with no further checks, so an allowlisted (or attacker-glued)
 *     host could 302 us straight at a private address.
 *
 * Same shape as the OIDC redirect check in
 * `src/app/api/auth/oidc/authorize/route.ts`, which already did this correctly.
 */

/**
 * Domains we will fetch images from. An entry matches the host itself and any
 * subdomain of it — `archive.org` matches `archive.org` and `ia1.us.archive.org`,
 * but never `evilarchive.org`.
 */
export const ALLOWED_IMAGE_HOSTS = [
  'amazonaws.com',
  'archive.org',
  'vercel-storage.com',
  'r2.dev',                          // Cloudflare R2 (public bucket)
  'images.sourcelibrary.org',        // Cloudflare R2 (custom domain)
  // Museum / open-access sources
  'upload.wikimedia.org',            // Wikimedia Commons (public domain images)
  'images.metmuseum.org',            // The Metropolitan Museum of Art
  'openaccess-cdn.clevelandart.org', // Cleveland Museum of Art
  // IIIF sources
  'gallica.bnf.fr',
  'api.digitale-sammlungen.de',      // MDZ/BSB
  'digi.vatlib.it',                  // Vatican
  'digital.bodleian.ox.ac.uk',       // Bodleian
  'iiif.bodleian.ox.ac.uk',
  'digital.archives.go.jp',          // National Archives of Japan
  'contentdm.oclc.org',              // ContentDM (Laurenziana, etc.)
  'uvaerfgoed.nl',                   // UVA heritage collections
  'rijksmuseum.nl',                  // Rijksmuseum
  'dl.ndl.go.jp',                    // National Diet Library Japan
  'e-rara.ch',                       // Swiss libraries
  'media.getty.edu',                 // Getty (Florentine Codex)
  'cdli.earth',                      // CDLI tablet photos (witness images, #4350 —
                                     // the originals run to ~24MB, so the reader
                                     // shows them through the resizer)
] as const;

/** IPv4 literal, or null if the string is not one. */
function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.every(n => n >= 0 && n <= 255) ? parts : null;
}

/**
 * True for addresses that must never be reachable through the proxy: loopback,
 * RFC1918 private space, link-local (which is where cloud instance-metadata
 * services live), carrier-grade NAT, and the IPv6 equivalents.
 *
 * Checked in addition to the allowlist, not instead of it — a hostname that
 * resolves to a private address still fails the allowlist first. This is the
 * belt to that suspenders, and it is what catches a redirect hop.
 */
export function isForbiddenAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) {
    return true;
  }

  // IPv6 loopback / link-local / unique-local
  if (h === '::' || h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
    return true;
  }
  // IPv4-mapped IPv6, e.g. ::ffff:169.254.169.254
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(h);
  if (mapped) return isForbiddenAddress(mapped[1]);

  const ip = parseIPv4(h);
  if (!ip) return false;
  const [a, b] = ip;
  if (a === 0 || a === 127) return true;               // this-network, loopback
  if (a === 10) return true;                            // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true;     // RFC1918
  if (a === 192 && b === 168) return true;              // RFC1918
  if (a === 169 && b === 254) return true;              // link-local — cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;    // CGNAT
  if (a >= 224) return true;                            // multicast / reserved
  return false;
}

/**
 * True if we are willing to fetch from this hostname.
 *
 * Exact match, or a subdomain separated by a real dot. `archive.org` matches
 * `archive.org` and `ia1.us.archive.org`; it does NOT match `evilarchive.org`.
 */
export function isAllowedImageHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/\.$/, ''); // strip trailing root dot
  if (!h || isForbiddenAddress(h)) return false;
  return ALLOWED_IMAGE_HOSTS.some(allowed => h === allowed || h.endsWith('.' + allowed));
}

/**
 * Validate a candidate URL for server-side fetching. Returns the reason for
 * refusal, or null when the URL is acceptable.
 *
 * Used both for the caller-supplied `url` and for every redirect `Location`.
 */
export function refuseImageUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'malformed URL';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    return `unsupported protocol ${u.protocol}`;
  }
  if (!isAllowedImageHost(u.hostname)) {
    return 'host not allowed';
  }
  return null;
}
