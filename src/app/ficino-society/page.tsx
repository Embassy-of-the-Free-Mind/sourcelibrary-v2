'use client';

import { Suspense, useState, useEffect } from 'react';
import OutboundLink from '@/components/analytics/OutboundLink';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

// No-login giving link — Embassy of the Free Mind Stripe donation page.
// Lets a logged-out reader give without creating an account first.
const EFM_STRIPE_URL = 'https://donate.stripe.com/9B67sLbO1bOg2GxfxP9fW08';

export default function FicinoSocietyPage() {
  return (
    <Suspense>
      <FicinoSocietyContent />
    </Suspense>
  );
}

interface MembershipState {
  active: boolean;
  joined: boolean;
  plan: string | null;
  expiresAt: string | null;
}

function FicinoSocietyContent() {
  const { data: session, status, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const returnUrl = searchParams.get('return');
  const [membership, setMembership] = useState<MembershipState | null>(null);
  const [joining, setJoining] = useState(false);
  const [contributing, setContributing] = useState(false);
  const [activating, setActivating] = useState(false);

  // No-login email signup (logged-out visitors). One field, straight into the list.
  const [email, setEmail] = useState('');
  const [subscribing, setSubscribing] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [subscribeError, setSubscribeError] = useState('');

  const handleEmailJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || subscribing) return;
    setSubscribing(true);
    setSubscribeError('');
    try {
      const res = await fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'ficino_society' }),
      });
      const data = await res.json();
      if (res.ok) setSubscribed(true);
      else setSubscribeError(data.error || 'Something went wrong');
    } catch {
      setSubscribeError('Something went wrong');
    } finally {
      setSubscribing(false);
    }
  };

  useEffect(() => {
    if (session?.user && !success) {
      fetch('/api/membership').then(r => r.json()).then(setMembership);
    }
  }, [session, success]);

  useEffect(() => {
    if (!success || !session?.user) return;
    setActivating(true);
    let cancelled = false;
    let attempts = 0;
    const poll = async () => {
      while (!cancelled && attempts < 20) {
        attempts++;
        try {
          const res = await fetch('/api/membership');
          const data = await res.json();
          if (data.active) {
            setMembership(data);
            setActivating(false);
            await updateSession();
            return;
          }
        } catch { /* retry */ }
        await new Promise(r => setTimeout(r, 1500));
      }
      setActivating(false);
      setMembership({ active: true, joined: true, plan: 'ficino', expiresAt: null });
    };
    poll();
    return () => { cancelled = true; };
  }, [success, session, updateSession]);

  const handleJoin = async () => {
    setJoining(true);
    try {
      await fetch('/api/ficino/join', { method: 'POST' });
      await updateSession();
      window.location.href = '/ficino-society/discussions';
    } catch { setJoining(false); }
  };

  const handleContribute = async () => {
    setContributing(true);
    try {
      const body = returnUrl ? JSON.stringify({ returnUrl }) : undefined;
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        ...(body && { headers: { 'Content-Type': 'application/json' }, body }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else { alert(data.error || 'Something went wrong'); setContributing(false); }
    } catch { alert('Something went wrong'); setContributing(false); }
  };

  const isMember = membership?.joined || membership?.active || false;
  const isContributor = membership?.active || false;

  return (
    <div className="min-h-screen bg-[#fdfcf9]">

      {/* TITLE */}
      <section className="min-h-[85vh] flex flex-col justify-center items-center relative bg-[#0e0c0a]">
        <div className="absolute inset-0 overflow-hidden">
          <img src="https://images.sourcelibrary.org/archived/69520c46ab34727b1f044141/99.jpg" alt="" className="w-full h-full object-cover opacity-[0.07]" />
        </div>
        <div className="relative z-10 text-center px-6 max-w-2xl">
          <h1 className="text-5xl md:text-6xl lg:text-7xl text-white/90 mb-6 font-serif leading-[1.1]" style={{ fontWeight: 300 }}>
            The Ficino<br />Society
          </h1>
          <p className="text-white/30 text-base font-body max-w-sm mx-auto">
            A community for the Western esoteric tradition
          </p>
          {!isMember && (
            <div className="mt-12">
              <a href="#join" className="px-8 py-3 rounded text-white/80 text-sm font-sans tracking-wide bg-[#9e4a3a] hover:brightness-110 transition-all">
                Join free
              </a>
            </div>
          )}
        </div>
        <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6">
          <span className="text-white/20 text-xs tracking-[0.15em] uppercase font-sans">ficinosociety.org</span>
          <div className="flex items-center gap-4">
            {isMember && (
              <Link href="/ficino-society/discussions" className="text-white/30 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
                Forums
              </Link>
            )}
            {status === 'authenticated' ? (
              <Link href="/account" className="text-white/20 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">Account</Link>
            ) : (
              <Link href="/auth/signin" className="text-white/20 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">Sign In</Link>
            )}
          </div>
        </header>
      </section>

      {/* SUCCESS */}
      {success && (
        <section className="bg-[#1a1612]">
          <div className="max-w-xl mx-auto px-6 py-10 text-center">
            {activating ? (
              <p className="text-white/60 font-serif">Processing...</p>
            ) : (
              <>
                <p className="text-lg font-serif text-white/80 mb-4">Thank you for your contribution.</p>
                <Link href="/ficino-society/discussions" className="text-[#c9a86c]/70 text-sm hover:text-[#c9a86c] transition-colors">
                  Go to the forums &rarr;
                </Link>
              </>
            )}
          </div>
        </section>
      )}

      {/* MEMBER BAR */}
      {isMember && !success && (
        <section className="bg-[#1a1612]">
          <div className="max-w-xl mx-auto px-6 py-4 flex items-center justify-between">
            <p className="text-white/30 text-sm font-sans">Member</p>
            <Link href="/ficino-society/discussions" className="text-[#c9a86c]/50 text-xs tracking-wider uppercase hover:text-[#c9a86c]/80 transition-colors font-sans">
              Forums
            </Link>
          </div>
        </section>
      )}

      {/* THE LETTER */}
      <section id="letter" className="bg-[#fdfcf9]">
        <div className="max-w-[560px] mx-auto px-6 py-20 md:py-28">
          <div className="space-y-6 text-[17px] leading-[1.85] text-[#333] font-body">
            <p>
              Source Library is digitizing and translating thousands of rare
              texts in alchemy, Kabbalah, astrology, and natural philosophy &mdash;
              many for the first time in any modern language. Everything is
              free to read.
            </p>
            <p>
              The Ficino Society is a community of people who care about
              these traditions. We discuss the texts, read together, and
              gather once a year in Amsterdam at the Embassy of the Free Mind.
            </p>
            <p>
              Joining is free.
            </p>
          </div>
        </div>
      </section>

      {/* IMAGES */}
      <section className="bg-[#0e0c0a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-[1px]">
            <div className="aspect-[3/4] overflow-hidden">
              <img src="https://images.sourcelibrary.org/archived/69520c46ab34727b1f044141/71.jpg" alt="Atalanta Fugiens, 1617" className="w-full h-full object-cover opacity-80" />
            </div>
            <div className="aspect-[3/4] overflow-hidden">
              <img src="https://images.sourcelibrary.org/archived/69520c46ab34727b1f044141/43.jpg" alt="Atalanta Fugiens, 1617" className="w-full h-full object-cover opacity-80" />
            </div>
            <div className="aspect-[3/4] overflow-hidden hidden md:block">
              <img src="https://images.sourcelibrary.org/archived/69520c46ab34727b1f044141/99.jpg" alt="Atalanta Fugiens, 1617" className="w-full h-full object-cover opacity-80" />
            </div>
          </div>
        </div>
      </section>

      {/* JOIN */}
      {!isMember && (
        <section id="join" className="bg-[#1a1612]">
          <div className="max-w-md mx-auto px-6 py-20 md:py-24 text-center">
            <h2 className="text-2xl font-serif text-white/90 mb-3" style={{ fontWeight: 300 }}>
              Join the Ficino Society
            </h2>
            <p className="text-white/35 text-sm font-body mb-8">
              Free. Open to everyone.
            </p>
            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="px-10 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-50 bg-[#9e4a3a]"
              >
                {joining ? 'Joining...' : 'Join'}
              </button>
            ) : subscribed ? (
              <p className="text-white/60 text-[15px] font-body">
                You&apos;re in. Welcome to the circle — check your inbox.
              </p>
            ) : (
              <>
                <form onSubmit={handleEmailJoin} className="flex flex-col sm:flex-row gap-2 max-w-sm mx-auto">
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@email.com"
                    aria-label="Email address"
                    className="flex-1 px-4 py-3.5 rounded bg-white/5 border border-white/15 text-white placeholder-white/30 text-[15px] font-body focus:outline-none focus:border-[#9e4a3a] transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={subscribing}
                    className="px-8 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-50 bg-[#9e4a3a]"
                  >
                    {subscribing ? 'Joining...' : 'Join'}
                  </button>
                </form>
                {subscribeError && (
                  <p className="mt-3 text-[#d98a7a] text-sm font-body">{subscribeError}</p>
                )}
                <p className="mt-4 text-white/25 text-xs font-body">
                  Just your email — no account needed.{' '}
                  <Link
                    href={`/auth/signin?callbackUrl=${encodeURIComponent('/ficino-society')}`}
                    className="underline hover:text-white/50 transition-colors"
                  >
                    Sign in
                  </Link>{' '}
                  for the forums.
                </p>
              </>
            )}
          </div>
        </section>
      )}

      {/* SUPPORT */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-md mx-auto px-6 py-20 md:py-24 text-center">
          <h2 className="text-xl font-serif text-[#1a1612] mb-4" style={{ fontWeight: 400 }}>
            Support the work
          </h2>
          <p className="text-[15px] text-[#444] font-body leading-relaxed mb-8">
            The recommended contribution is $100/year. This directly
            funds the translation of texts that haven&apos;t been read
            in centuries.
          </p>
          {status === 'authenticated' ? (
            <button
              onClick={handleContribute}
              disabled={contributing || isContributor}
              className="px-8 py-3 rounded text-sm font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-40 border border-[#1a1612]/20 text-[#1a1612] bg-transparent"
            >
              {isContributor ? 'Thank you' : contributing ? 'Redirecting...' : 'Contribute $100/year'}
            </button>
          ) : (
            <OutboundLink
              href={EFM_STRIPE_URL}
              surface="ficino_society"
              channel="efm_stripe"
              className="inline-block px-8 py-3 rounded text-sm font-sans tracking-wide border border-[#1a1612]/20 text-[#1a1612] hover:brightness-110 transition-all"
            >
              Contribute
            </OutboundLink>
          )}
          <p className="mt-6 text-[12px] text-[#8a8480] font-body">
            Any amount welcome &mdash;{' '}
            <a href="mailto:team@sourcelibrary.org" className="underline">team@sourcelibrary.org</a>
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0a0908] border-t border-white/[0.03]">
        <div className="max-w-xl mx-auto px-6 py-10">
          <div className="flex flex-col md:flex-row justify-between items-center gap-3 text-[11px] text-white/20 font-sans tracking-wider">
            <span>&copy; {new Date().getFullYear()} The Ficino Society</span>
            <div className="flex gap-6">
              <Link href="/ficino-society/discussions" className="hover:text-white/40 transition-colors">Forums</Link>
              <Link href="/ficino-society/members" className="hover:text-white/40 transition-colors">Members</Link>
              <a href="https://sourcelibrary.org" className="hover:text-white/40 transition-colors">Source Library</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
