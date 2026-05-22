'use client';

import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import { useState, useRef, useEffect, useCallback } from 'react';
import { LogOut } from 'lucide-react';

/**
 * Floating user widget rendered on tenant subdomains (e.g. bph.sourcelibrary.org).
 *
 * The standard SiteHeader/UserMenu is hidden in embed mode (CSS in globals.css
 * targeting body:has(.embed-mode)), which left tenant librarians with no way
 * to sign out without leaving the subdomain. This widget gives authenticated
 * users a minimal "you're signed in as X — sign out" affordance scoped to the
 * subdomain.
 *
 * Subdomain lockdown rules (CLAUDE.md): we never link to sourcelibrary.org/...
 * from inside a tenant subdomain. signOut's callbackUrl='/' keeps the user on
 * the same host. We intentionally omit Account / Favorites links here — they
 * resolve off-subdomain and would leak.
 *
 * Anonymous visitors render null — public BPH browsing shouldn't expose any
 * Source Library account chrome.
 */
export default function TenantUserChrome() {
  const { data: session, status } = useStableSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [handleClickOutside]);

  if (status !== 'authenticated' || !session?.user) return null;

  const name = session.user.name || session.user.email || 'Account';
  const initials =
    session.user.name
      ?.split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || session.user.email?.[0]?.toUpperCase() || '?';

  return (
    <div
      ref={ref}
      className="fixed top-3 right-3 z-40"
      data-tenant-user-chrome
    >
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-full bg-white/95 border border-border-light shadow-sm hover:bg-white text-xs font-medium text-primary transition-colors"
        aria-label="Account menu"
      >
        <span
          className="inline-flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-semibold text-white"
          style={{ background: 'var(--accent-rust, #b25e2d)' }}
        >
          {initials}
        </span>
        <span className="hidden sm:inline max-w-[12rem] truncate">{name}</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-lg shadow-lg border border-border-light bg-white py-2">
          <div className="px-3 py-2 border-b border-border-light">
            <p className="text-sm font-medium text-primary truncate">{session.user.name}</p>
            <p className="text-xs text-muted truncate">{session.user.email}</p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-accent-rust hover:bg-warm transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
