'use client';

import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Settings } from 'lucide-react';

// On tenant subdomains, /auth/* and /account are caught by the proxy.ts
// rewrite (it sends every non-/embed/, non-/api/, non-/_next/ path to
// /embed/<tenant>), so the link silently lands on the tenant homepage —
// from the user's POV "nothing happens". Route those off to the main
// host instead. Cookies are shared on .sourcelibrary.org so the session
// carries back (see CLAUDE.md "Authentication across subdomains").
function isTenantSubdomain(host: string): boolean {
  return host.endsWith('.sourcelibrary.org') && host !== 'sourcelibrary.org';
}

function navigateToSignIn() {
  if (typeof window === 'undefined') return;
  if (isTenantSubdomain(window.location.hostname)) {
    const callbackUrl = encodeURIComponent(window.location.href);
    window.location.assign(`https://sourcelibrary.org/auth/signin?callbackUrl=${callbackUrl}`);
  } else {
    window.location.assign('/auth/signin');
  }
}

function navigateToAccount() {
  if (typeof window === 'undefined') return;
  if (isTenantSubdomain(window.location.hostname)) {
    window.location.assign('https://sourcelibrary.org/account');
  } else {
    window.location.assign('/account');
  }
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
 * 2. Auth — Sign in link for anonymous visitors, avatar + Account/Sign out
 *    for authenticated ones. The main SiteHeader is stripped on embed routes
 *    so partner subdomains (bph.sourcelibrary.org, …) look like the
 *    partner's own site; this control is the only sign-out affordance.
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
  const menuRef = useRef<HTMLDivElement>(null);
  const handleImgError = useCallback(() => setImgError(true), []);

  // Hydrate toggle state from cookies after mount. The server has already
  // rendered the book page using whatever the cookie said at request time;
  // this just keeps the checkbox UI in sync.
  useEffect(() => {
    setHideAi(readHideAi());
    setHideGuide(readCookie(COOKIE_HIDE_GUIDE));
  }, []);

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

  const containerCls = 'fixed top-3 right-3 z-50 print:hidden';

  const name = session?.user?.name || session?.user?.email || 'Account';
  const initials = session?.user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session?.user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div ref={menuRef} className={containerCls}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm border border-border-light shadow-sm hover:bg-white transition-colors"
        aria-label={session ? 'Account & view options' : 'View options'}
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

          {session ? (
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
          ) : (
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                navigateToSignIn();
              }}
              className="block w-full text-left px-3 py-2 text-sm text-secondary hover:bg-cream/60"
            >
              Sign in
            </button>
          )}
        </div>
      )}
    </div>
  );
}
