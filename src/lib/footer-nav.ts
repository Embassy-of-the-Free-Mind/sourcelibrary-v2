import { isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';
import { type FooterStrings } from '@/lib/i18n';

/**
 * The global footer's navigation table, and the tenant filter applied to it.
 *
 * Lives outside the component so the filter is directly testable — the repo has
 * no DOM test harness, and a test that only greps `GlobalFooter.tsx` for a
 * string would catch deletion but never wrongness (see CLAUDE.md, "A test that
 * greps source is not a guard").
 *
 * Labels are resolved per-locale from FOOTER_STRINGS via `key`; hrefs are
 * constant and point at the English pages (deep pages have no `/es` route).
 */

export type FooterLinkKey = Exclude<keyof FooterStrings, 'colLibrary' | 'colAbout' | 'colParticipate'>;

export type FooterNavColumn = {
  titleKey: keyof FooterStrings;
  links: ReadonlyArray<{ key: FooterLinkKey; href: string }>;
};

export const FOOTER_NAV_COLUMNS: ReadonlyArray<FooterNavColumn> = [
  {
    titleKey: 'colLibrary',
    links: [
      { key: 'browseBooks', href: '/' },
      { key: 'browseAZ', href: '/browse' },
      { key: 'gallery', href: '/gallery' },
      { key: 'identify', href: '/identify' },
      { key: 'collections', href: '/collections' },
      { key: 'search', href: '/search' },
      { key: 'podcast', href: '/podcast' },
    ],
  },
  {
    titleKey: 'colAbout',
    links: [
      { key: 'about', href: '/about' },
      { key: 'vision', href: '/vision' },
      { key: 'census', href: '/census' },
      { key: 'progress', href: '/about/progress' },
      { key: 'research', href: '/research' },
      { key: 'researchNotes', href: '/blog' },
      { key: 'privacy', href: '/privacy' },
      { key: 'cookieSettings', href: '#cookie-settings' },
      { key: 'terms', href: '/terms' },
      { key: 'copyright', href: '/dmca' },
    ],
  },
  {
    titleKey: 'colParticipate',
    links: [
      { key: 'libraries', href: '/libraries' },
      { key: 'contribute', href: '/contribute' },
      { key: 'checkPages', href: '/review' },
      { key: 'support', href: '/support' },
      { key: 'sponsorship', href: '/sponsors' },
      { key: 'developers', href: '/developers' },
    ],
  },
];

/**
 * Drop links the proxy 404s on a partner subdomain, and any column that empties
 * as a result. On the global site (`isTenantHost === false`) the table is
 * returned unchanged.
 *
 * The blocked list is `GLOBAL_ONLY_TENANT_PAGE_PATHS` — one list, so the proxy
 * block and the site nav can never disagree (#3364, #3370). SiteHeader has
 * filtered on it since #3364; the footer did not, so bph.sourcelibrary.org
 * served ten links that every one returned 404.
 */
export function visibleFooterNavColumns(isTenantHost: boolean): FooterNavColumn[] {
  if (!isTenantHost) return [...FOOTER_NAV_COLUMNS];
  return FOOTER_NAV_COLUMNS
    .map(col => ({ ...col, links: col.links.filter(link => !isGlobalOnlyNavHref(link.href)) }))
    .filter(col => col.links.length > 0);
}
