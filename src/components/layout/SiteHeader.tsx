'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import UserMenu from './UserMenu';
import { Search, ChevronDown } from 'lucide-react';
import { useLocale, localeHref, hasLocalizedTwin, NAV_STRINGS, type NavStrings, type Locale } from '@/lib/i18n';
import { isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';

interface NavLink {
  label: string;
  href: string;
  activePrefix?: string;
  children?: { label: string; href: string }[];
}

// Hrefs are constant; labels are resolved per-locale from NAV_STRINGS so the
// nav stays in one place as languages are added.
function buildNavLinks(t: NavStrings): NavLink[] {
  return [
    { label: t.collections, href: '/collections' },
    { label: t.gallery, href: '/gallery' },
    {
      label: t.browse,
      href: '/browse',
      activePrefix: '/browse',
      children: [
        { label: t.browse, href: '/browse' },
        { label: t.catalogue, href: '/catalog' },
      ],
    },
    { label: t.map, href: '/explore/map', activePrefix: '/explore' },
    { label: t.librarian, href: '/librarian' },
    { label: t.podcast, href: '/podcast' },
  ];
}

/**
 * True when rendering on a partner subdomain (bph.sourcelibrary.org, …) or
 * inside an /embed/* view. Deliberately host-shaped rather than an allow-list of
 * tenant slugs, so a new tenant subdomain is covered the day its DNS record
 * exists. `false` during SSR and on the first client render, so the global
 * site's static HTML is untouched.
 */
function useIsTenantHost(): boolean {
  const [isTenant, setIsTenant] = useState(false);
  useEffect(() => {
    const h = window.location.hostname;
    const parts = h.split('.');
    const isSubdomain =
      h.endsWith('.sourcelibrary.org') && parts.length > 2 && parts[0] !== 'www';
    setIsTenant(isSubdomain || window.location.pathname.startsWith('/embed/'));
  }, []);
  return isTenant;
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
  // Corpus-wide surfaces 404 on partner subdomains (see GLOBAL_ONLY_TENANT_BLOCKED
  // in src/proxy.ts, issue #3364), so the nav must not point at them there — "Map"
  // would otherwise be a dead link in the tenant's own header.
  //
  // Detected from the hostname rather than passed down: this is a client
  // component rendered by ~every page, so a prop would mean threading tenant
  // context through all of them, and reading headers() server-side to provide it
  // would force the ISR routes dynamic. Resolved after mount, so the static HTML
  // (which the global site shares) is unchanged and only a tenant visitor sees
  // the item drop — acceptable for a nav link, and it never removes anything on
  // sourcelibrary.org itself.
  const isTenantHost = useIsTenantHost();
  const NAV_LINKS = buildNavLinks(t).filter(
    link => !(isTenantHost && isGlobalOnlyNavHref(link.href))
  );
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
          <Logo white={isWhiteText} compact={!!breadcrumbs} />
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
