'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { MembershipInfo } from '@/lib/membership';

export default function FicinoSocietyPage() {
  return (
    <Suspense>
      <FicinoSocietyContent />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Ornamental divider — a small typographic flourish
// ---------------------------------------------------------------------------
function Ornament() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden="true">
      <span className="text-[#c9a86c]/40 text-lg tracking-[0.5em] font-serif select-none">
        &middot;&nbsp;&middot;&nbsp;&middot;
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main content
// ---------------------------------------------------------------------------
function FicinoSocietyContent() {
  const { data: session, status, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const returnUrl = searchParams.get('return');
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  // Normal membership check
  useEffect(() => {
    if (session?.user && !success) {
      fetch('/api/membership').then(r => r.json()).then(setMembership);
    }
  }, [session, success]);

  // After payment: poll until webhook activates membership
  useEffect(() => {
    if (!success || !session?.user) return;
    setActivating(true);

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
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
        } catch {
          // Retry on failure
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      setActivating(false);
      setMembership({ active: true, plan: 'ficino', expiresAt: null, stripeCustomerId: null });
    };

    poll();
    return () => { cancelled = true; };
  }, [success, session, updateSession]);

  const handleJoin = async () => {
    setLoading(true);
    try {
      const body = returnUrl ? JSON.stringify({ returnUrl }) : undefined;
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        ...(body && { headers: { 'Content-Type': 'application/json' }, body }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert(data.error || 'Something went wrong');
        setLoading(false);
      }
    } catch {
      alert('Something went wrong');
      setLoading(false);
    }
  };

  const isMember = membership?.active || success;

  return (
    <div className="min-h-screen bg-[#fdfcf9]">

      {/* ================================================================ */}
      {/* TITLE PAGE — like the opening page of a book                     */}
      {/* ================================================================ */}
      <section className="min-h-screen flex flex-col justify-center items-center relative bg-[#0e0c0a]">
        {/* Background: a single manuscript image, very muted */}
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/99.jpg"
            alt=""
            className="w-full h-full object-cover opacity-[0.08]"
          />
        </div>

        <div className="relative z-10 text-center px-6 max-w-2xl">
          <p className="text-[#c9a86c]/60 text-[11px] tracking-[0.4em] uppercase mb-12 font-sans">
            Est. MMXXV
          </p>
          <h1
            className="text-5xl md:text-6xl lg:text-7xl text-white/90 mb-6 font-serif leading-[1.1]"
            style={{ fontWeight: 300 }}
          >
            The Ficino<br />Society
          </h1>
          <p className="text-white/35 text-base md:text-lg font-body leading-relaxed max-w-md mx-auto">
            Supporting the translation of the<br className="hidden md:inline" />
            Western esoteric tradition
          </p>

          {/* Scroll hint */}
          <div className="mt-20">
            <a href="#letter" className="text-white/15 hover:text-white/30 transition-colors">
              <svg className="w-5 h-5 mx-auto animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </a>
          </div>
        </div>

        {/* Minimal header */}
        <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6">
          <span className="text-white/25 text-xs tracking-[0.15em] uppercase font-sans">
            ficinosociety.org
          </span>
          {status === 'authenticated' ? (
            <Link href="/account" className="text-white/25 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
              Account
            </Link>
          ) : (
            <Link href="/auth/signin" className="text-white/25 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
              Sign In
            </Link>
          )}
        </header>
      </section>

      {/* ================================================================ */}
      {/* SUCCESS / MEMBER STATE                                           */}
      {/* ================================================================ */}
      {success && (
        <section className="bg-[#1a1612] border-b border-[#c9a86c]/20">
          <div className="max-w-xl mx-auto px-6 py-12 text-center">
            {activating ? (
              <>
                <p className="text-xl font-serif text-white/80" style={{ fontWeight: 400 }}>
                  Activating your membership...
                </p>
                <p className="text-white/40 text-sm mt-2">This usually takes just a moment.</p>
              </>
            ) : (
              <>
                <p className="text-xl font-serif text-white/80 mb-4" style={{ fontWeight: 400 }}>
                  Welcome to the Ficino Society
                </p>
                <p className="text-white/50 text-sm leading-relaxed mb-6">
                  Your membership is active. Thank you for supporting this work.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href={returnUrl || '/gallery'}
                    className="inline-block px-5 py-2 rounded text-white/90 text-sm transition-opacity hover:opacity-80 bg-[#9e4a3a]"
                  >
                    {returnUrl ? 'Continue where you left off' : 'Visit the library'}
                  </Link>
                  <Link
                    href="/account"
                    className="inline-block px-5 py-2 rounded text-white/60 text-sm transition-opacity hover:opacity-80 border border-white/10"
                  >
                    Your account
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {isMember && !success && (
        <section className="bg-[#1a1612]">
          <div className="max-w-xl mx-auto px-6 py-6 text-center">
            <p className="text-white/50 text-sm font-serif">
              You are a member of the Ficino Society
              {membership?.expiresAt && (
                <span className="text-white/25 ml-2">
                  &middot; Renews {new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
              )}
            </p>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* THE LETTER                                                       */}
      {/* ================================================================ */}
      <section id="letter" className="bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 md:py-32">
          <div className="space-y-7 text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body">
            <p>
              In 1462, Cosimo de&apos; Medici gave Marsilio Ficino a villa and
              a stack of Greek manuscripts, and asked him to translate them.
              What followed was the recovery of an entire intellectual
              tradition &mdash; Plato, the Hermetica, Plotinus &mdash; that had been
              lost to the Latin West for a thousand years.
            </p>
            <p>
              It changed everything. The Renaissance, in no small part,
              began because one patron believed those texts mattered enough
              to fund their translation.
            </p>
            <p>
              We are doing something similar. Source Library has digitized
              over five thousand rare books in alchemy, Kabbalah, astrology,
              natural philosophy, and the broader Western esoteric
              tradition &mdash; and is translating them into English for the
              first time. Many of these exist in only a handful of libraries
              worldwide. Some have never been translated into any modern
              language.
            </p>
            <p>
              Every book, every translation, every page is free to read.
              No paywall, no account required. The knowledge belongs to
              everyone.
            </p>
            <p>
              The Ficino Society is for people who want this work to
              continue. Your support directly funds the digitization,
              translation, and preservation of these texts. Nothing more
              complicated than that.
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* A MANUSCRIPT IMAGE — full bleed, no text, just the work          */}
      {/* ================================================================ */}
      <section className="bg-[#0e0c0a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px]">
            <div className="aspect-[3/4] overflow-hidden">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/71.jpg"
                alt="Alchemical emblem from Atalanta Fugiens by Michael Maier, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
            <div className="aspect-[3/4] overflow-hidden">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/43.jpg"
                alt="Hermetic emblem from Atalanta Fugiens by Michael Maier, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
            <div className="aspect-[3/4] overflow-hidden hidden md:block">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/99.jpg"
                alt="Geometric diagram from Atalanta Fugiens by Michael Maier, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
          </div>
          <p className="text-white/20 text-xs text-center py-4 font-sans tracking-wider">
            Michael Maier, <em>Atalanta Fugiens</em>, 1617
          </p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* WHAT YOUR SUPPORT MAKES POSSIBLE                                 */}
      {/* ================================================================ */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 md:py-32">
          <Ornament />

          <h2
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mt-8 mb-10 text-center"
            style={{ fontWeight: 400 }}
          >
            What your support makes possible
          </h2>

          <div className="space-y-7 text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body">
            <p>
              A membership costs $100 per year. That&apos;s roughly the cost of
              translating twenty pages of sixteenth-century Latin &mdash; one
              chapter of a book that may not have been read in English
              before.
            </p>
            <p>
              As a member, you receive unlimited downloads of every book
              and gallery image in the collection. You can dedicate one
              translation per year &mdash; your name on the book, permanently.
              You receive a quarterly letter about what we&apos;ve translated
              and what&apos;s coming next. And your name appears on the
              members page, if you choose.
            </p>
            <p>
              But those are gestures of thanks, not the reason to join.
              The reason is the work itself.
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* THE INVITATION                                                   */}
      {/* ================================================================ */}
      {!isMember && (
        <section id="join" className="bg-[#1a1612]">
          <div className="max-w-[520px] mx-auto px-6 py-24 md:py-32 text-center">
            <Ornament />

            <div className="mt-10 mb-10">
              <span className="text-4xl md:text-5xl font-serif text-white/80" style={{ fontWeight: 300 }}>
                $100
              </span>
              <span className="text-base ml-2 text-white/25 font-body">per year</span>
            </div>

            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={loading}
                className="px-10 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-50 bg-[#9e4a3a]"
              >
                {loading ? 'Redirecting...' : 'Support the work'}
              </button>
            ) : (
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent(`/ficino-society${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`)}`}
                className="inline-block px-10 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 bg-[#9e4a3a]"
              >
                Sign in to join
              </Link>
            )}

            <p className="mt-8 text-[13px] text-white/20 leading-relaxed max-w-sm mx-auto font-body">
              If the membership fee is a barrier, write to{' '}
              <a href="mailto:hello@sourcelibrary.org" className="underline text-white/30 hover:text-white/40 transition-colors">
                hello@sourcelibrary.org
              </a>
              {' '}and we&apos;ll find an amount that works.
              No questions asked.
            </p>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* FOOTER — minimal                                                 */}
      {/* ================================================================ */}
      <footer className="bg-[#0a0908] border-t border-white/[0.03]">
        <div className="max-w-xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-white/20 font-sans tracking-wider">
            <span>&copy; {new Date().getFullYear()} The Ficino Society</span>
            <div className="flex gap-6">
              <Link href="/ficino-society/members" className="hover:text-white/40 transition-colors">Members</Link>
              <a href="https://sourcelibrary.org" className="hover:text-white/40 transition-colors">Source Library</a>
              <a href="mailto:hello@sourcelibrary.org" className="hover:text-white/40 transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
