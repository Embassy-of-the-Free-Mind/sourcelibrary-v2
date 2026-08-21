'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import UserMenu from './UserMenu';
import { Search, ChevronDown } from 'lucide-react';
import { useLocale, localeHref, hasLocalizedTwin, localePath, canonicalPath, NAV_STRINGS, type NavStrings, type Locale } from '@/lib/i18n';
import { isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { trackEvent } from '@/lib/track-event';

interface NavLink {
  label: string;
  href: string;
  activePrefix?: string;
  children?: { label: string; href: string }[];
}

// Labels are resolved per-locale from NAV_STRINGS so the nav stays in one place
// as languages are added. Hrefs are written in their ENGLISH (canonical) form
// and localized at the end of this function by `localePath`, which is guarded by
// the route registry in locale-path.ts: an item with a twin gets the `/es`
// prefix, an item without one is returned untouched and lands on its English
// page. Doing it per-item by hand is what left `/librarian` pointing at the
// English librarian from the Spanish header while `/collections` was localized
// by a ternary two lines above it — the registry knows about `/es/librarian`,
// the hand-written ternary did not.
function buildNavLinks(t: NavStrings, locale: Locale): NavLink[] {
  const links: NavLink[] = [
    { label: t.collections, href: '/collections', activePrefix: '/collections' },
    { label: t.gallery, href: '/gallery' },
    {
      label: t.browse,
      href: '/browse',
      activePrefix: '/browse',
      children: [
        { label: t.browse, href: '/browse' },
        { label: t.catalogue, href: '/catalog' },
        { label: t.works, href: '/works' },
      ],
    },
    // Points at the /explore hub, not /explore/map. The hub carries the entity
    // stats, the century heatmap, and cards for all three visualizations; the
    // nav used to skip past it straight to the map, which is why the hub drew
    // 13 pageviews in the 30 days to 2026-08-13 while the map drew 262 and the
    // timeline and constellation together drew 139. Linking the room instead of
    // one corner of it is the whole change.
    { label: t.explore, href: '/explore', activePrefix: '/explore' },
    { label: t.librarian, href: '/librarian' },
    // No Podcast item. Measured over the same 30 days, the header was the only
    // sitewide English entry point to /podcast and it produced 113 plays, of
    // which 66 (58%) were the one episode featured on the /es homepage — i.e.
    // the editorial placement, not the nav, is what makes people listen. The
    // homepage feature is now rendered for both locales (HomeView), which is
    // where that traffic is meant to come from. Episodes also stay reachable
    // from their librarian threads and the footer.
  ];

  if (locale === 'en') return links;
  // `activePrefix` must move with the href, or the Spanish nav highlights
  // nothing: the pathname is `/es/collections` and the prefix would say
  // `/collections`.
  return links.map((link) => ({
    ...link,
    href: localePath(link.href, locale),
    ...(link.activePrefix ? { activePrefix: localePath(link.activePrefix, locale) } : {}),
    ...(link.children ? { children: link.children.map((c) => ({ ...c, href: localePath(c.href, locale) })) } : {}),
  }));
}

interface Breadcrumb {
  label: string;
  href: string;
}

interface SiteHeaderProps {
  /** 'transparent' for the homepage hero overlay, 'light' (default) for all other
   *  pages, 'dark' for a solid dark bar (e.g. the collection page header). */
  variant?: 'transparent' | 'light' | 'dark';
  /** Optional breadcrumb trail after the logo (e.g. "Image Gallery") */
  breadcrumbs?: Breadcrumb[];
  /** Make header sticky */
  sticky?: boolean;
  /** Additional className for the header element */
  className?: string;
  /**
   * Set by the homepage (`/` and `/es`) to its known locale. The homepage is
   * statically prerendered, where `usePathname()` is null at build time — so
   * relying on it leaves the EN/ES toggle out of the static HTML and it only
   * appears after hydration. Passing the locale explicitly makes the toggle
   * (and nav strings) server-rendered on the homepage.
   */
  homeLocale?: Locale;
}

export default function SiteHeader({ variant = 'light', breadcrumbs, sticky, className = '', homeLocale }: SiteHeaderProps) {
  const isWhiteText = variant === 'transparent' || variant === 'dark';
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const pathnameLocale = useLocale();
  // Prefer the homepage's explicit locale (server-known) over the pathname-
  // derived one (null during static prerender).
  const locale = homeLocale ?? pathnameLocale;
  const t = NAV_STRINGS[locale];
  // Global-only surfaces 404 on partner subdomains (the list and rationale live
  // in src/lib/tenant-global-paths.ts — #3364, #3370), so the nav must not point
  // at them there: "Map" → /explore/map would be a dead link in the tenant's own
  // header.
  //
  // Reuses the shared `useEmbedContext` signal (tenant subdomain, /embed/ route,
  // or iframe) rather than a bespoke hostname check — #3367 added a second,
  // narrower copy of this detection, which is exactly the drift the shared hook
  // exists to prevent. Resolved after mount, so the static HTML the global site
  // shares is unchanged and only a tenant visitor sees the item drop.
  //
  // Note most pages wrap this in ConditionalSiteHeader, which removes the whole
  // header on a tenant host post-hydration. This filter is what protects the
  // pages that render SiteHeader directly and stay reachable there (e.g.
  // /author/[name]).
  const isTenantHost = useIsEmbedded();
  // Dropdown children get the same treatment as top-level links. They used to
  // be rendered unfiltered, which was harmless only because no child pointed at
  // a global-only path; `/works` under Browse is the first that does, and an
  // unfiltered child would put a proxy-404 link in a partner's own header —
  // the one thing the shared list exists to prevent.
  //
  // The hrefs arriving here are already locale-prefixed, so the global-only test
  // runs on the CANONICAL path: `/es/explore` is the same global-only surface as
  // `/explore` and a prefix-blind lookup would miss it.
  const NAV_LINKS = buildNavLinks(t, locale)
    .filter(link => !(isTenantHost && isGlobalOnlyNavHref(canonicalPath(link.href))))
    .map(link =>
      link.children && isTenantHost
        ? { ...link, children: link.children.filter(child => !isGlobalOnlyNavHref(canonicalPath(child.href))) }
        : link
    );
  // The Support button is deliberately NOT in buildNavLinks: it is an action,
  // not a destination among peers, and it renders as a pill after the nav rather
  // than as another link in the row. It goes through the same tenant filter,
  // which is what keeps it off partner subdomains (`/give` is on the global-only
  // list — a BPH visitor asked for money on BPH's own domain would reasonably
  // think the money went to BPH).
  //
  // Why it exists at all: measured over the 30 days to 2026-08-05, /support drew
  // 60 of 330,698 pageviews (0.018%) while /book/* drew 217,490. The site had no
  // giving link anywhere above the footer's third column, so two-thirds of all
  // traffic never saw an ask. Every comparable library puts one in the header —
  // Wikipedia's "Donate" is the first item in its article nav, ahead of "Create
  // account"; the Internet Archive's sits in its sitewide bar.
  const showSupport = !(isTenantHost && isGlobalOnlyNavHref('/give'));
  // The EN/ES toggle shows only where a real Spanish twin exists (home, sign-in,
  // support) — the thin-i18n bargain (#2763). On deep English-only pages the
  // toggle is hidden, so clicking ES never bounces the reader to the `/es`
  // homepage (deep pages rely on the browser's own translate instead).
  // `homeLocale` is set on the statically-prerendered homepage, where pathname
  // is null at build — treat that as localized so the toggle renders server-side.
  const showLangToggle = homeLocale !== undefined || hasLocalizedTwin(pathname);
  const enHref = localeHref('en', pathname);
  const esHref = localeHref('es', pathname);

  // Close menus on route change
  useEffect(() => { setMenuOpen(false); setDropdownOpen(null); }, [pathname]);

  // Close menu on click outside
  useEffect(() => {
    if (!menuOpen && !dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
      if (dropdownOpen && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen, dropdownOpen]);

  const variantClasses = {
    transparent: 'relative z-50 py-4',
    light: 'bg-cream border-b border-border-light py-3',
    dark: 'bg-dark border-b border-white/10 py-3',
  }[variant];

  const linkClass = isWhiteText
    ? 'text-white/70 hover:text-white'
    : 'text-secondary hover:text-primary';

  const activeLinkClass = isWhiteText
    ? 'text-white'
    : 'text-primary font-medium';

  return (
    <header
      data-site-header=""
      className={`${variantClasses} ${sticky ? 'sticky top-0 z-20' : ''} ${className}`}
    >
      <div className="flex items-center justify-between px-6 md:px-12 max-w-[var(--container-wide)] mx-auto">
        <div className="flex items-center gap-3">
          <Logo white={isWhiteText} compact={!!breadcrumbs} lang={locale} />
          {breadcrumbs?.map((crumb) => (
            <span key={crumb.href} className="flex items-center gap-3">
              <span className={isWhiteText ? 'text-white/40 hidden sm:inline' : 'text-stone-400 hidden sm:inline'}>/</span>
              <Link
                href={crumb.href}
                className={`text-base font-serif ${
                  isWhiteText ? 'text-white hover:opacity-80' : 'text-primary hover:text-secondary'
                } transition-colors`}
              >
                {crumb.label}
              </Link>
            </span>
          ))}
        </div>
        <div className="flex items-center gap-6">
          {/* Desktop nav links */}
          <nav className="hidden lg:flex items-center gap-5">
            {NAV_LINKS.map((link) => {
              const prefix = (link.activePrefix || link.href);
              const isActive = pathname === prefix || pathname?.startsWith(prefix + '/');
              const isCatalogActive = link.children?.some(c => pathname === c.href || pathname?.startsWith(c.href + '/'));

              if (link.children) {
                return (
                  <div key={link.href} className="relative" ref={dropdownRef}>
                    <button
                      onClick={() => setDropdownOpen(dropdownOpen === link.label ? null : link.label)}
                      className={`text-sm font-sans tracking-wide transition-colors flex items-center gap-0.5 ${
                        isActive || isCatalogActive ? activeLinkClass : linkClass
                      }`}
                    >
                      {link.label}
                      <ChevronDown className={`w-3 h-3 transition-transform ${dropdownOpen === link.label ? 'rotate-180' : ''}`} />
                    </button>
                    {dropdownOpen === link.label && (
                      <div className="absolute left-0 top-full mt-2 w-36 bg-white rounded-lg shadow-lg border border-border-light py-1.5 z-50">
                        {link.children.map((child) => {
                          const childActive = pathname === child.href || pathname?.startsWith(child.href + '/');
                          return (
                            <Link
                              key={child.href}
                              href={child.href}
                              className={`block px-4 py-2 text-sm transition-colors ${
                                childActive
                                  ? 'text-primary font-medium bg-warm'
                                  : 'text-secondary hover:text-primary hover:bg-warm/50'
                              }`}
                            >
                              {child.label}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-sans tracking-wide transition-colors ${
                    isActive ? activeLinkClass : linkClass
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Support — a pill, at every breakpoint including mobile, where most
              reading happens. Ordered before the language toggle and search so
              it does not get pushed off a narrow viewport. */}
          {showSupport && (
            <Link
              href="/give"
              // Fired here, at the control, because nothing downstream can
              // reconstruct it: /api/track collapses self-referrals to 'direct'
              // and client-side navigation preserves the original external
              // referrer, so an arrival at /give cannot be attributed after the
              // fact. trackEvent uses sendBeacon, which survives this navigation.
              onClick={() => trackEvent('give_nav_click', { source: 'header', url: '/give' })}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium tracking-wide transition-colors ${
                isWhiteText
                  ? 'border-white/40 text-white hover:bg-white hover:text-dark'
                  : 'border-accent-rust text-accent-rust hover:bg-accent-rust hover:text-white'
              }`}
            >
              {t.support}
            </Link>
          )}

          {/* Language toggle — only on pages with a real Spanish twin (#2763) */}
          {showLangToggle && (
          <div className="flex items-center gap-1.5 text-xs font-medium tracking-wide" aria-label="Language">
            <Link
              href={enHref}
              aria-current={locale === 'en' ? 'page' : undefined}
              className={
                locale === 'en'
                  ? (isWhiteText ? 'text-white' : 'text-primary')
                  : (isWhiteText ? 'text-white/50 hover:text-white' : 'text-secondary hover:text-primary')
              }
            >
              EN
            </Link>
            <span className={isWhiteText ? 'text-white/30' : 'text-stone-300'}>·</span>
            <Link
              href={esHref}
              aria-current={locale === 'es' ? 'page' : undefined}
              className={
                locale === 'es'
                  ? (isWhiteText ? 'text-white' : 'text-primary')
                  : (isWhiteText ? 'text-white/50 hover:text-white' : 'text-secondary hover:text-primary')
              }
            >
              ES
            </Link>
          </div>
          )}

          {/* Desktop search icon */}
          <Link
            href="/search"
            className={`hidden lg:flex items-center justify-center w-8 h-8 rounded-lg transition-colors ${
              pathname === '/search'
                ? (isWhiteText ? 'text-white bg-white/10' : 'text-primary bg-warm')
                : (isWhiteText ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-secondary hover:text-primary hover:bg-warm/50')
            }`}
            aria-label={t.search}
          >
            <Search className="w-4 h-4" />
          </Link>

          {/* Mobile hamburger */}
          <div className="relative lg:hidden" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className={`p-1.5 rounded transition-colors ${
                isWhiteText ? 'text-white/70 hover:text-white' : 'text-secondary hover:text-primary'
              }`}
              aria-label={t.menu}
              aria-expanded={menuOpen}
            >
              {menuOpen ? (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-lg shadow-lg border border-border-light py-2 z-50">
                {NAV_LINKS.flatMap((link) => {
                  if (link.children) {
                    return link.children.map((child) => {
                      const childActive = pathname === child.href || pathname?.startsWith(child.href + '/');
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          className={`block px-4 py-2.5 text-sm transition-colors ${
                            childActive
                              ? 'text-primary font-medium bg-warm'
                              : 'text-secondary hover:text-primary hover:bg-warm/50'
                          }`}
                        >
                          {child.label}
                        </Link>
                      );
                    });
                  }
                  const prefix = (link.activePrefix || link.href);
                  const isActive = pathname === prefix || pathname?.startsWith(prefix + '/');
                  return (
                    <Link
                      key={link.href}
                      href={link.href}
                      className={`block px-4 py-2.5 text-sm transition-colors ${
                        isActive
                          ? 'text-primary font-medium bg-warm'
                          : 'text-secondary hover:text-primary hover:bg-warm/50'
                      }`}
                    >
                      {link.label}
                    </Link>
                  );
                })}
                <div className="border-t border-border-light my-1.5" />
                <Link
                  href="/search"
                  className="block px-4 py-2.5 text-sm text-secondary hover:text-primary hover:bg-warm/50 transition-colors"
                >
                  {t.search}
                </Link>
              </div>
            )}
          </div>

          <UserMenu variant={isWhiteText ? 'hero' : 'default'} />
        </div>
      </div>
    </header>
  );
}
