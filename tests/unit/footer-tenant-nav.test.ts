import { describe, it, expect } from 'vitest';
import { FOOTER_NAV_COLUMNS, visibleFooterNavColumns } from '@/lib/footer-nav';
import { GLOBAL_ONLY_TENANT_PAGE_PATHS, isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';

/**
 * The global footer must not link to a path the proxy 404s on a tenant host.
 *
 * CLAUDE.md states the rule as one list, "so the proxy block and the site nav
 * can never disagree — the nav must not link to a path the proxy 404s."
 * SiteHeader has honored it since #3364. GlobalFooter never did: measured on
 * bph.sourcelibrary.org, the footer served /about, /about/progress, /vision,
 * /census, /research, /blog, /contribute, /support, /sponsors, /libraries and
 * /explore, and every one of them returned 404.
 *
 * These assertions call the filter rather than grepping the component, so they
 * fail on a wrong filter, not only on a deleted one.
 */

const hrefsOf = (cols: ReadonlyArray<{ links: ReadonlyArray<{ href: string }> }>) =>
  cols.flatMap(c => c.links.map(l => l.href));

describe('GlobalFooter tenant nav', () => {
  it('serves no global-only link on a tenant host', () => {
    const offenders = hrefsOf(visibleFooterNavColumns(true)).filter(isGlobalOnlyNavHref);
    expect(offenders, `footer links 404 on a partner subdomain: ${offenders.join(', ')}`).toEqual([]);
  });

  it('is unchanged on the global site', () => {
    expect(hrefsOf(visibleFooterNavColumns(false))).toEqual(hrefsOf(FOOTER_NAV_COLUMNS));
  });

  it('still offers navigation on a tenant host', () => {
    // Filtering must not empty the footer — the reading room keeps its own
    // library links plus the legal/rights notices that stay reachable there.
    const kept = hrefsOf(visibleFooterNavColumns(true));
    expect(kept).toContain('/collections');
    expect(kept).toContain('/gallery');
    expect(kept).toContain('/terms');
    expect(kept).toContain('/privacy');
    expect(visibleFooterNavColumns(true).length).toBeGreaterThan(0);
  });

  it('drops no column to an empty heading', () => {
    for (const col of visibleFooterNavColumns(true)) {
      expect(col.links.length, `${col.titleKey} rendered with no links`).toBeGreaterThan(0);
    }
  });

  it('negative control: the unfiltered table really does contain blocked paths', () => {
    // If this ever passes trivially, the test above proves nothing — the fix
    // would be verified against a table that had no offenders to begin with.
    const blocked = hrefsOf(FOOTER_NAV_COLUMNS).filter(isGlobalOnlyNavHref);
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked).toContain('/about');
  });

  it('tracks the shared list, not a private copy', () => {
    // A new entry in GLOBAL_ONLY_TENANT_PAGE_PATHS must take effect in the
    // footer automatically; nothing here may hardcode its own block list.
    for (const p of GLOBAL_ONLY_TENANT_PAGE_PATHS) {
      expect(hrefsOf(visibleFooterNavColumns(true))).not.toContain(p);
    }
  });
});
