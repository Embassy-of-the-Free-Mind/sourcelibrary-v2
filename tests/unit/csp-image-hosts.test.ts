import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';
import { CSP_IMG_HOSTS, CSP_IMG_SRC, isBrowserRenderableImageUrl } from '@/lib/csp-img-hosts';

/**
 * Guards against a class of silent image breakage discovered in PR #2187:
 * an `<img>` (or Next/Image) pointing at a host that is NOT in the CSP
 * `img-src` allowlist loads fine via curl but is blocked by the browser.
 *
 * Two parallel allowlists live in next.config.ts and must stay consistent:
 *   - `images.remotePatterns` — hosts the Next/Image optimizer will fetch
 *   - CSP `img-src`            — hosts the browser will actually render
 *
 * Every remotePatterns host MUST be covered by img-src; otherwise the
 * optimizer fetches an image the browser then refuses to display. (The
 * reverse is fine: img-src may list plain-<img>/R2/map hosts that Next never
 * optimizes.) We also pin the specific regression: Wikimedia images must use
 * the whitelisted `upload.wikimedia.org` CDN, never `commons.wikimedia.org`.
 */

const PROJECT_ROOT = path.resolve(__dirname, '../..');
const NEXT_CONFIG = readFileSync(path.join(PROJECT_ROOT, 'next.config.ts'), 'utf8');

/** Normalize Next's `**.x` and CSP's `*.x` wildcards to a `.x` suffix marker. */
function toMatcher(host: string): { wildcard: boolean; value: string } {
  const stripped = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (stripped.startsWith('**.')) return { wildcard: true, value: stripped.slice(2) }; // "**.loc.gov" -> ".loc.gov"
  if (stripped.startsWith('*.')) return { wildcard: true, value: stripped.slice(1) };  // "*.loc.gov"  -> ".loc.gov"
  return { wildcard: false, value: stripped };
}

/**
 * The CSP img-src host tokens. Since PR (2026-08) the directive is BUILT from
 * `src/lib/csp-img-hosts.ts` (shared with getBookThumbnailUrl's renderability
 * screen), so the module IS the directive — but keep one assertion that
 * next.config.ts actually consumes it, or this whole suite silently guards a
 * list the config no longer reads.
 */
function parseImgSrcHosts(): string[] {
  return CSP_IMG_HOSTS.map((t) => t.replace(/^https:\/\//, ''));
}

/** Extract every hostname from `images.remotePatterns`. */
function parseRemotePatternHosts(): string[] {
  return [...NEXT_CONFIG.matchAll(/hostname:\s*'([^']+)'/g)].map((m) => m[1]);
}

/** Does `host` (possibly a wildcard) match any allowlisted img-src token? */
function isCovered(host: string, allowlist: ReturnType<typeof toMatcher>[]): boolean {
  const h = toMatcher(host);
  return allowlist.some((a) => {
    if (a.wildcard) {
      // ".loc.gov" covers "babel.loc.gov" and a "**.loc.gov" remote pattern.
      return h.value === a.value.slice(1) || h.value.endsWith(a.value);
    }
    return !h.wildcard && h.value === a.value;
  });
}

describe('CSP img-src / Next image allowlist consistency', () => {
  const imgSrc = parseImgSrcHosts().map(toMatcher);
  const remoteHosts = parseRemotePatternHosts();

  it('finds both allowlists', () => {
    expect(imgSrc.length).toBeGreaterThan(5);
    expect(remoteHosts.length).toBeGreaterThan(5);
  });

  it('next.config.ts builds its img-src from the shared module', () => {
    expect(NEXT_CONFIG).toContain("from './src/lib/csp-img-hosts'");
    expect(NEXT_CONFIG).toContain('CSP_IMG_SRC,');
  });

  it.each(remoteHosts)('remotePatterns host %s is allowed by CSP img-src', (host) => {
    expect(
      isCovered(host, imgSrc),
      `images.remotePatterns lists "${host}" but it is not covered by CSP img-src in next.config.ts. ` +
        `Next/Image will optimize it but the browser will block it. Add it to the img-src directive.`,
    ).toBe(true);
  });
});

describe('Wikimedia image host regression (PR #2187)', () => {
  it('CSP img-src whitelists upload.wikimedia.org, not commons.wikimedia.org', () => {
    expect(CSP_IMG_SRC).toContain('upload.wikimedia.org');
    expect(CSP_IMG_SRC).not.toContain('commons.wikimedia.org');
  });

  it('no source file builds a commons.wikimedia.org image URL', () => {
    const offenders: string[] = [];
    const SRC = path.join(PROJECT_ROOT, 'src');
    // Match the URL only when it begins a string literal (quote or backtick) —
    // i.e. a *constructed* image URL, not a prose mention in a comment.
    // commons.wikimedia.org is fine in an API *query* (imageinfo); the bug was
    // emitting commons.wikimedia.org/w/thumb.php as a rendered image src.
    const BUILDER = /['"`]https:\/\/commons\.wikimedia\.org\/w\/thumb\.php/;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry)) {
          if (BUILDER.test(readFileSync(full, 'utf8'))) {
            offenders.push(path.relative(PROJECT_ROOT, full));
          }
        }
      }
    };
    walk(SRC);
    expect(
      offenders,
      `These files build a CSP-blocked commons.wikimedia.org/w/thumb.php image URL. ` +
        `Resolve Wikimedia images to upload.wikimedia.org instead (see src/lib/wikidata-enrichment.ts):\n` +
        offenders.join('\n'),
    ).toEqual([]);
  });
});

