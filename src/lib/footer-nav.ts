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

export type FooterLinkKey = Exclude<keyof FooterStrings, 'colLibrary' | 'colDiscover' | 'colGetInvolved' | 'colAbout' | 'colLegal'>;

export type FooterNavColumn = {
  titleKey: keyof FooterStrings;
  links: ReadonlyArray<{ key: FooterLinkKey; href: string }>;
};

// Grouped by what a visitor came to do. Give Feedback and Donate are not in
// the table: they are the two buttons in the footer's top bar. The Legal
// column renders as the small-print line at the bottom, not as a column, but
// it lives here so the tenant filter covers it like everything else.
export const FOOTER_NAV_COLUMNS: ReadonlyArray<FooterNavColumn> = [
  {
    titleKey: 'colLibrary',
    links: [
      { key: 'texts', href: '/catalog' },
      { key: 'gallery', href: '/gallery' },
      { key: 'collections', href: '/collections' },
      { key: 'search', href: '/search' },
      { key: 'askLibrarian', href: '/librarian' },
    ],
  },
  {
    titleKey: 'colDiscover',
    links: [
      { key: 'explore', href: '/explore' },
      { key: 'podcast', href: '/podcast' },
      { key: 'researchNotes', href: '/articles' },
      { key: 'identify', href: '/identify' },
      { key: 'forResearchers', href: '/for-researchers' },
    ],
  },
  {
    titleKey: 'colGetInvolved',
    links: [
      { key: 'signUp', href: '/auth/signin' },
      { key: 'contribute', href: '/contribute' },
      { key: 'checkPages', href: '/review' },
      { key: 'developers', href: '/developers' },
      { key: 'connect', href: '/connect' },
      { key: 'sponsorship', href: '/sponsors' },
    ],
  },
  {
    titleKey: 'colAbout',
    links: [
      { key: 'about', href: '/about' },
      { key: 'vision', href: '/vision' },
      { key: 'howItWorks', href: '/how-it-works' },
      { key: 'faq', href: '/about/faq' },
      { key: 'models', href: '/about/models' },
      { key: 'qualityCenter', href: '/quality' },
    ],
  },
  {
    titleKey: 'colLegal',
    links: [
      { key: 'licensing', href: '/licensing' },
      { key: 'privacy', href: '/privacy' },
      { key: 'cookieSettings', href: '#cookie-settings' },
      { key: 'terms', href: '/terms' },
      { key: 'copyright', href: '/dmca' },
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
