'use client';

import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import Link from 'next/link';
import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * Minimal user menu for embed/tenant pages.
 *
 * The main SiteHeader is intentionally stripped on embed routes so partner
 * subdomains (e.g. bph.sourcelibrary.org) look like the partner's own site
 * rather than ours. That left librarians like Paul with no way to sign out
 * once authenticated. This is a floating top-right control: a sign-in link
 * for anonymous users, an avatar + dropdown (with Account, Sign out) for
 * authenticated ones.
 */
export default function EmbedUserMenu() {
  const { data: session, status } = useStableSession();
  const [isOpen, setIsOpen] = useState(false);
  const [imgError, setImgError] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const handleImgError = useCallback(() => setImgError(true), []);

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

  const containerCls =
    'fixed top-3 right-3 z-50 print:hidden';

  if (!session) {
    return (
      <div className={containerCls}>
        <Link
          href="/auth/signin"
          className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-md bg-white/90 backdrop-blur-sm border border-border-light text-secondary hover:text-primary shadow-sm transition-colors"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const name = session.user?.name || session.user?.email || 'Account';
  const initials = session.user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session.user?.email?.[0]?.toUpperCase() || '?';

  return (
    <div ref={menuRef} className={containerCls}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-full bg-white/90 backdrop-blur-sm border border-border-light shadow-sm hover:bg-white transition-colors"
        aria-label="Account menu"
      >
        {session.user?.image && !imgError ? (
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
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-56 rounded-md bg-white border border-border-light shadow-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-border-light/60">
            <div className="text-xs text-muted truncate">Signed in as</div>
            <div className="text-sm font-medium text-primary truncate">{name}</div>
          </div>
          <Link
            href="/account"
            className="block px-3 py-2 text-sm text-secondary hover:bg-cream/60"
            onClick={() => setIsOpen(false)}
          >
            Account
          </Link>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="block w-full text-left px-3 py-2 text-sm text-secondary hover:bg-cream/60 border-t border-border-light/60"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
