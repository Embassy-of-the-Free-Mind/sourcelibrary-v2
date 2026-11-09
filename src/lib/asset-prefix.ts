/**
 * Where a build's own CSS and JS are served from (#8384, trap 1).
 *
 * PRIOR ART: none — `assetPrefix` was never set in next.config.ts; searched next.config.ts,
 * src/lib and infrastructure/ for assetPrefix / SL_ASSET_PREFIX.
 *
 * Why: on the reader-origin box, a page must load the chunks of the build that rendered
 * it. Under the bare `/_next/static/*` path, the browser would ask sourcelibrary.org,
 * which is Vercel and a different build, and the page would render unstyled (the
 * stale-HTML/dead-CSS incident, deploy-and-caching.md). With `SL_ASSET_PREFIX=/_box` the
 * box's pages reference `/_box/_next/static/*`, which the Worker routes to the box.
 *
 * A same-origin path is the recommended form: the site's CSP allows scripts, styles and
 * fonts from 'self' only, and @font-face needs CORS cross-origin. An absolute
 * `https://host` prefix also works: its origin is then added to script-src, style-src,
 * font-src and connect-src, and that host must send `Access-Control-Allow-Origin`.
 *
 * Unset (every Vercel deployment): no prefix and no CSP change.
 */
export interface AssetPrefix {
  /** The value for next.config `assetPrefix`, or undefined. */
  assetPrefix: string | undefined;
  /** An extra origin for the CSP, when the prefix is absolute; else null. */
  cspOrigin: string | null;
}

export function assetPrefixFromEnv(raw: string | undefined): AssetPrefix {
  const value = (raw ?? '').trim();
  if (!value) return { assetPrefix: undefined, cspOrigin: null };
  if (/^\/[A-Za-z0-9_\-/]*$/.test(value) && !value.startsWith('//')) {
    return { assetPrefix: value.replace(/\/+$/, ''), cspOrigin: null };
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`SL_ASSET_PREFIX must be a /path or an https:// URL, got ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'https:' || url.search || url.hash) {
    throw new Error(`SL_ASSET_PREFIX must be a /path or an https:// URL, got ${JSON.stringify(value)}`);
  }
  return { assetPrefix: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, cspOrigin: url.origin };
}

/** Append the prefix's origin to the CSP directives that load build assets. */
export function withAssetOrigin(directive: string, cspOrigin: string | null): string {
  if (!cspOrigin) return directive;
  return /^(script-src|style-src|font-src|connect-src)\s/.test(directive) ? `${directive} ${cspOrigin}` : directive;
}
