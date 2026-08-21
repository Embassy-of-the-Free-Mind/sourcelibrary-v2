'use client';

import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings, Search, X, LogIn } from 'lucide-react';
import { buildSignInHref, isTenantSubdomain } from '@/lib/tenant-signin-url';

// On tenant subdomains, /auth/* and /account are caught by the proxy.ts
// rewrite (it sends every non-/embed/, non-/api/, non-/_next/ path to
// /embed/<tenant>), so the link silently lands on the tenant homepage —
// from the user's POV "nothing happens". Route those off to the main
// host instead. Cookies are shared on .sourcelibrary.org so the session
// carries back (see CLAUDE.md "Authentication across subdomains").

function navigateToAccount() {
  if (typeof window === 'undefined') return;
  if (isTenantSubdomain(window.location.hostname)) {
    window.location.assign('https://sourcelibrary.org/account');
  } else {
    window.location.assign('/account');
  }
}

// Sign-in has no route on a tenant host, so this crosses to the apex and
// carries a callbackUrl back to the exact page the visitor was reading.
// The return hop is only permitted because auth.ts allows cross-subdomain
// redirects (src/lib/auth-redirect.ts) — without that half, NextAuth drops
// them on the main site instead.
function navigateToSignIn() {
  if (typeof window === 'undefined') return;
  window.location.assign(
    buildSignInHref(window.location.hostname, window.location.href)
  );
}

/**
 * Floating top-right control for embed/tenant pages.
 *
 * Has two responsibilities:
 *
 * 1. View options — cookie-backed toggles that strip AI-generated prose
 *    and pedagogical helpers from book pages. Requested by Paul Dijstelberge
 *    (BPH) who finds the default presentation off-putting for scholarly use:
 *    "Default with bells and whistles, possible to chose without".
 *
 * 2. Auth — avatar + Account/Sign out for authenticated visitors, and a
 *    Sign in item for anonymous ones. The main SiteHeader is stripped on
 *    embed routes so partner subdomains (bph.sourcelibrary.org, …) look like
 *    the partner's own site; this control is therefore the ONLY way in or
 *    out of a session on those hosts.
 *
 *    The reading room used to show anonymous visitors no sign-in affordance
 *    at all, on the reasoning that a partner reading room is a closed,
 *    sign-in-free surface. That is right for readers and wrong for the BPH's
 *    cataloguers, whose whole job lives on that subdomain: with no entry
 *    point they simply could not get in, and reported it as "I cannot find
 *    where to sign in" (#3468). Sign-in lives inside the dropdown rather
 *    than on the trigger button, so readers still see an unadorned reading
 *    room and only someone looking for an account finds one.
 *
 * Cookies are scoped to the current host (no Domain attr) so each subdomain
 * keeps independent preferences — a scholar can run BPH in scholar mode
 * without affecting how sourcelibrary.org renders for them.
 */

const COOKIE_HIDE_AI = 'sl_hide_ai';
const COOKIE_HIDE_GUIDE = 'sl_hide_guide';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

// BPH leads without AI prose by default; other tenants/the main site show it.
// Must mirror the detection in the root layout's VIEW_MODE_INIT_SCRIPT
// (src/app/layout.tsx).
function isBphSurface(): boolean {
  if (typeof window === 'undefined') return false;
  return /^bph\./.test(window.location.hostname)
    || /^\/embed\/bph(\/|$)/.test(window.location.pathname);
}

function readCookie(name: string): boolean {
  if (typeof document === 'undefined') return false;
  const row = document.cookie.split('; ').find(r => r.startsWith(name + '='));
  return row?.split('=')[1] === '1';
}

// Effective "hide AI summaries" state. The cookie is tri-state: '1' hide,
// '0' show, absent = default (BPH hides, everyone else shows).
function readHideAi(): boolean {
  if (typeof document === 'undefined') return false;
  const row = document.cookie.split('; ').find(r => r.startsWith(COOKIE_HIDE_AI + '='));
  const val = row?.split('=')[1];
  if (val === '1') return true;
  if (val === '0') return false;
  return isBphSurface();
}

// Build the catalogue-search destination. On the tenant subdomain (proxy
// rewrites every path to /embed/<tenant>) a relative /catalog?cq= resolves
// on-host and the proxy maps it to ?view=catalog. When we're rendering the
// raw /embed/<tenant> path (e.g. a sourcelibrary.org preview), a relative
// /catalog would escape to the GLOBAL search — a tenant-lockdown leak — so we
// target the explicit embed route instead. Either way the search stays within
// the tenant's own catalogue.
function catalogSearchUrl(query: string): string {
  const q = encodeURIComponent(query.trim());
  if (typeof window === 'undefined') return '/catalog';
  const embedMatch = window.location.pathname.match(/^\/embed\/([^/]+)/);
  if (embedMatch) {
    return `/embed/${embedMatch[1]}?view=catalog${q ? `&cq=${q}` : ''}`;
  }
  return `/catalog${q ? `?cq=${q}` : ''}`;
}

// Persist an explicit choice. We always write '0'/'1' (never delete) so an
// opt-in-to-show on BPH survives reload instead of falling back to the
// default-hidden state.
function writeCookie(name: string, on: boolean) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=${on ? '1' : '0'}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

