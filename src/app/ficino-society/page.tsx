'use client';

import { Suspense, useState, useEffect, useRef } from 'react';
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
// Logo SVG — concentric circles with flame
// ---------------------------------------------------------------------------
function FicinoLogo({ className = 'w-10 h-10' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="24" cy="24" r="16" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <circle cx="24" cy="24" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M24 32c-3 0-5-2.5-5-5.5 0-4 3-7 5-9 2 2 5 5 5 9 0 3-2 5.5-5 5.5z" fill="currentColor" opacity="0.9" />
      <path d="M24 30c-1.5 0-2.5-1.2-2.5-2.8 0-2 1.5-3.5 2.5-4.5 1 1 2.5 2.5 2.5 4.5 0 1.6-1 2.8-2.5 2.8z" fill="#c9a86c" />
    </svg>
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
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const hasRecorded = useRef(false);

  // Show content after brief delay even without video
  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), 300);
    return () => clearTimeout(timer);
  }, []);

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

  const handleVideoLoad = () => {
    if (!hasRecorded.current) hasRecorded.current = true;
    setVideoLoaded(true);
    setShowContent(true);
  };

  const isMember = membership?.active || success;

  return (
    <div className="min-h-screen bg-[#0a0908]">
      {/* ================================================================ */}
      {/* HERO — full viewport with video background                       */}
      {/* ================================================================ */}
      <section className="relative min-h-screen w-full overflow-hidden">
        {/* Loading state */}
        {!showContent && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#0a0908]">
            <FicinoLogo className="w-16 h-16 text-white/30 animate-pulse" />
          </div>
        )}

        {/* Poster image */}
        <img
          src="/hero-poster.jpg"
          alt=""
          className="absolute inset-0 w-full h-full object-cover z-0"
          fetchPriority="high"
          onLoad={() => setShowContent(true)}
        />

        {/* Video background */}
        <video
          autoPlay loop muted playsInline preload="auto"
          onCanPlay={handleVideoLoad}
          className={`absolute inset-0 w-full h-full object-cover z-0 transition-opacity duration-700 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
        >
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.webm#t=3" type="video/webm" />
          <source src="https://cdn.prod.website-files.com/68d800cb1402171531a597f4/68d800cb1402171531a598cf_embassy-of-the-free-mind-montage-002-transcode.mp4#t=3" type="video/mp4" />
        </video>

        {/* Dark overlay */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/30 to-black/80 z-[1]" />

        {/* Header */}
        <header className={`relative z-50 flex items-center justify-between px-6 md:px-12 py-6 transition-opacity duration-700 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center gap-3 text-white">
            <FicinoLogo className="w-10 h-10 md:w-11 md:h-11" />
            <div className="flex flex-col">
              <span className="text-base md:text-lg tracking-wide font-light">The Ficino Society</span>
              <span className="text-[10px] tracking-[0.2em] text-white/50 uppercase">Est. MMXXV</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {status === 'authenticated' ? (
              <Link href="/account" className="px-4 py-2 text-white/80 text-sm hover:text-white transition-colors">
                Account
              </Link>
            ) : (
              <Link href="/auth/signin" className="px-4 py-2 text-white/80 text-sm hover:text-white transition-colors">
                Sign In
              </Link>
            )}
          </div>
        </header>

        {/* Hero content */}
        <div className={`relative z-10 min-h-[calc(100vh-88px)] flex items-center transition-opacity duration-700 ${showContent ? 'opacity-100' : 'opacity-0'}`}>
          <div className="px-6 md:px-12 lg:px-20 max-w-4xl">
            <p className="text-[#c9a86c] text-xs md:text-sm tracking-[0.25em] uppercase mb-8 font-sans">
              Patron of the Western Esoteric Tradition
            </p>

            <h1
              className="text-4xl md:text-5xl lg:text-6xl text-white mb-8 leading-[1.15] font-serif"
              style={{ fontWeight: 400 }}
            >
              Five hundred years of lost knowledge,{' '}
              <span className="text-[#c9a86c]">translated for the first time</span>
            </h1>

            <p className="text-lg md:text-xl text-white/75 leading-relaxed max-w-2xl mb-12 font-body">
              Source Library is digitizing and translating thousands of rare texts in alchemy,
              Kabbalah, astrology, and natural philosophy. The Ficino Society makes that possible.
            </p>

            {/* CTA in hero */}
            {!isMember && (
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="#join"
                  className="px-8 py-4 bg-[#9e4a3a] hover:bg-[#b5564a] text-white rounded-lg text-base font-medium transition-colors font-sans"
                >
                  Become a Patron
                </a>
                <a
                  href="#about"
                  className="px-8 py-4 bg-white/10 hover:bg-white/15 backdrop-blur-sm text-white rounded-lg text-base font-medium transition-colors border border-white/15 font-sans"
                >
                  Learn More
                </a>
              </div>
            )}

            {/* Stats */}
            <div className="flex flex-wrap gap-8 md:gap-14 mt-16 pt-8 border-t border-white/15">
              <div>
                <p className="text-3xl md:text-4xl text-white font-light font-serif">5,355</p>
                <p className="text-[11px] text-white/50 uppercase tracking-wider mt-1 font-sans">Books Digitized</p>
              </div>
              <div>
                <p className="text-3xl md:text-4xl text-white font-light font-serif">1,200+</p>
                <p className="text-[11px] text-white/50 uppercase tracking-wider mt-1 font-sans">Texts Translated</p>
              </div>
              <div>
                <p className="text-3xl md:text-4xl text-white font-light font-serif">100K+</p>
                <p className="text-[11px] text-white/50 uppercase tracking-wider mt-1 font-sans">Pages Available</p>
              </div>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20">
          <a href="#about" className="flex flex-col items-center gap-2 text-white/40 hover:text-white/60 transition-colors">
            <svg className="w-5 h-5 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </a>
        </div>
      </section>

      {/* ================================================================ */}
      {/* SUCCESS / MEMBER BANNER (if applicable)                          */}
      {/* ================================================================ */}
      {success && (
        <section className="bg-[#1a1612] border-b border-[#c9a86c]/30">
          <div className="max-w-2xl mx-auto px-6 py-12 text-center">
            {activating ? (
              <>
                <h2 className="text-2xl font-serif text-white mb-2" style={{ fontWeight: 400 }}>
                  Activating your membership...
                </h2>
                <p className="text-white/60">This usually takes just a moment.</p>
              </>
            ) : (
              <>
                <h2 className="text-2xl font-serif text-white mb-3" style={{ fontWeight: 400 }}>
                  Welcome to the Ficino Society
                </h2>
                <p className="text-white/70 leading-relaxed mb-6">
                  Your membership is active. You now have full access to high-resolution
                  gallery downloads and the complete translated collection.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href={returnUrl || '/gallery'}
                    className="inline-block px-6 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90 bg-[#9e4a3a]"
                  >
                    {returnUrl ? 'Continue where you left off' : 'Browse the gallery'}
                  </Link>
                  <Link
                    href="/account"
                    className="inline-block px-6 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-90 bg-white/10 text-white border border-white/15"
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
        <section className="bg-[#1a1612] border-b border-[#c9a86c]/30">
          <div className="max-w-2xl mx-auto px-6 py-8 text-center">
            <p className="text-white/80 font-serif text-lg">
              You are a member of the Ficino Society
            </p>
            {membership?.expiresAt && (
              <p className="text-white/40 text-sm mt-1">
                Renews {new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* THE STORY — Cosimo narrative                                     */}
      {/* ================================================================ */}
      <section id="about" className="bg-[#fdfcf9]">
        <div className="max-w-2xl mx-auto px-6 py-20 md:py-28">
          <p className="text-[#9e4a3a] text-xs tracking-[0.25em] uppercase mb-8 font-sans">The Work</p>

          <div className="space-y-6 text-[17px] leading-[1.8] text-[#444] font-body">
            <p>
              In 1462, Cosimo de&apos; Medici gave Marsilio Ficino a villa and a stack of Greek manuscripts,
              and asked him to translate them. What followed was the recovery of an entire intellectual
              tradition &mdash; Plato, the Hermetica, Plotinus &mdash; that had been lost to the Latin West
              for a thousand years. It changed everything.
            </p>
            <p>
              Source Library is doing something similar, at a different scale. We are digitizing
              thousands of rare texts in alchemy, Kabbalah, astrology, natural philosophy, and the
              Western esoteric tradition, and translating them into English for the first time &mdash;
              many from books that exist in only a handful of libraries worldwide.
            </p>
            <p>
              The Ficino Society is for people who want this work to continue. Your membership
              directly funds the digitization, translation, and preservation of these texts.
              Everything in the library remains free to read. Your support makes that possible.
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* WHAT MEMBERS GET                                                 */}
      {/* ================================================================ */}
      <section className="bg-[#f5f0e8]">
        <div className="max-w-2xl mx-auto px-6 py-20 md:py-24">
          <p className="text-[#9e4a3a] text-xs tracking-[0.25em] uppercase mb-8 font-sans">Membership</p>
          <h2 className="text-3xl md:text-4xl font-serif mb-12 text-[#1a1612]" style={{ fontWeight: 400 }}>
            As a member
          </h2>

          <div className="space-y-8">
            {[
              {
                title: 'Unlimited downloads',
                desc: 'Every book as EPUB or plain text, every gallery image in full resolution. No per-item fees.',
              },
              {
                title: 'MCP server and API',
                desc: 'The API and MCP server are free for everyone. Your membership keeps them running.',
              },
              {
                title: 'Your name on the members page',
                desc: 'A public page listing the people who support this work. With an optional one-line bio, if you like.',
              },
              {
                title: 'A quarterly letter',
                desc: 'What we translated, what we discovered, what\u2019s coming next. Short, personal, from the team.',
              },
              {
                title: 'Dedicate a translation',
                desc: 'Choose a book and put your name on it \u2014 permanently. One dedication per year.',
              },
              {
                title: 'Inner circle',
                desc: 'As we build forums and discussion spaces, members will be the founding community.',
              },
            ].map((item) => (
              <div key={item.title} className="flex gap-4">
                <span className="mt-2.5 w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#9e4a3a]" />
                <div>
                  <span className="font-medium text-[#1a1612]">{item.title}</span>
                  <p className="text-sm mt-1 text-[#444] leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* THE COMMITMENT                                                   */}
      {/* ================================================================ */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-2xl mx-auto px-6 py-20 md:py-24">
          <h2 className="text-3xl md:text-4xl font-serif mb-8 text-[#1a1612]" style={{ fontWeight: 400 }}>
            The library stays free
          </h2>
          <div className="space-y-4 text-[17px] leading-[1.8] text-[#444] font-body">
            <p>
              Every book, every translation, every page is free to read, search, and cite.
              No account required, no paywalls, no restrictions on scholarship.
              Membership sustains the work. It does not gate the knowledge.
            </p>
          </div>
          <p className="text-sm mt-6 text-[#6b6560] leading-relaxed">
            If the membership fee is a barrier for you, write to{' '}
            <a href="mailto:hello@sourcelibrary.org" className="underline hover:text-[#444] transition-colors">
              hello@sourcelibrary.org
            </a>
            {' '}and we will find an amount that works. No questions, no proof required.
          </p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* JOIN CTA                                                         */}
      {/* ================================================================ */}
      {!isMember && (
        <section id="join" className="bg-[#1a1612]">
          <div className="max-w-2xl mx-auto px-6 py-20 md:py-28 text-center">
            <p className="text-[#c9a86c] text-xs tracking-[0.25em] uppercase mb-8 font-sans">Join</p>
            <h2 className="text-3xl md:text-4xl font-serif text-white mb-4" style={{ fontWeight: 400 }}>
              The Ficino Society
            </h2>
            <p className="text-white/60 mb-10 font-body text-lg leading-relaxed max-w-lg mx-auto">
              Your membership funds the translation of texts that have been locked in Latin,
              German, and Greek for centuries.
            </p>

            <div className="mb-8">
              <span className="text-4xl font-serif font-light text-white">$100</span>
              <span className="text-lg ml-1 text-white/40">/ year</span>
            </div>

            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={loading}
                className="px-12 py-4 rounded-lg text-white text-lg font-medium transition-all hover:brightness-110 disabled:opacity-50 bg-[#9e4a3a] font-sans"
              >
                {loading ? 'Redirecting to checkout...' : 'Become a Patron'}
              </button>
            ) : (
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent(`/ficino-society${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`)}`}
                className="inline-block px-12 py-4 rounded-lg text-white text-lg font-medium transition-all hover:brightness-110 bg-[#9e4a3a] font-sans"
              >
                Sign in to join
              </Link>
            )}

            <p className="mt-6 text-sm text-white/30">
              Billed annually. Cancel at any time from your account.
            </p>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* FOOTER                                                           */}
      {/* ================================================================ */}
      <footer className="bg-[#0a0908] border-t border-white/5">
        <div className="max-w-4xl mx-auto px-6 py-16">
          {/* Partner logos */}
          <div className="flex items-center justify-center gap-8 mb-12">
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68e1613213023b8399f2c4c0_embassy%20of%20the%20free%20mind%20logo2.png"
              alt="Embassy of the Free Mind"
              className="h-10 md:h-14 w-auto object-contain opacity-40 hover:opacity-70 transition-opacity"
            />
            <img
              src="https://cdn.prod.website-files.com/68d800cb1402171531a5981e/68d800cb1402171531a599ea_partners-unesco.avif"
              alt="UNESCO Memory of the World"
              className="h-14 md:h-18 w-auto object-contain opacity-40 hover:opacity-70 transition-opacity"
            />
          </div>

          <div className="border-t border-white/5 pt-8">
            <div className="flex flex-col md:flex-row justify-between items-center gap-4">
              <div className="flex items-center gap-2 text-white/30">
                <FicinoLogo className="w-5 h-5" />
                <span className="text-xs font-sans">
                  &copy; {new Date().getFullYear()} The Ficino Society
                </span>
              </div>
              <div className="flex gap-6 text-xs text-white/30 font-sans">
                <Link href="/ficino-society/members" className="hover:text-white/60 transition-colors">Members</Link>
                <Link href="/about" className="hover:text-white/60 transition-colors">About</Link>
                <a href="https://sourcelibrary.org" className="hover:text-white/60 transition-colors">Source Library</a>
                <a href="mailto:hello@sourcelibrary.org" className="hover:text-white/60 transition-colors text-[#c9a86c]/60 hover:text-[#c9a86c]">
                  Contact
                </a>
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
