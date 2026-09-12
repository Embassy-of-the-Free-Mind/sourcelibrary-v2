'use client';

import { signOut } from 'next-auth/react';
import { useStableSession } from '@/hooks/useStableSession';
import Link from 'next/link';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocale, localePath } from '@/lib/i18n';

interface UserMenuProps {
  variant?: 'hero' | 'default';
}

export default function UserMenu({ variant = 'default' }: UserMenuProps) {
  const { data: session, status } = useStableSession();
  const locale = useLocale();
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

  // During loading, render an invisible placeholder the same size as the avatar
  // to prevent layout shift. SSR also hits this path (no session during SSR).
  if (status === 'loading') {
    return <div className="w-8 h-8" />;
  }

  // Show sign-in link for anonymous users.
  if (!session) {
    const textColor = variant === 'hero' ? 'text-white/80 hover:text-white' : '';
    const textStyle = variant === 'hero' ? {} : { color: 'var(--text-muted)' };

    return (
      <Link
        href={localePath('/auth/signin', locale)}
        className={`text-sm font-medium transition-colors hover:opacity-80 ${textColor}`}
        style={textStyle}
      >
        {locale === 'es' ? 'Iniciar sesión' : 'Sign in'}
      </Link>
    );
  }

  // Authenticated user: show avatar + dropdown.
  // Accept admin OR superadmin — auth.ts assigns 'superadmin' to anyone in
  // PLATFORM_ADMIN_EMAILS, so a `role === 'admin'` check was hiding the
  // admin links from the very people who own the platform.
  const role = (session.user as { role?: string } | undefined)?.role;
  const isAdmin = role === 'admin' || role === 'superadmin';
  const isMember = (session.user as any)?.membership != null;

  const initials = session.user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || session.user?.email?.[0]?.toUpperCase() || '?';

  // The white-on-translucent-white styling below is only legible over the
  // dark/transparent 'hero' headers. On the default cream header it rendered
  // the initials fallback invisible (white text on a near-white bar) — which
  // is what every reader sees whenever the Google avatar image fails to load,
  // e.g. lh3.googleusercontent intermittently 503s in-browser.
  const onDark = variant === 'hero';
  const avatarBorder = isMember
    ? 'var(--accent-gold)'
    : onDark ? 'rgba(255,255,255,0.3)' : 'var(--border-light)';
  const fallbackStyle = onDark
    ? {
        background: isMember ? 'rgba(201,168,108,0.2)' : 'rgba(255,255,255,0.2)',
        color: '#fff',
        borderColor: avatarBorder,
      }
    : {
        background: isMember ? 'rgba(201,168,108,0.2)' : 'var(--bg-warm)',
        color: 'var(--text-primary)',
        borderColor: avatarBorder,
      };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Account menu"
        className="flex items-center gap-2 cursor-pointer focus:outline-none"
      >
        {session.user?.image && !imgError ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt={session.user.name || 'User'}
            data-avatar="true"
            className="w-8 h-8 rounded-full border-2"
            style={{ borderColor: avatarBorder }}
            onError={handleImgError}
          />
        ) : (
          <div
            data-avatar="true"
            className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2"
            style={fallbackStyle}
          >
            {initials}
          </div>
        )}
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 rounded-xl shadow-lg py-2 z-50"
          style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}
        >
          <div className="px-4 py-2 border-b" style={{ borderColor: 'var(--border-light)' }}>
            <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
              {session.user?.name}
            </p>
            <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
              {session.user?.email}
            </p>
          </div>
          <div className="py-1">
            <Link
              href="/account"
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              Account
            </Link>
            <Link
              href="/favorites"
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              Favorites
            </Link>
            <Link
              href="/lists"
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              My Lists
            </Link>
            <Link
              href="/reading-history"
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              Reading History
            </Link>
            <Link
              href={localePath('/support', locale)}
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              Support
            </Link>
            {isAdmin && (
              <>
                <Link
                  href="/analytics"
                  className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setIsOpen(false)}
                >
                  Analytics
                </Link>
                {/* People first. Introductions is what readers WROTE about
                    themselves and who offered to help — it lived only inside
                    AdminNav, which renders on /admin/* pages, so you could only
                    reach it once you were already there. 216 volunteers had
                    written in and none had been answered; a menu with no door
                    to them is part of why. Duplicates and API Keys moved out to
                    make room: they are deep tools that belong in the admin nav,
                    not in a menu opened twenty times a day. */}
                <Link
                  href="/admin/introductions"
                  className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setIsOpen(false)}
                >
                  Introductions
                </Link>
                <Link
                  href="/admin/users"
                  className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setIsOpen(false)}
                >
                  Users
                </Link>
                <Link
                  href="/feedback"
                  className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--text-primary)' }}
                  onClick={() => setIsOpen(false)}
                >
                  Feedback
                </Link>
              </>
            )}
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="w-full text-left px-4 py-2 text-sm hover:opacity-70 transition-opacity cursor-pointer"
              style={{ color: 'var(--accent-rust)' }}
            >
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
