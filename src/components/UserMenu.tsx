'use client';

import { useSession, signOut } from 'next-auth/react';
import Link from 'next/link';
import { useState, useRef, useEffect } from 'react';

interface UserMenuProps {
  variant?: 'hero' | 'default';
}

export default function UserMenu({ variant = 'default' }: UserMenuProps) {
  const { data: session, status } = useSession();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (status === 'loading') {
    return (
      <div className="w-8 h-8 rounded-full bg-white/20 animate-pulse" />
    );
  }

  if (!session) {
    const baseClasses = "px-4 py-2 rounded-full text-sm font-medium transition-colors";
    const heroClasses = "bg-white/10 backdrop-blur-sm text-white hover:bg-white/20 border border-white/20";
    const defaultClasses = "text-white hover:opacity-80";

    return (
      <Link
        href="/auth/signin"
        className={`${baseClasses} ${variant === 'hero' ? heroClasses : defaultClasses}`}
      >
        Sign In
      </Link>
    );
  }

  const initials = session.user?.name
    ?.split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 focus:outline-none"
      >
        {session.user?.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.user.image}
            alt={session.user.name || 'User'}
            className="w-8 h-8 rounded-full border-2 border-white/30"
          />
        ) : (
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-white text-sm font-medium border-2 border-white/30">
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
              href="/analytics"
              className="block px-4 py-2 text-sm hover:opacity-70 transition-opacity"
              style={{ color: 'var(--text-primary)' }}
              onClick={() => setIsOpen(false)}
            >
              Analytics
            </Link>
            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              className="w-full text-left px-4 py-2 text-sm hover:opacity-70 transition-opacity"
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
