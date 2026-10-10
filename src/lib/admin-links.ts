/**
 * Every admin page, in one list, grouped by what Derek is doing when he opens it.
 * The account menu (src/components/layout/UserMenu.tsx) shows the links marked
 * `menu`; the admin bar (src/app/admin/AdminNav.tsx) shows them all. One list,
 * so a new page cannot again land in one nav and be missing from the other
 * (the decision queue shipped in PlatformNav only, #6258; API Keys left the
 * account menu in #5885 and had no other door from it).
 *
 * PRIOR ART: src/app/admin/AdminNav.tsx `adminLinks` (the flat list this
 * replaces) and the hand-written admin block in UserMenu.tsx; PlatformNav.tsx
 * keeps its own list because /platform is the tenant console, not these pages.
 */

/**
 * admin      — the /admin layout's requireAdmin.
 * superadmin — pages behind requireSuperAdmin (the /platform layout).
 * spend      — the allow-listed spend report (#5225): the admin bar shows it when
 *              the server says this viewer may see it; the menu approximates with
 *              superadmin, the accounts that list is minted from.
 */
export type AdminGate = 'admin' | 'superadmin' | 'spend';

export interface AdminLink {
  href: string;
  label: string;
  gate?: AdminGate;
  /** Also in the account menu: the pages opened most days. */
  menu?: boolean;
  /** Active only on this exact path (the dashboard, whose path prefixes every other). */
  exact?: boolean;
}

export interface AdminSection {
  label: string;
  links: AdminLink[];
}

export const ADMIN_SECTIONS: AdminSection[] = [
  {
    // What is waiting and where things stand: shown flat, never in a dropdown.
    label: 'Today',
    links: [
      { href: '/platform/admin/decisions', label: 'Decisions', gate: 'superadmin', menu: true },
      { href: '/admin', label: 'Dashboard', exact: true, menu: true },
      { href: '/admin/work', label: 'Work in flight', menu: true },
      { href: '/admin/spend', label: 'Spend', gate: 'spend', menu: true },
      { href: '/admin/errors', label: 'Errors' },
    ],
  },
  {
    label: 'People',
    links: [
      { href: '/admin/introductions', label: 'Introductions', menu: true },
      { href: '/feedback', label: 'Feedback', menu: true },
      { href: '/admin/api-keys', label: 'API keys', menu: true },
      { href: '/admin/shared-findings', label: 'Shared findings' },
      { href: '/admin/users', label: 'Users' },
      { href: '/admin/members', label: 'Members' },
    ],
  },
  {
    label: 'Library',
    links: [
      { href: '/admin/canon', label: 'Canon' },
      { href: '/research/canon-gap', label: 'Open Canons' },
      { href: '/curation/identity-review', label: 'Identity review' },
      { href: '/admin/collections', label: 'Collections' },
      { href: '/admin/collection-proposals', label: 'Proposals' },
      { href: '/admin/duplicates', label: 'Duplicates' },
      { href: '/admin/holdings', label: 'Holdings check' },
      { href: '/admin/catalog-coverage', label: 'Catalogue' },
      { href: '/admin/r2-coverage', label: 'R2 storage' },
      { href: '/admin/knowledge-graph', label: 'Knowledge graph' },
    ],
  },
  {
    label: 'Pipeline',
    links: [
      { href: '/admin/pipeline', label: 'Pipeline' },
      { href: '/admin/processing', label: 'Processing' },
      { href: '/admin/quality', label: 'Quality' },
      { href: '/admin/scan-evaluation', label: 'Scan review' },
      { href: '/admin/realtime', label: 'Realtime' },
      { href: '/admin/bots', label: 'Bots' },
      { href: '/admin/system-map', label: 'System map' },
    ],
  },
  {
    label: 'Readers & reach',
    links: [
      { href: '/admin/traffic', label: 'Traffic', menu: true },
      { href: '/analytics', label: 'Analytics', menu: true },
      { href: '/platform/admin/metrics', label: 'Metrics', gate: 'superadmin' },
      { href: '/about/progress', label: 'Progress' },
      { href: '/admin/outreach', label: 'Outreach' },
      { href: '/admin/social', label: 'Social' },
      { href: '/admin/marketing', label: 'Marketing' },
      { href: '/admin/email', label: 'Email' },
      { href: '/admin/kdp', label: 'Publishing' },
    ],
  },
];

/**
 * Admin pages deliberately left out of the list above, each with the door that
 * reaches it. tests/unit/admin-links.test.ts fails on an /admin page in neither
 * list, so a new page gets a link or a stated reason, never silence.
 */
export const UNLISTED_ADMIN_PAGES: Record<string, string> = {
  '/admin/book-collections': 'edited from /admin/collections',
  '/admin/covers': 'concept covers, never applied to a book; reached by URL on purpose',
  '/admin/feedback': 'the triage view /feedback links to',
  '/admin/identity-review': 'redirects to /curation/identity-review',
};

export interface AdminViewer {
  role: string | undefined;
  /** Only the admin bar knows this (server-resolved); the menu passes undefined. */
  canSeeSpend?: boolean;
}

export function canSee(link: AdminLink, v: AdminViewer): boolean {
  const isAdmin = v.role === 'admin' || v.role === 'superadmin';
  if (!isAdmin) return false;
  if (link.gate === 'superadmin') return v.role === 'superadmin';
  if (link.gate === 'spend') return v.canSeeSpend ?? v.role === 'superadmin';
  return true;
}

/** The sections this viewer may see, empty sections dropped. */
export function adminSectionsFor(v: AdminViewer): AdminSection[] {
  return ADMIN_SECTIONS
    .map((s) => ({ ...s, links: s.links.filter((l) => canSee(l, v)) }))
    .filter((s) => s.links.length > 0);
}

/** The account menu's admin links, in section order. */
export function adminMenuLinks(v: AdminViewer): AdminLink[] {
  return adminSectionsFor(v).flatMap((s) => s.links.filter((l) => l.menu));
}
