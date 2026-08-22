'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Bookmark, Crown, Heart, LogOut, Users } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/layout/SiteHeader';
import ProfilePhotoEditor from '@/components/account/ProfilePhotoEditor';

interface AccountClientProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

// Shared field styling — 16px font is deliberate (inputs under 16px make
// mobile Safari zoom the page on focus).
const inputStyle = {
  fontSize: '16px',
  background: 'var(--bg-cream)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-primary)',
} as const;

function Eyebrow({ children, className = 'text-accent-rust' }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-medium uppercase tracking-[0.18em] mb-2 ${className}`}>
      {children}
    </p>
  );
}

export default function AccountClient({ user }: AccountClientProps) {
  const { data: session, update } = useSession();
  const isMember = (session?.user as any)?.membership != null;
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [managingBilling, setManagingBilling] = useState(false);

  // Reader profile — the four things /welcome asks for. The welcome page tells
  // readers they can change their answers here, so this editor is what makes
  // that sentence true; don't remove one without the other.
  const [readerName, setReaderName] = useState(user.name || '');
  const [aboutYou, setAboutYou] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState('');
  const [helpDescription, setHelpDescription] = useState('');
  const [readerLoaded, setReaderLoaded] = useState(false);
  const [savingReader, setSavingReader] = useState(false);

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

  useEffect(() => {
    fetch('/api/me/welcome')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return;
        setReaderName(data.name || '');
        setAboutYou(data.about_you || '');
        setPreferredLanguage(data.preferred_language || '');
        setHelpDescription(data.help_description || '');
      })
      .catch(() => {})
      .finally(() => setReaderLoaded(true));
  }, []);

  const saveReaderProfile = async () => {
    setSavingReader(true);
    try {
      const res = await fetch('/api/me/welcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: readerName.trim(),
          about_you: aboutYou.trim(),
          preferred_language: preferredLanguage.trim(),
          help_description: helpDescription.trim(),
        }),
      });
      if (!res.ok) throw new Error();
      await update();
      toast.success('Profile updated');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSavingReader(false);
    }
  };

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

  const libraryTiles = [
    {
      href: '/favorites',
      icon: Heart,
      iconClass: 'text-accent-rust',
      tint: 'bg-accent-rust/8',
      title: 'Favorites',
      blurb: 'Books, pages & images you’ve liked',
    },
    {
      href: '/lists',
      icon: Bookmark,
      iconClass: 'text-accent-gold',
      tint: 'bg-accent-gold/10',
      title: 'Lists',
      blurb: 'Collections of your own making',
    },
    {
      href: '/reading-history',
      icon: BookOpen,
      iconClass: 'text-accent-sage',
      tint: 'bg-accent-sage/12',
      title: 'Reading history',
      blurb: 'Pick up where you left off',
    },
  ];

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />
      <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-20">

        {/* ── Identity ─────────────────────────────────────────── */}
        <header className="flex items-center gap-5 sm:gap-7">
          <ProfilePhotoEditor name={user.name} initialImage={user.image} size="lg" />
          <div className="min-w-0">
            <Eyebrow>Your account</Eyebrow>
            <h1
              className="font-serif text-3xl sm:text-4xl leading-tight truncate"
              style={{ color: 'var(--text-primary)' }}
            >
              {user.name || 'Reader'}
            </h1>
            {user.email && (
              <p className="text-sm mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
                {user.email}
              </p>
            )}
            {isMember && (
              <span className="inline-flex items-center gap-1.5 mt-2.5 px-2.5 py-1 text-xs font-medium bg-accent-sage/12 text-accent-sage-dark">
                <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                Supporting Member{expiresAt ? ` · renews ${expiresAt}` : ''}
              </span>
            )}
          </div>
        </header>

        {/* ── Your library ─────────────────────────────────────── */}
        <section className="mt-12 sm:mt-14">
          <Eyebrow className="text-accent-gold">Your library</Eyebrow>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {libraryTiles.map(tile => (
              <Link
                key={tile.href}
                href={tile.href}
                className="group flex sm:flex-col items-center sm:items-start gap-3 p-4 sm:p-5 transition-all hover:shadow-md"
                style={{ background: 'white', border: '1px solid var(--border-light)' }}
              >
                <span className={`flex items-center justify-center w-9 h-9 shrink-0 ${tile.tint}`}>
                  <tile.icon className={`w-4.5 h-4.5 ${tile.iconClass}`} aria-hidden="true" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1 font-medium text-[15px]" style={{ color: 'var(--text-primary)' }}>
                    {tile.title}
                    <ArrowRight
                      className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all"
                      style={{ color: 'var(--text-muted)' }}
                      aria-hidden="true"
                    />
                  </span>
                  <span className="block text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {tile.blurb}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* ── Reader profile ───────────────────────────────────── */}
        <section id="reader-profile" className="mt-12 sm:mt-14 scroll-mt-24">
          <Eyebrow>Reader profile</Eyebrow>
          <p className="text-sm mb-4 max-w-md" style={{ color: 'var(--text-muted)' }}>
            What you told us when you joined. Change it whenever you like — every field is optional.
          </p>

          <div className="p-5 sm:p-6" style={{ background: 'white', border: '1px solid var(--border-light)' }}>
            {!readerLoaded ? (
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
            ) : (
              <div className="space-y-5">
                <div>
                  <label htmlFor="reader-name" className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Your name
                  </label>
                  <input
                    id="reader-name"
                    type="text"
                    value={readerName}
                    onChange={e => setReaderName(e.target.value)}
                    autoComplete="name"
                    maxLength={100}
                    placeholder="Your name"
                    className="w-full px-3 py-2"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="reader-about" className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    Who you are, and what interests you about Source Library
                  </label>
                  <textarea
                    id="reader-about"
                    rows={4}
                    value={aboutYou}
                    onChange={e => setAboutYou(e.target.value)}
                    maxLength={4000}
                    placeholder="Your background, the authors or traditions you're drawn to, questions you're chasing…"
                    className="w-full px-3 py-2 resize-y"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="reader-language" className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    The language you prefer to read in
                  </label>
                  <input
                    id="reader-language"
                    type="text"
                    value={preferredLanguage}
                    onChange={e => setPreferredLanguage(e.target.value)}
                    maxLength={60}
                    placeholder="e.g. English, Spanish, Portuguese, Chinese…"
                    className="w-full px-3 py-2"
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label htmlFor="reader-help" className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    How you&rsquo;d like to help, if at all
                  </label>
                  <textarea
                    id="reader-help"
                    rows={3}
                    value={helpDescription}
                    onChange={e => setHelpDescription(e.target.value)}
                    maxLength={2000}
                    placeholder="Reviewing translations, annotating texts, suggesting books, writing, coding, study groups — or just here to read."
                    className="w-full px-3 py-2 resize-y"
                    style={inputStyle}
                  />
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={saveReaderProfile}
                    disabled={savingReader}
                    className="px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ background: 'var(--text-primary)', color: 'white' }}
                  >
                    {savingReader ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── Membership ───────────────────────────────────────── */}
        <section className="mt-12 sm:mt-14">
          <Eyebrow className="text-accent-sage-dark">Membership</Eyebrow>

          {isMember ? (
            <div style={{ background: 'white', border: '1px solid var(--border-light)' }}>
              <div className="flex items-center justify-between gap-4 p-5 sm:p-6">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex items-center justify-center w-9 h-9 shrink-0 bg-accent-sage/12">
                    <Crown className="w-4.5 h-4.5 text-accent-sage" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium" style={{ color: 'var(--text-primary)' }}>Supporting Member</p>
                    {expiresAt && <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>Renews {expiresAt}</p>}
                  </div>
                </div>
                <button
                  onClick={openBillingPortal}
                  disabled={managingBilling}
                  className="text-sm shrink-0 hover:opacity-70 transition-opacity disabled:opacity-50 underline underline-offset-4"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {managingBilling ? 'Opening…' : 'Manage billing'}
                </button>
              </div>

              {/* Member profile for the members page */}
              {profileLoaded && (
                <div className="p-5 sm:p-6" style={{ borderTop: '1px solid var(--border-light)' }}>
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                      Members page profile
                    </h2>
                    <Link
                      href="/support"
                      className="text-sm hover:opacity-70 transition-opacity flex items-center gap-1"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      <Users className="w-3.5 h-3.5" aria-hidden="true" />
                      Support page
                    </Link>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        Display name
                      </label>
                      <input
                        type="text"
                        value={displayName}
                        onChange={e => setDisplayName(e.target.value)}
                        placeholder={user.name || 'Your name'}
                        maxLength={100}
                        className="w-full px-3 py-2"
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label className="block text-xs mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        One-line bio <span className="opacity-50">(optional)</span>
                      </label>
                      <input
                        type="text"
                        value={bio}
                        onChange={e => setBio(e.target.value)}
                        placeholder="Scholar, collector, curious reader..."
                        maxLength={200}
                        className="w-full px-3 py-2"
                        style={inputStyle}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                        <input
                          type="checkbox"
                          checked={visible}
                          onChange={e => setVisible(e.target.checked)}
                        />
                        Show me on the members page
                      </label>
                      <button
                        onClick={saveProfile}
                        disabled={savingProfile}
                        className="px-5 py-2 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                        style={{ background: 'var(--text-primary)', color: 'white' }}
                      >
                        {savingProfile ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Link
              href="/support"
              className="group flex items-center justify-between gap-4 p-5 sm:p-6 transition-opacity hover:opacity-95"
              style={{ background: 'var(--accent-rust)', color: 'white' }}
            >
              <span>
                <span className="block font-serif text-xl">Support the Library</span>
                <span className="block text-sm opacity-80 mt-1">
                  Help fund the digitization and translation of ancient texts
                </span>
              </span>
              <ArrowRight className="w-5 h-5 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          )}
        </section>

        {/* ── Sign out ─────────────────────────────────────────── */}
        <div
          className="flex items-center justify-between gap-4 mt-14 pt-6"
          style={{ borderTop: '1px solid var(--border-light)' }}
        >
          {user.email ? (
            <p className="text-xs truncate" style={{ color: 'var(--text-faint)' }}>
              Signed in as {user.email}
            </p>
          ) : <span />}
          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            className="flex items-center gap-2 text-sm shrink-0 hover:opacity-70 transition-opacity"
            style={{ color: 'var(--accent-rust)' }}
          >
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
