/**
 * Page states: which routes are not public, and what happens to a visitor.
 *
 * Every route is LIVE unless it is listed here. A listed route stays in the
 * code and keeps its URL; only who may open it changes:
 *
 *   internal  team tools and dashboards. Admins only; everyone else is sent
 *             to sign-in (signed out) or /unauthorized (signed in).
 *   draft     unfinished pages meant to go live. Same gate as internal; the
 *             admin sees a "Draft" bar.
 *   archived  retired pages. Everyone but an admin is redirected to `sendTo`;
 *             the admin can still open the page and sees an "Archived" bar.
 *
 * "Admin" is the global role on the session token (superadmin today); see
 * isPageStatusAdmin().
 *
 * Why a list and not an `_archived/` folder: an unrouted folder looks like dead
 * code, and the knip cleanup (#4887) deleted the last one. Listed pages keep
 * compiling, so nothing sweeps them up, and changing a state is one line.
 *
 * Who reads this list:
 *   - src/proxy.ts            the gate (redirects, noindex, no-store)
 *   - next.config.ts          CDN-Cache-Control: private, no-store, so
 *                             Cloudflare never holds a copy of a listed page
 *   - src/app/sitemap.ts      listed pages are left out
 *   - src/app/robots.txt      internal and draft pages are disallowed
 *   - PageStatusBar           the bar an admin sees on a listed page
 * tests/unit/page-status.test.ts fails if a listed page is still in the
 * sitemap's static list, a header/footer menu or site-features.json, or if an
 * archived entry has no live `sendTo`.
 *
 * After changing a state, purge the page's URL from Cloudflare: it may hold
 * a 24h copy from before the change (.claude/docs/invariants/deploy-and-caching.md).
 *
 * Keys use the same syntax as next.config.ts `source`, limited to two forms:
 *   `:name`   one path segment          /book/:id/page/:pageId/v2a
 *   `:name*`  zero or more segments     /ficino-society/:path*
 *
 * Keep this file free of imports: next.config.ts, the proxy and a client
 * component all load it.
 */

export type PageState = 'internal' | 'draft' | 'archived';

export interface PageStatusEntry {
  state: PageState;
  /** ISO date the state was set, e.g. '2026-10-18'. Shown on the bar. */
  since: string;
  /** Why. One line; shown to admins on the bar. */
  note: string;
  /** archived only: where everyone else is sent. A live path on this site. */
  sendTo?: string;
}

export const PAGE_STATUS: Record<string, PageStatusEntry> = {
  // Empty on purpose: this change adds the mechanism only. Pages move in
  // follow-up PRs, one state at a time.
  // DEMO ONLY (preview/page-status-demo, never merged):
  '/roadmap': { state: 'archived', since: '2026-10-18', note: 'Blank page.', sendTo: '/about' },
  '/processing': { state: 'internal', since: '2026-10-18', note: 'Pipeline dashboard.' },
  '/ideas': { state: 'draft', since: '2026-10-18', note: 'Unfinished.' },
};

interface CompiledPattern {
  pattern: string;
  re: RegExp;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Compile a `:name` / `:name*` pattern to an anchored RegExp. Exported for tests. */
export function compilePagePattern(pattern: string): RegExp {
  const segments = pattern.split('/').filter(Boolean);
  let src = '';
  for (const seg of segments) {
    if (/^:[A-Za-z_]\w*\*$/.test(seg)) src += '(?:/[^/]+)*';
    else if (/^:[A-Za-z_]\w*$/.test(seg)) src += '/[^/]+';
    else src += '/' + escapeRegExp(seg);
  }
  return new RegExp(`^${src || '/'}/?$`);
}

const compiledCache = new WeakMap<Record<string, PageStatusEntry>, CompiledPattern[]>();
function patterns(registry: Record<string, PageStatusEntry>): CompiledPattern[] {
  let list = compiledCache.get(registry);
  if (!list) {
    list = Object.keys(registry).map((pattern) => ({ pattern, re: compilePagePattern(pattern) }));
    compiledCache.set(registry, list);
  }
  return list;
}

/**
 * The entry covering `pathname`, or null when the page is live. `registry`
 * is only passed by tests.
 */
export function pageStatusFor(
  pathname: string,
  registry: Record<string, PageStatusEntry> = PAGE_STATUS,
): (PageStatusEntry & { pattern: string }) | null {
  for (const { pattern, re } of patterns(registry)) {
    if (re.test(pathname)) return { pattern, ...registry[pattern] };
  }
  return null;
}

/** True when `pathname` is open to everyone (not listed). */
export function isLivePath(
  pathname: string,
  registry: Record<string, PageStatusEntry> = PAGE_STATUS,
): boolean {
  return pageStatusFor(pathname, registry) === null;
}

/** Session-token roles that may open internal, draft and archived pages. */
export function isPageStatusAdmin(role: unknown): boolean {
  return role === 'admin' || role === 'superadmin';
}

/** Patterns for next.config.ts headers(): every listed page, in `source` syntax. */
export function pageStatusSources(registry: Record<string, PageStatusEntry> = PAGE_STATUS): string[] {
  return Object.keys(registry);
}

/**
 * robots.txt Disallow lines for internal and draft pages. Archived pages are
 * left crawlable so search engines follow their redirect to `sendTo`.
 */
export function pageStatusRobotsDisallow(
  registry: Record<string, PageStatusEntry> = PAGE_STATUS,
): string[] {
  return Object.entries(registry)
    .filter(([, e]) => e.state !== 'archived')
    .map(([pattern]) => {
      const parts = pattern.split('/').filter(Boolean);
      const out: string[] = [];
      for (const seg of parts) {
        if (/^:[A-Za-z_]\w*\*$/.test(seg)) { out.push(''); break; } // subtree: trailing slash
        out.push(seg.startsWith(':') ? '*' : seg);
      }
      return '/' + out.join('/');
    });
}