export default function EmbedUserMenu() {
  const { data: session, status } = useStableSession();
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [hideAi, setHideAi] = useState(false);
  const [hideGuide, setHideGuide] = useState(false);
  // Catalogue search is a BPH affordance (the /catalog?cq= flow). Hydrated
  // after mount to keep the server HTML host-agnostic (ISR-safe).
  const [showSearch, setShowSearch] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const handleImgError = useCallback(() => setImgError(true), []);

  const submitSearch = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.location.assign(catalogSearchUrl(searchQuery));
  }, [searchQuery]);

  // Hydrate toggle state from cookies after mount. The server has already
  // rendered the book page using whatever the cookie said at request time;
  // this just keeps the checkbox UI in sync.
  useEffect(() => {
    setHideAi(readHideAi());
    setHideGuide(readCookie(COOKIE_HIDE_GUIDE));
    setShowSearch(isBphSurface());
  }, []);

  // Focus the field as it expands.
  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (status === 'loading') return null;

  // CSS-driven hiding: the inline script in embed/layout.tsx sets data
  // attributes on <html> at page-load time; the toggle handlers update them
  // directly so the change is instant. Cookies persist the preference for
  // the next page load. ISR-cached HTML is identical for all visitors —
  // only the html dataset (and CSS) differs between scholar and default
  // views, so cache hit rate stays the same.
  const toggleHideAi = () => {
    const next = !hideAi;
    setHideAi(next);
    writeCookie(COOKIE_HIDE_AI, next);
    document.documentElement.dataset.slHideAi = next ? '1' : '';
  };

  const toggleHideGuide = () => {
    const next = !hideGuide;
    setHideGuide(next);
    writeCookie(COOKIE_HIDE_GUIDE, next);
    document.documentElement.dataset.slHideGuide = next ? '1' : '';
  };

  const containerCls = 'fixed top-3 right-3 z-50 print:hidden flex items-center gap-2';

  const name = session?.user?.name || session?.user?.email || 'Account';
  const initials = session?.user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session?.user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div ref={menuRef} className={containerCls}>
      {showSearch && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitSearch();
          }}
          className="flex items-center"
        >
          {searchOpen ? (
            <div className="flex items-center bg-white/90 backdrop-blur-sm border border-border-light shadow-sm rounded-full pl-3 pr-1 py-0.5">
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setSearchOpen(false);
                    setSearchQuery('');
                  }
                }}
                placeholder="Search the catalogue…"
                aria-label="Search the catalogue"
                className="w-44 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none"
              />
              <button
                type="submit"
                aria-label="Search"
                className="w-7 h-7 rounded-full flex items-center justify-center text-secondary hover:text-primary"
              >
                <Search className="w-4 h-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Close search"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery('');
                }}
                className="w-7 h-7 rounded-full flex items-center justify-center text-muted hover:text-primary"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              aria-label="Search the catalogue"
              onClick={() => setSearchOpen(true)}
              className="flex items-center justify-center w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-border-light shadow-sm hover:bg-white transition-colors text-secondary hover:text-primary"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
            </button>
          )}
        </form>
      )}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-center w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm border border-border-light shadow-sm cursor-pointer hover:bg-white transition-colors"
        aria-label={session ? 'Account & view options' : 'Sign in & view options'}
      >
        {session ? (
          session.user?.image && !imgError ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.user.image}
              alt=""
              className="w-7 h-7 rounded-full"
              onError={handleImgError}
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-accent-rust text-white text-xs font-medium flex items-center justify-center">
              {initials}
            </div>
          )
        ) : (
          <div className="w-7 h-7 rounded-full flex items-center justify-center text-secondary">
            <Settings className="w-4 h-4" aria-hidden="true" />
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 rounded-md bg-white border border-border-light shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border-light/60">
            <div className="text-xs text-muted mb-1.5">View</div>
            <label className="flex items-start gap-2 py-1 cursor-pointer text-sm text-secondary hover:text-primary">
              <input
                type="checkbox"
                checked={hideAi}
                onChange={toggleHideAi}
                className="mt-0.5"
              />
              <span>Hide AI introductions &amp; summaries</span>
            </label>
            <label className="flex items-start gap-2 py-1 cursor-pointer text-sm text-secondary hover:text-primary">
              <input
                type="checkbox"
                checked={hideGuide}
                onChange={toggleHideGuide}
                className="mt-0.5"
              />
              <span>Hide reading guide &amp; pedagogical helpers</span>
            </label>
          </div>

          {/* Anonymous visitors get a way in. This is the only one on a
              partner subdomain — the SiteHeader is stripped there — so
              removing it strands the BPH cataloguers (#3468). */}
          {!session && (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigateToSignIn();
              }}
              className="flex items-center gap-2 w-full text-left px-3 py-2 text-sm text-secondary hover:bg-cream/60"
            >
              <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
              Sign in
            </button>
          )}

          {/* Signed-in users keep Account + Sign out. */}
          {session && (
            <>
              <div className="px-3 py-2 border-b border-border-light/60">
                <div className="text-xs text-muted truncate">Signed in as</div>
                <div className="text-sm font-medium text-primary truncate">{name}</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  navigateToAccount();
                }}
                className="block w-full text-left px-3 py-2 text-sm text-secondary hover:bg-cream/60"
              >
                Account
              </button>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="block w-full text-left px-3 py-2 text-sm text-secondary hover:bg-cream/60 border-t border-border-light/60"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
