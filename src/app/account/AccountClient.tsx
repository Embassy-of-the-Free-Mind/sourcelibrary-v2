'use client';

import { signOut, useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Bookmark, Crown, Heart, LogOut, Users } from 'lucide-react';
import { toast } from 'sonner';
import SiteHeader from '@/components/layout/SiteHeader';
import ProfilePhotoEditor from '@/components/account/ProfilePhotoEditor';
import { likes } from '@/lib/api-client';
import { useIdentity } from '@/hooks/useIdentity';

interface AccountClientProps {
  user: {
    name: string | null;
    email: string | null;
    image: string | null;
  };
}

// The account page. Layout mirrors the site's content pages exactly —
// ContentHeader's dark hero treatment (same gradient family, same
// container-standard width, same px-6 md:px-12 padding) over a cream body.
// The hero backdrop is a mosaic of images the reader has LIKED, so the page
// is decorated by their own taste in the collection; with no likes yet it
// falls back to the house dark gradient.

// Shared field styling — 16px font is deliberate (inputs under 16px make
// mobile Safari zoom the page on focus).
const inputStyle = {
  fontSize: '16px',
  background: 'var(--bg-cream)',
  border: '1px solid var(--border-light)',
  color: 'var(--text-primary)',
} as const;

/** Same-origin form of a liked-image crop URL. The likes API returns absolute
 *  sourcelibrary.org URLs; relative ones render on previews too (CSP allows
 *  'self', not the production host, on a preview domain). */
function toRelative(url: string): string {
  return url.replace(/^https:\/\/(www\.)?sourcelibrary\.org/, '');
}

interface LikedImageItem { croppedUrl?: string }
interface LikedBookItem { thumbnail?: string }

