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
// Ornament
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
// Main
// ---------------------------------------------------------------------------
function FicinoSocietyContent() {
  const { data: session, status, update: updateSession } = useSession();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const returnUrl = searchParams.get('return');
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [activating, setActivating] = useState(false);

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
      {/* TITLE PAGE                                                       */}
      {/* ================================================================ */}
      <section className="min-h-screen flex flex-col justify-center items-center relative bg-[#0e0c0a]">
        <div className="absolute inset-0 overflow-hidden">
          <img
            src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/99.jpg"
            alt=""
            className="w-full h-full object-cover opacity-[0.07]"
          />
        </div>

        <div className="relative z-10 text-center px-6 max-w-2xl">
          <p className="text-[#c9a86c]/50 text-[11px] tracking-[0.4em] uppercase mb-12 font-sans">
            Est. MMXXV
          </p>
          <h1
            className="text-5xl md:text-6xl lg:text-7xl text-white/90 mb-6 font-serif leading-[1.1]"
            style={{ fontWeight: 300 }}
          >
            The Ficino<br />Society
          </h1>
          <p className="text-white/30 text-base md:text-lg font-body leading-relaxed max-w-md mx-auto">
            A circle of scholars and readers translating<br className="hidden md:inline" />
            the Western esoteric tradition
          </p>

          <div className="mt-20">
            <a href="#letter" className="text-white/15 hover:text-white/30 transition-colors">
              <svg className="w-5 h-5 mx-auto animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
              </svg>
            </a>
          </div>
        </div>

        <header className="absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 py-6">
          <span className="text-white/20 text-xs tracking-[0.15em] uppercase font-sans">
            ficinosociety.org
          </span>
          <div className="flex items-center gap-4">
            {isMember && (
              <Link href="/ficino-society/discussions" className="text-white/20 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
                Discussions
              </Link>
            )}
            {status === 'authenticated' ? (
              <Link href="/account" className="text-white/20 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
                Account
              </Link>
            ) : (
              <Link href="/auth/signin" className="text-white/20 text-xs tracking-wider uppercase hover:text-white/50 transition-colors font-sans">
                Sign In
              </Link>
            )}
          </div>
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
                  You&apos;re in. Visit the correspondence to introduce yourself,
                  or head to the library to see what&apos;s been translated.
                </p>
                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                  <Link
                    href="/ficino-society/discussions"
                    className="inline-block px-5 py-2 rounded text-white/90 text-sm bg-[#9e4a3a] transition-opacity hover:opacity-90"
                  >
                    The Correspondence
                  </Link>
                  <Link
                    href={returnUrl || '/'}
                    className="inline-block px-5 py-2 rounded text-white/60 text-sm border border-white/10 transition-opacity hover:opacity-80"
                  >
                    Visit the library
                  </Link>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {isMember && !success && (
        <section className="bg-[#1a1612]">
          <div className="max-w-xl mx-auto px-6 py-6 flex items-center justify-between">
            <p className="text-white/40 text-sm font-serif">
              Member
              {membership?.expiresAt && (
                <span className="text-white/20 ml-2">
                  &middot; Renews {new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                </span>
              )}
            </p>
            <Link
              href="/ficino-society/discussions"
              className="text-[#c9a86c]/50 text-xs tracking-wider uppercase hover:text-[#c9a86c]/80 transition-colors font-sans"
            >
              The Correspondence
            </Link>
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
              But Ficino didn&apos;t work alone. He gathered a circle &mdash;
              philosophers, physicians, poets, patrons &mdash; who met at
              Careggi to read and discuss what he translated. They called it
              the Platonic Academy. The translations were the output of a
              community, not just a scholar.
            </p>
            <p>
              Source Library has digitized over five thousand rare texts in
              alchemy, Kabbalah, astrology, natural philosophy, and the
              broader Western esoteric tradition. We are translating them
              into English for the first time &mdash; many from books that
              exist in only a handful of libraries worldwide.
            </p>
            <p>
              The Ficino Society is a circle of people doing this work
              together. Members read the new translations, discuss them,
              and shape what we translate next. Every book, every page
              remains free for anyone to read. The Society isn&apos;t about
              access &mdash; it&apos;s about participation.
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* MANUSCRIPT IMAGES                                                */}
      {/* ================================================================ */}
      <section className="bg-[#0e0c0a]">
        <div className="max-w-5xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-[1px]">
            <div className="aspect-[3/4] overflow-hidden">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/71.jpg"
                alt="Alchemical emblem from Atalanta Fugiens, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
            <div className="aspect-[3/4] overflow-hidden">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/43.jpg"
                alt="Hermetic emblem from Atalanta Fugiens, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
            <div className="aspect-[3/4] overflow-hidden hidden md:block">
              <img
                src="https://3kwioilsplnmnkv8.public.blob.vercel-storage.com/archived/69520c46ab34727b1f044141/99.jpg"
                alt="Geometric diagram from Atalanta Fugiens, 1617"
                className="w-full h-full object-cover opacity-80"
              />
            </div>
          </div>
          <p className="text-white/15 text-xs text-center py-4 font-sans tracking-wider">
            Michael Maier, <em>Atalanta Fugiens</em>, 1617
          </p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* THE CIRCLE — what members do together                            */}
      {/* ================================================================ */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 md:py-32">
          <Ornament />
          <h2
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mt-8 mb-10 text-center"
            style={{ fontWeight: 400 }}
          >
            The circle
          </h2>

          <div className="space-y-7 text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body">
            <p>
              Members correspond with each other through a private
              discussion space we call the Correspondence. Threads are
              long-form and unhurried &mdash; more like an exchange of
              letters than a group chat. People discuss newly translated
              passages, share what they&apos;re reading, and suggest texts
              they believe should be translated next.
            </p>
            <p>
              Every quarter, we send a letter about what we&apos;ve
              translated, what surprised us, and what&apos;s coming next.
              Members write back. Sometimes those responses shape the
              direction of the project.
            </p>
            <p>
              Once a year, each member can dedicate a translation &mdash;
              choose a book and put their name on it, permanently. Your
              name in a book that didn&apos;t exist in English before.
            </p>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* THE LIBRARY STAYS FREE                                           */}
      {/* ================================================================ */}
      <section className="bg-[#f5f0e8]">
        <div className="max-w-[580px] mx-auto px-6 py-20 md:py-24">
          <h2
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mb-8"
            style={{ fontWeight: 400 }}
          >
            The library stays free
          </h2>
          <div className="space-y-5 text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body">
            <p>
              Every book, every translation, every page is free to read,
              search, and cite. No account required, no paywalls, no
              restrictions on scholarship. Membership sustains the work.
              It does not gate the knowledge.
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

            <p className="mt-10 mb-2 text-white/50 font-body text-lg leading-relaxed">
              If you&apos;d like to join the conversation
            </p>

            <div className="mb-10">
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
                {loading ? 'Redirecting...' : 'Join the Ficino Society'}
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
              If the fee is a barrier, write to{' '}
              <a href="mailto:hello@sourcelibrary.org" className="underline text-white/25 hover:text-white/40 transition-colors">
                hello@sourcelibrary.org
              </a>
              . We&apos;ll find an amount that works. No questions asked.
            </p>
          </div>
        </section>
      )}

      {/* ================================================================ */}
      {/* FOOTER                                                           */}
      {/* ================================================================ */}
      <footer className="bg-[#0a0908] border-t border-white/[0.03]">
        <div className="max-w-xl mx-auto px-6 py-12">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-[11px] text-white/20 font-sans tracking-wider">
            <span>&copy; {new Date().getFullYear()} The Ficino Society</span>
            <div className="flex gap-6">
              <Link href="/ficino-society/members" className="hover:text-white/40 transition-colors">Members</Link>
              <Link href="/ficino-society/discussions" className="hover:text-white/40 transition-colors">Correspondence</Link>
              <a href="https://sourcelibrary.org" className="hover:text-white/40 transition-colors">Source Library</a>
              <a href="mailto:hello@sourcelibrary.org" className="hover:text-white/40 transition-colors">Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