describe('isBrowserRenderableImageUrl', () => {
  it('accepts hosts on the CSP allowlist', () => {
    expect(isBrowserRenderableImageUrl('https://images.sourcelibrary.org/pages/abc/0001.jpg')).toBe(true);
    expect(isBrowserRenderableImageUrl('https://iiif.archive.org/iiif/x/full/full/0/default.jpg')).toBe(true);
    expect(isBrowserRenderableImageUrl('https://upload.wikimedia.org/wikipedia/commons/a/ab/x.jpg')).toBe(true);
    // Hosts added 2026-08-04 (they held live covers but were CSP-blocked)
    expect(isBrowserRenderableImageUrl('https://mps.lib.harvard.edu/sds/view/1.jpg')).toBe(true);
    expect(isBrowserRenderableImageUrl('https://digital.slub-dresden.de/data/x.jpg')).toBe(true);
  });

  it('matches wildcards on a dot boundary only (no suffix spoofing)', () => {
    expect(isBrowserRenderableImageUrl('https://iiif.bodleian.ox.ac.uk/iiif/x.jpg')).toBe(true);
    expect(isBrowserRenderableImageUrl('https://pub-123.r2.dev/x.jpg')).toBe(true);
    expect(isBrowserRenderableImageUrl('https://evil-r2.dev/x.jpg')).toBe(false);
    expect(isBrowserRenderableImageUrl('https://notamazonaws.com/x.jpg')).toBe(false);
  });

  it('rejects archive.org/download/ — allowlisted host, but it 302s to un-allowlisted ia*.us.archive.org', () => {
    expect(isBrowserRenderableImageUrl('https://archive.org/download/some_item/page/n0/full/pct:15/0/default.jpg')).toBe(false);
    // Other archive.org paths do not redirect off-host
    expect(isBrowserRenderableImageUrl('https://archive.org/services/img/some_item')).toBe(true);
  });

  it('rejects non-https, unknown hosts, junk, and empties', () => {
    expect(isBrowserRenderableImageUrl('http://images.sourcelibrary.org/x.jpg')).toBe(false);
    expect(isBrowserRenderableImageUrl('https://example.com/x.jpg')).toBe(false);
    expect(isBrowserRenderableImageUrl('not a url')).toBe(false);
    expect(isBrowserRenderableImageUrl('')).toBe(false);
    expect(isBrowserRenderableImageUrl(null)).toBe(false);
    expect(isBrowserRenderableImageUrl(undefined)).toBe(false);
  });

  it('tolerates stray whitespace around stored URLs', () => {
    expect(isBrowserRenderableImageUrl(' https://images.sourcelibrary.org/x.jpg\n')).toBe(true);
  });
});

describe('CSP_IMG_SRC', () => {
  it('is a complete img-src directive built from the host list', () => {
    expect(CSP_IMG_SRC.startsWith("img-src 'self' data: blob: ")).toBe(true);
    for (const host of CSP_IMG_HOSTS) {
      expect(CSP_IMG_SRC).toContain(host);
    }
  });
});