export default function AccountClient({ user }: AccountClientProps) {
  const { data: session, update } = useSession();
  const identity = useIdentity();
  const isMember = (session?.user as any)?.membership != null;
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [managingBilling, setManagingBilling] = useState(false);

  // Hero mosaic + favorites-tile thumbnails, from the reader's likes
  const [likedThumbs, setLikedThumbs] = useState<string[]>([]);
  const [listsInfo, setListsInfo] = useState<{ count: number; covers: string[] } | null>(null);

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

  // Liked images (then liked books as backfill) → hero mosaic tiles
  useEffect(() => {
    if (identity.loading || !identity.id) return;
    let cancelled = false;
    (async () => {
      const urls: string[] = [];
      try {
        const imgs = await likes.getMine<LikedImageItem>({ type: 'image', visitorId: identity.id });
        for (const item of imgs.items || []) {
          if (item.croppedUrl) urls.push(toRelative(item.croppedUrl));
        }
      } catch { /* mosaic is decoration — never block the page on it */ }
      if (urls.length < 6) {
        try {
          const books = await likes.getMine<LikedBookItem>({ type: 'book', visitorId: identity.id });
          for (const item of books.items || []) {
            if (item.thumbnail) urls.push(toRelative(item.thumbnail));
          }
        } catch { /* same */ }
      }
      if (!cancelled) setLikedThumbs(urls.slice(0, 14));
    })();
    return () => { cancelled = true; };
  }, [identity.loading, identity.id]);

  // Lists tile: count + cover collage. Raw fetch so this page doesn't depend
  // on the lists feature being deployed — a 404 just leaves the tile plain.
  useEffect(() => {
    fetch('/api/lists?covers=true')
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data?.lists) return;
        const covers = data.lists.flatMap((l: { covers?: string[] }) => l.covers || []).slice(0, 3);
        setListsInfo({ count: data.lists.length, covers });
      })
      .catch(() => {});
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

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <SiteHeader variant="light" />

      {/* ── Hero — the reader's shelf ─────────────────────────────
          Same treatment as ContentHeader: dark gradient, standard
          container, big serif. Backdrop = what they've liked. */}
      <div className="relative overflow-hidden text-white py-14 md:py-20">
        {likedThumbs.length >= 4 ? (
          <>
            <div className="absolute inset-0 grid grid-cols-4 sm:grid-cols-7">
              {likedThumbs.map((url, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={url} alt="" aria-hidden="true" className="w-full h-full object-cover" loading="lazy" decoding="async" />
              ))}
            </div>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top, rgba(26,22,18,0.95) 0%, rgba(26,22,18,0.82) 40%, rgba(26,22,18,0.62) 100%)' }} />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-b from-[#2a1f17] to-[#1a1612]" />
        )}

        <div className="relative w-full max-w-[var(--container-standard)] mx-auto px-6 md:px-12 animate-fade-in-up">
          <div className="flex items-center gap-5 md:gap-8">
            <ProfilePhotoEditor name={user.name} initialImage={user.image} size="lg" theme="dark" />
            <div className="min-w-0">
              <h1 className="font-serif text-4xl md:text-5xl tracking-tight truncate drop-shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
                {user.name || 'Reader'}
              </h1>
              <div className="flex items-center gap-3 flex-wrap mt-2">
                {user.email && (
                  <p className="text-sm text-stone-400 truncate">{user.email}</p>
                )}
                {isMember && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-medium text-stone-200" style={{ background: 'rgba(245,240,232,0.12)' }}>
                    <Crown className="w-3.5 h-3.5 text-accent-gold" aria-hidden="true" />
                    Supporting Member{expiresAt ? ` · renews ${expiresAt}` : ''}
                  </span>
                )}
              </div>
              {likedThumbs.length >= 4 && (
                <p className="text-xs text-stone-500 mt-3 hidden sm:block">
                  Backdrop: images you&rsquo;ve liked in the library
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-[var(--container-standard)] mx-auto px-6 md:px-12 py-12">

        {/* ── Your library ───────────────────────────────────── */}
        <section>
          <h2 className="font-serif text-2xl md:text-3xl mb-6" style={{ color: 'var(--text-primary)' }}>
            Your library
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Link
              href="/favorites"
              className="group p-5 md:p-6 transition-all hover:shadow-md"
              style={{ background: 'white', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <Heart className="w-5 h-5 text-accent-rust" aria-hidden="true" />
                {likedThumbs.length > 0 && (
                  <span className="flex -space-x-2">
                    {likedThumbs.slice(0, 3).map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" aria-hidden="true" data-avatar="true" className="w-7 h-7 rounded-full object-cover" style={{ border: '2px solid white' }} loading="lazy" />
                    ))}
                  </span>
                )}
              </div>
              <p className="font-medium text-[15px] flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                Favorites
                <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" aria-hidden="true" />
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Books, pages &amp; images you&rsquo;ve liked
              </p>
            </Link>

            <Link
              href="/lists"
              className="group p-5 md:p-6 transition-all hover:shadow-md"
              style={{ background: 'white', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <Bookmark className="w-5 h-5 text-accent-gold-dark" aria-hidden="true" />
                {listsInfo && listsInfo.covers.length > 0 && (
                  <span className="flex -space-x-2">
                    {listsInfo.covers.map((url, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={url} alt="" aria-hidden="true" data-avatar="true" className="w-7 h-7 rounded-full object-cover" style={{ border: '2px solid white' }} loading="lazy" />
                    ))}
                  </span>
                )}
              </div>
              <p className="font-medium text-[15px] flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                Lists{listsInfo && listsInfo.count > 0 ? ` · ${listsInfo.count}` : ''}
                <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" aria-hidden="true" />
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Collections of your own making
              </p>
            </Link>

            <Link
              href="/reading-history"
              className="group p-5 md:p-6 transition-all hover:shadow-md"
              style={{ background: 'white', border: '1px solid var(--border-light)' }}
            >
              <div className="flex items-center justify-between mb-4">
                <BookOpen className="w-5 h-5 text-accent-sage" aria-hidden="true" />
              </div>
              <p className="font-medium text-[15px] flex items-center gap-1" style={{ color: 'var(--text-primary)' }}>
                Reading history
                <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" aria-hidden="true" />
              </p>
              <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Pick up where you left off
              </p>
            </Link>
          </div>
        </section>

        {/* ── Profile + membership, two columns on desktop ────── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-10 lg:gap-14 mt-14">

          <section id="reader-profile" className="scroll-mt-24">
            <h2 className="font-serif text-2xl md:text-3xl mb-2" style={{ color: 'var(--text-primary)' }}>
              Reader profile
            </h2>
            <p className="text-sm mb-5 max-w-md" style={{ color: 'var(--text-muted)' }}>
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

          <aside>
            <h2 className="font-serif text-2xl md:text-3xl mb-2" style={{ color: 'var(--text-primary)' }}>
              Membership
            </h2>
            <p className="text-sm mb-5" style={{ color: 'var(--text-muted)' }}>
              {isMember
                ? 'Thank you for keeping the library open.'
                : 'Membership keeps the scanners and translators running.'}
            </p>

            {isMember ? (
              <div style={{ background: 'white', border: '1px solid var(--border-light)' }}>
                <div className="flex items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <Crown className="w-5 h-5 shrink-0 text-accent-gold-dark" aria-hidden="true" />
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
                    {managingBilling ? 'Opening…' : 'Manage'}
                  </button>
                </div>

                {profileLoaded && (
                  <div className="p-5" style={{ borderTop: '1px solid var(--border-light)' }}>
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
                        Members page profile
                      </h3>
                      <Link
                        href="/support"
                        className="text-sm hover:opacity-70 transition-opacity flex items-center gap-1"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Users className="w-3.5 h-3.5" aria-hidden="true" />
                        View
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
                      <div className="flex items-center justify-between gap-3">
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
                          className="px-4 py-1.5 text-sm font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
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
                className="group block p-5 md:p-6 transition-opacity hover:opacity-95"
                style={{ background: 'var(--accent-rust)', color: 'white' }}
              >
                <span className="block font-serif text-xl">Support the Library</span>
                <span className="block text-sm opacity-80 mt-1">
                  Help fund the digitization and translation of ancient texts
                </span>
                <span className="inline-flex items-center gap-1.5 text-sm font-medium mt-4">
                  Become a member
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </Link>
            )}

            {/* Sign out */}
            <div className="flex items-center justify-between gap-4 mt-8 pt-5" style={{ borderTop: '1px solid var(--border-light)' }}>
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
          </aside>
        </div>
      </main>
    </div>
  );
}
