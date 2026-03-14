'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Heart, LogOut, Crown } from 'lucide-react';

interface AccountClientProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

export default function AccountClient({ user }: AccountClientProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/membership').then(r => r.json()).then(data => {
      if (data.expiresAt) setExpiresAt(new Date(data.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
    });
  }, []);

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <div className="max-w-xl mx-auto px-4 py-16">
        <h1 className="text-2xl font-serif font-medium mb-8" style={{ color: 'var(--text-primary)' }}>
          Account
        </h1>

        {/* Profile card */}
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: 'white', border: '1px solid var(--border-light)' }}
        >
          <div className="flex items-center gap-4 mb-4">
            {user.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={user.image}
                alt={user.name || 'Profile'}
                className="w-14 h-14 rounded-full"
              />
            ) : (
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-medium"
                style={{ background: 'var(--bg-warm)', color: 'var(--text-secondary)' }}
              >
                {user.name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
            <div>
              {user.name && (
                <p className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>
                  {user.name}
                </p>
              )}
              {user.email && (
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {user.email}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Membership */}
        {isMember ? (
          <div
            className="rounded-xl p-6 mb-6"
            style={{ background: 'var(--bg-warm)', border: '1px solid var(--accent-sage)' }}
          >
            <div className="flex items-center gap-3">
              <Crown className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
              <div>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Ficino Society Member</p>
                {expiresAt && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Renews {expiresAt}</p>}
              </div>
            </div>
          </div>
        ) : (
          <Link
            href="/ficino-society"
            className="block rounded-xl p-6 mb-6 hover:opacity-90 transition-opacity"
            style={{ background: 'var(--accent-rust)', color: 'white' }}
          >
            <p className="font-medium">Join the Ficino Society</p>
            <p className="text-sm opacity-80">$100/year — high-res downloads, prints, API access</p>
          </Link>
        )}

        {/* Quick links */}
        <div
          className="rounded-xl divide-y mb-6"
          style={{ background: 'white', border: '1px solid var(--border-light)', borderColor: 'var(--border-light)' }}
        >
          <Link
            href="/bookshelf"
            className="flex items-center gap-3 px-6 py-4 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-primary)' }}
          >
            <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
            <span>Bookshelf</span>
          </Link>
          <Link
            href="/favorites"
            className="flex items-center gap-3 px-6 py-4 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-primary)' }}
          >
            <Heart className="w-5 h-5" style={{ color: 'var(--accent-rust)' }} />
            <span>Favorites</span>
          </Link>
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut({ callbackUrl: '/' })}
          className="flex items-center gap-3 w-full px-6 py-4 rounded-xl hover:opacity-70 transition-opacity"
          style={{
            background: 'white',
            border: '1px solid var(--border-light)',
            color: 'var(--accent-rust)',
          }}
        >
          <LogOut className="w-5 h-5" />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
