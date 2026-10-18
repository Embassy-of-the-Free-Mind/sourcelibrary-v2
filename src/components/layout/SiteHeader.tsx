'use client';

import { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import UserMenu from './UserMenu';
import LanguageMenu, { HEADER_LANGUAGE_NAME } from './LanguageMenu';
import SiteMenuPanel from './SiteMenuPanel';
import { Search, X } from 'lucide-react';
import { useLocale, hasLocalizedTwin, localePath, localeHref, canonicalPath, NAV_STRINGS, CHROME_STRINGS, FOOTER_STRINGS, PREFIXED_LOCALES, type NavStrings, type Locale } from '@/lib/i18n';
import { isGlobalOnlyNavHref } from '@/lib/tenant-global-paths';
import { useIsEmbedded } from '@/hooks/useEmbedContext';
import { useStableSession } from '@/hooks/useStableSession';
import { trackEvent } from '@/lib/track-event';

interface NavLink {
  key: keyof NavStrings;
  label: string;
  href: string;
  activePrefix?: string;
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
//
// Order agreed 2026-10-18: Library, Gallery, Collections, Articles, Explore,
// About, Ask the librarian; then search, language, sign in and support. Browse,
// Works and Identify left the header (all still in the footer or reachable from
// the Library page).
function buildNavLinks(t: NavStrings, locale: Locale): NavLink[] {
  const links: NavLink[] = [
    // The catalogue page. Moves to /library with #6866, which redirects /catalog.
    { key: 'library', label: t.library, href: '/catalog', activePrefix: '/catalog' },
    { key: 'gallery', label: t.gallery, href: '/gallery', activePrefix: '/gallery' },
    { key: 'collections', label: t.collections, href: '/collections', activePrefix: '/collections' },
    // Research notes, renamed Articles. Moves to /articles with #6887, which redirects /blog.
    { key: 'articles', label: t.articles, href: '/blog', activePrefix: '/blog' },
    // Points at the /explore hub, not /explore/map: the hub carries the stats
    // and cards for all three visualizations (13 views vs the map's 262 in the
    // 30 days to 2026-08-13 when the nav skipped it).
    { key: 'explore', label: t.explore, href: '/explore', activePrefix: '/explore' },
    { key: 'about', label: t.about, href: '/about', activePrefix: '/about' },
    { key: 'askLibrarian', label: t.askLibrarian, href: '/librarian', activePrefix: '/librarian' },
  ];

  if (locale === 'en') return links;
  // `activePrefix` must move with the href, or the Spanish nav highlights
  // nothing: the pathname is `/es/collections` and the prefix would say
  // `/collections`.
  return links.map((link) => ({
    ...link,
    href: localePath(link.href, locale),
    ...(link.activePrefix ? { activePrefix: localePath(link.activePrefix, locale) } : {}),
  }));
}

interface Breadcrumb {
  label: string;
  href: string;
}

interface SiteHeaderProps {
  /** 'transparent' for the homepage hero overlay. Every other page gets the
   *  dark bar: 'light' and 'dark' are both kept as names so the ~80 callers
   *  don't change, and both render dark (agreed 2026-10-18). */
  variant?: 'transparent' | 'light' | 'dark';
  /** Optional breadcrumb trail after the logo (e.g. "Image Gallery") */
  breadcrumbs?: Breadcrumb[];
  /** Make header sticky. The default is not sticky: the bar scrolls away. */
  sticky?: boolean;
  /** Additional className for the header element */
  className?: string;
  /**
   * Set by the homepage (`/` and `/es`) to its known locale. The homepage is
   * statically prerendered, where `usePathname()` is null at build time — so
   * relying on it leaves the language menu out of the static HTML and it only
   * appears after hydration. Passing the locale explicitly makes it (and the
   * nav strings) server-rendered on the homepage.
   */
  homeLocale?: Locale;
}

const MENU_ID = 'site-menu';

export default function SiteHeader({ variant = 'light', breadcrumbs, sticky, className = '', homeLocale }: SiteHeaderProps) {
  const isHero = variant === 'transparent';
  const [menuOpen, setMenuOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  // True when the links don't fit beside the logo and tools at this width and
  // in this language, measured rather than guessed: at 1180px English fits and
  // Latin doesn't. Below `lg` the CSS hides the row regardless.
  const [compact, setCompact] = useState(false);
  const [underline, setUnderline] = useState<{ x: number; w: number } | null>(null);
  const midRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const pathnameLocale = useLocale();
  // Prefer the homepage's explicit locale (server-known) over the pathname-
  // derived one (null during static prerender).
  const locale = homeLocale ?? pathnameLocale;
  const t = NAV_STRINGS[locale];
  const { data: session } = useStableSession();
  // Global-only surfaces 404 on partner subdomains (the list and rationale live
  // in src/lib/tenant-global-paths.ts — #3364, #3370), so the nav must not point
  // at them there. Reuses the shared `useEmbedContext` signal (tenant subdomain,
  // /embed/ route, or iframe); resolved after mount, so the static HTML the
  // global site shares is unchanged and only a tenant visitor sees items drop.
  //
  // The hrefs arriving here are already locale-prefixed, so the global-only test
  // runs on the CANONICAL path: `/es/explore` is the same global-only surface as
  // `/explore` and a prefix-blind lookup would miss it.
  const isTenantHost = useIsEmbedded();
  const NAV_LINKS = buildNavLinks(t, locale)
    .filter(link => !(isTenantHost && isGlobalOnlyNavHref(canonicalPath(link.href))));
  const isActive = (link: NavLink) => {
    const prefix = link.activePrefix || link.href;
    return pathname === prefix || !!pathname?.startsWith(prefix + '/');
  };
  // The Support button is an action, not a destination among peers, so it is a
  // button after the nav rather than another link in the row. It goes through
  // the same tenant filter, which keeps it off partner subdomains (`/give` is on
  // the global-only list — a BPH visitor asked for money on BPH's own domain
  // would reasonably think the money went to BPH).
  //
  // Why it exists at all: over the 30 days to 2026-08-05, /support drew 60 of
  // 330,698 pageviews while /book/* drew 217,490; the site had no giving link
  // above the footer. Wikipedia's "Donate" leads its article nav.
  const showSupport = !(isTenantHost && isGlobalOnlyNavHref('/give'));
  // The language menu shows only where a real twin of this page exists (home,
  // sign-in, support…) — the thin-i18n bargain (#2763). On deep English-only
  // pages it is hidden, so choosing a language never bounces the reader to a
  // front page.
  const showLangToggle = homeLocale !== undefined || hasLocalizedTwin(pathname);
  const langLinks: Locale[] = ['en', ...PREFIXED_LOCALES.filter(
    (l) => homeLocale !== undefined || l === locale || hasLocalizedTwin(pathname, l),
  )];
  const searchHref = localePath('/search', locale);
  const onSupportClick = () => trackEvent('give_nav_click', { source: 'header', url: '/give' });

  // Close menus on route change
  useEffect(() => { setMenuOpen(false); setSearching(false); }, [pathname]);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    burgerRef.current?.focus();
  }, []);

  // Collapse to the hamburger when the row would overflow.
  const measure = useCallback(() => {
    const mid = midRef.current, nav = navRef.current;
    if (!mid || !nav) return;
    setCompact(nav.scrollWidth > mid.clientWidth + 1);
  }, []);
  useLayoutEffect(() => {
    measure();
    const mid = midRef.current;
    if (!mid || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(mid);
    document.fonts?.ready.then(measure);
    return () => ro.disconnect();
  }, [measure, locale, NAV_LINKS.length]);

  // The underline rests under the current page and glides to the hovered link.
  const restUnderline = useCallback(() => {
    const active = navRef.current?.querySelector<HTMLElement>('a[aria-current="page"]');
    setUnderline(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
  }, []);
  useLayoutEffect(() => { restUnderline(); }, [restUnderline, pathname, locale, compact]);

  useEffect(() => {
    if (!searching) return;
    const id = setTimeout(() => searchInputRef.current?.focus(), 200);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSearching(false); };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(id); document.removeEventListener('keydown', onKey); };
  }, [searching]);

  // Over the homepage hero the bar is see-through until the menu opens.
  const barBg = isHero && !menuOpen ? 'bg-transparent' : 'bg-dark';
  const position = menuOpen
    ? 'fixed top-0 inset-x-0 z-50'
    : `${isHero ? 'relative z-50' : 'relative z-30'} ${sticky ? 'sticky top-0' : ''}`;

  // Phones: only the rings until the menu opens, then the wordmark slides out
  // beside them. Wide screens always show it, even when the links collapse.
  const wordmark = `inline-block overflow-hidden whitespace-nowrap transition-[max-width,opacity,margin] duration-500 ease-[cubic-bezier(.2,.8,.2,1)] ${menuOpen
    ? 'max-w-[16rem] opacity-100 ml-3'
    : 'max-w-0 opacity-0 ml-0 lg:max-w-[16rem] lg:opacity-100 lg:ml-3'}`;

  const accountHref = session ? '/account' : localePath('/auth/signin', locale);
  const accountLabel = session ? FOOTER_STRINGS[locale].account : CHROME_STRINGS[locale].signIn;
  // Signed-in readers get their account (favourites, lists, history, sign out)
  // instead of Sign in, with their picture so it reads as theirs.
  const accountAvatar = session ? {
    image: session.user?.image,
    initials: (session.user?.name?.split(' ').map((n) => n[0]).join('') || session.user?.email?.[0] || '?').toUpperCase().slice(0, 2),
  } : undefined;

  return (
    <>
      <header
        data-site-header=""
        className={`${barBg} text-white ${position} ${className}`}
      >
        <div className="flex items-center gap-6 h-14 lg:h-16 pl-5 pr-2.5 md:pl-10 md:pr-8 lg:pr-10 max-w-[var(--container-wide)] mx-auto">
          <div className="flex items-center gap-3 shrink-0">
            <Logo white lang={locale} compact={!!breadcrumbs} wordmarkClassName={wordmark} />
            {breadcrumbs?.map((crumb) => (
              <span key={crumb.href} className={`items-center gap-3 ${menuOpen ? 'hidden' : 'hidden sm:flex'}`}>
                <span className="text-white/40">/</span>
                <Link href={crumb.href} className="text-base font-serif text-white hover:opacity-80 transition-colors">
                  {crumb.label}
                </Link>
              </span>
            ))}
          </div>

          {/* Links, right-aligned; the search field opens across them. */}
          <div ref={midRef} className="relative flex-1 min-w-0 hidden lg:flex justify-end">
            <nav
              ref={navRef}
              aria-label="Site"
              onMouseLeave={restUnderline}
              className={`relative flex items-center gap-[22px] transition-[opacity,transform] duration-300 ${
                compact ? 'invisible absolute right-0' : ''
              } ${searching ? 'opacity-0 -translate-y-1.5 pointer-events-none' : ''}`}
            >
              {NAV_LINKS.map((link) => {
                const active = isActive(link);
                return (
                  <Link
                    key={link.key}
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    tabIndex={compact || searching ? -1 : undefined}
                    onMouseEnter={(e) => setUnderline({ x: e.currentTarget.offsetLeft, w: e.currentTarget.offsetWidth })}
                    className={`py-2 text-[13.5px] whitespace-nowrap transition-colors ${
                      active ? 'text-white' : 'text-white/70 hover:text-white'
                    }`}
                  >
                    {link.label}
                  </Link>
                );
              })}
              <span
                aria-hidden="true"
                className="absolute left-0 bottom-[3px] h-[1.5px] bg-white pointer-events-none transition-[transform,width,opacity] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
                style={{ width: underline?.w ?? 0, transform: `translateX(${underline?.x ?? 0}px)`, opacity: underline ? 1 : 0 }}
              />
            </nav>
            <form
              action={searchHref}
              role="search"
              className="absolute inset-x-0 top-1/2 -mt-5 h-10 flex items-center gap-2.5 border-b-[1.5px] border-white transition-[clip-path] duration-500 ease-[cubic-bezier(.2,.8,.2,1)]"
              style={{ clipPath: searching ? 'inset(0 0 0 0)' : 'inset(0 0 0 100%)', pointerEvents: searching ? 'auto' : 'none' }}
              aria-hidden={!searching}
            >
              <Search className="w-[17px] h-[17px] text-white/70 shrink-0" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="search"
                name="q"
                tabIndex={searching ? 0 : -1}
                placeholder={t.search}
                aria-label={t.search}
                className="flex-1 min-w-0 bg-transparent outline-none text-base text-white placeholder:text-white/60"
              />
            </form>
          </div>

          <div className="hidden lg:flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setSearching((s) => !s)}
              aria-label={t.search}
              aria-expanded={searching}
              className="w-9 h-9 flex items-center justify-center text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              {searching ? <X className="w-[17px] h-[17px]" /> : <Search className="w-[17px] h-[17px]" />}
            </button>
            <span className="w-px h-5 bg-white/15 mx-1.5" aria-hidden="true" />
            {showLangToggle && (
              <LanguageMenu locales={langLinks} current={locale} pathname={pathname} onDark />
            )}
            <span className="ml-1.5"><UserMenu variant="nav" /></span>
            {showSupport && (
              <Link
                href="/give"
                // Fired here, at the control, because nothing downstream can
                // reconstruct it: /api/track collapses self-referrals to 'direct'
                // and client-side navigation preserves the original external
                // referrer. trackEvent uses sendBeacon, which survives this navigation.
                onClick={() => trackEvent('give_nav_click', { source: 'header', url: '/give' })}
                className="ml-1.5 inline-flex items-center h-[34px] px-[15px] whitespace-nowrap text-[13.5px] font-medium bg-[#f3efe7] text-dark hover:bg-white transition-colors"
              >
                {t.support}
              </Link>
            )}
          </div>

          {/* Hamburger: phones, and wide screens where the links don't fit. */}
          <button
            ref={burgerRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label={menuOpen ? CHROME_STRINGS[locale].close : t.menu}
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            className={`relative w-11 h-11 shrink-0 ml-auto text-white ${compact ? '' : 'lg:hidden'}`}
          >
            {[0, 1, 2].map((k) => (
              <i
                key={k}
                aria-hidden="true"
                className="absolute left-[11px] w-[22px] h-[1.5px] bg-current transition-[transform,opacity] duration-[450ms] ease-[cubic-bezier(.2,.8,.2,1)]"
                style={{
                  top: [15, 21.25, 27.5][k],
                  transformOrigin: k === 1 ? 'right' : 'center',
                  transform: menuOpen ? ['translateY(6.25px) rotate(45deg)', 'scaleX(0)', 'translateY(-6.25px) rotate(-45deg)'][k] : 'none',
                }}
              />
            ))}
          </button>
        </div>
      </header>

      <SiteMenuPanel
        id={MENU_ID}
        open={menuOpen}
        onClose={closeMenu}
        links={NAV_LINKS.map((l) => ({ key: l.key, label: l.label, href: l.href, active: isActive(l) }))}
        search={{ action: searchHref, label: t.search }}
        languages={showLangToggle ? langLinks.map((l) => ({
          locale: l,
          href: localeHref(l, pathname),
          label: HEADER_LANGUAGE_NAME[l],
          current: l === locale,
        })) : null}
        account={{ href: accountHref, label: accountLabel, avatar: accountAvatar }}
        support={showSupport ? { href: '/give', label: t.support, onClick: onSupportClick } : null}
      />
    </>
  );
}
