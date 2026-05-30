import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

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

/** Extract the host tokens from the CSP `img-src` directive. */
function parseImgSrcHosts(): string[] {
  const m = NEXT_CONFIG.match(/"img-src ([^"]+)"/);
  if (!m) throw new Error('Could not find CSP img-src directive in next.config.ts');
  return m[1]
    .split(/\s+/)
    .filter((t) => t.startsWith('https://'))
    .map((t) => t.replace(/^https:\/\//, ''));
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

  it('finds both allowlists in next.config.ts', () => {
    expect(imgSrc.length).toBeGreaterThan(5);
    expect(remoteHosts.length).toBeGreaterThan(5);
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
    const imgSrcLine = NEXT_CONFIG.match(/"img-src ([^"]+)"/)![1];
    expect(imgSrcLine).toContain('upload.wikimedia.org');
    expect(imgSrcLine).not.toContain('commons.wikimedia.org');
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
