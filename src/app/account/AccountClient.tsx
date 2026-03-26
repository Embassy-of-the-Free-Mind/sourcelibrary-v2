'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { BookOpen, Heart, LogOut, Crown, Users } from 'lucide-react';
import { toast } from 'sonner';

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
  const [managingBilling, setManagingBilling] = useState(false);

  // Member profile editing
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [visible, setVisible] = useState(true);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  useEffect(() => {
    fetch('/api/membership').then(r => r.json()).then(data => {
      if (data.expiresAt) setExpiresAt(new Date(data.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }));
    });
  }, []);

  // Load member profile
  useEffect(() => {
    if (!isMember) return;
    fetch('/api/membership/profile').then(r => r.json()).then(data => {
      setDisplayName(data.displayName || '');
      setBio(data.bio || '');
      setVisible(data.visible !== false);
      setProfileLoaded(true);
    });
  }, [isMember]);

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      await fetch('/api/membership/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, bio, visible }),
      });
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingProfile(false);
    }
  };

  const openBillingPortal = async () => {
    setManagingBilling(true);
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      setManagingBilling(false);
    }
  };

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
          <>
          <div
            className="rounded-xl p-6 mb-6"
            style={{ background: 'var(--bg-warm)', border: '1px solid var(--accent-sage)' }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Crown className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Supporting Member</p>
                  {expiresAt && <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Renews {expiresAt}</p>}
                </div>
              </div>
              <button
                onClick={openBillingPortal}
                disabled={managingBilling}
                className="text-sm hover:opacity-70 transition-opacity disabled:opacity-50"
                style={{ color: 'var(--text-muted)' }}
              >
                {managingBilling ? 'Opening...' : 'Manage'}
              </button>
            </div>
          </div>

          {/* Member profile for the members page */}
          {profileLoaded && (
            <div
              className="rounded-xl p-6 mb-6"
              style={{ background: 'white', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                  Members page profile
                </h2>
                <Link
                  href="/support"
                  className="text-sm hover:opacity-70 transition-opacity flex items-center gap-1"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Users className="w-3.5 h-3.5" />
                  Support page
                </Link>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    Display name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder={user.name || 'Your name'}
                    maxLength={100}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--bg-cream)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div>
                  <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                    One-line bio <span className="opacity-50">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={bio}
                    onChange={e => setBio(e.target.value)}
                    placeholder="Scholar, collector, curious reader..."
                    maxLength={200}
                    className="w-full px-3 py-2 rounded-lg text-sm"
                    style={{ background: 'var(--bg-cream)', border: '1px solid var(--border-light)', color: 'var(--text-primary)' }}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={visible}
                      onChange={e => setVisible(e.target.checked)}
                      className="rounded"
                    />
                    Show me on the members page
                  </label>
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="px-4 py-1.5 rounded-lg text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--text-primary)', color: 'white' }}
                  >
                    {savingProfile ? 'Saving...' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}
          </>
        ) : (
          <Link
            href="/support"
            className="block rounded-xl p-6 mb-6 hover:opacity-90 transition-opacity"
            style={{ background: 'var(--accent-rust)', color: 'white' }}
          >
            <p className="font-medium">Support the Library</p>
            <p className="text-sm opacity-80">Help fund the digitization and translation of ancient texts</p>
          </Link>
        )}

        {/* Quick links */}
        <div
          className="rounded-xl divide-y mb-6"
          style={{ background: 'white', border: '1px solid var(--border-light)', borderColor: 'var(--border-light)' }}
        >
          <Link
            href="/reading-history"
            className="flex items-center gap-3 px-6 py-4 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--text-primary)' }}
          >
            <BookOpen className="w-5 h-5" style={{ color: 'var(--accent-sage)' }} />
            <span>Reading History</span>
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
