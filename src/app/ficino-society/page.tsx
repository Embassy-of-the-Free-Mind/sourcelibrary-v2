'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function FicinoSocietyPage() {
  return (
    <Suspense>
      <FicinoSocietyContent />
    </Suspense>
  );
}

function Ornament() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden="true">
      <span className="text-[#c9a86c]/40 text-lg tracking-[0.5em] font-serif select-none">
        &middot;&nbsp;&middot;&nbsp;&middot;
      </span>
    </div>
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

  // Fetch membership state
  useEffect(() => {
    if (session?.user && !success) {
      fetch('/api/membership').then(r => r.json()).then(setMembership);
    }
  }, [session, success]);

  // After Stripe payment: poll until webhook fires
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

  // Join the Society (free)
  const handleJoin = async () => {
    setJoining(true);
    try {
      await fetch('/api/ficino/join', { method: 'POST' });
      await updateSession();
      // Take them straight to the Correspondence
      window.location.href = '/ficino-society/discussions';
    } catch {
      setJoining(false);
    }
  };

  // Contribute financially (Stripe)
  const handleContribute = async () => {
    setContributing(true);
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
        setContributing(false);
      }
    } catch {
      alert('Something went wrong');
      setContributing(false);
    }
  };

  const isMember = membership?.joined || membership?.active || false;
  const isContributor = membership?.active || false;

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
      {/* SUCCESS STATE (after Stripe payment)                             */}
      {/* ================================================================ */}
      {success && (
        <section className="bg-[#1a1612] border-b border-[#c9a86c]/20">
          <div className="max-w-xl mx-auto px-6 py-12 text-center">
            {activating ? (
              <>
                <p className="text-xl font-serif text-white/80" style={{ fontWeight: 400 }}>Processing...</p>
                <p className="text-white/40 text-sm mt-2">This usually takes just a moment.</p>
              </>
            ) : (
              <>
                <p className="text-xl font-serif text-white/80 mb-4" style={{ fontWeight: 400 }}>
                  Thank you for your contribution
                </p>
                <p className="text-white/50 text-sm leading-relaxed mb-6">
                  Your support directly funds the translation of texts that have
                  been unread for centuries. Thank you.
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

      {/* Member bar */}
      {isMember && !success && (
        <section className="bg-[#1a1612]">
          <div className="max-w-xl mx-auto px-6 py-5 flex items-center justify-between">
            <p className="text-white/40 text-sm font-serif">
              Member
              {isContributor && membership?.expiresAt && (
                <span className="text-white/20 ml-2">
                  &middot; Contributor &middot; Renews {new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
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
              But Ficino didn&apos;t work alone. He gathered a circle &mdash;
              philosophers, physicians, poets, patrons &mdash; who met at
              Careggi to read and discuss what he translated. They called it
              the Platonic Academy.
            </p>
            <p>
              Source Library has digitized over five thousand rare texts in
              alchemy, Kabbalah, astrology, natural philosophy, and the
              broader Western esoteric tradition, and is translating them
              into English for the first time. Many from books that exist
              in only a handful of libraries worldwide.
            </p>
            <p>
              The Ficino Society is a circle of people who care about this
              work. Members read the new translations together, discuss
              them, suggest what to translate next, and &mdash; once a
              year &mdash; gather in Amsterdam at the library where this
              project began.
            </p>
            <p>
              Joining is free. The Society is open to anyone drawn to
              these traditions.
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
      {/* WHAT THE SOCIETY DOES                                            */}
      {/* ================================================================ */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 md:py-32">
          <Ornament />
          <h2
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mt-8 mb-12 text-center"
            style={{ fontWeight: 400 }}
          >
            What we do together
          </h2>

          <div className="space-y-10">
            <div>
              <h3 className="text-lg font-serif text-[#1a1612] mb-2" style={{ fontWeight: 500 }}>
                The Correspondence
              </h3>
              <p className="text-[16px] leading-[1.8] text-[#444] font-body">
                A private discussion space for members. Long-form, unhurried &mdash;
                more like an exchange of letters than a group chat. People discuss
                newly translated passages, share what they&apos;re reading, debate
                interpretations, and suggest texts they believe should be
                translated next.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-serif text-[#1a1612] mb-2" style={{ fontWeight: 500 }}>
                Reading groups
              </h3>
              <p className="text-[16px] leading-[1.8] text-[#444] font-body">
                Each quarter, the Society reads a text together. Not a book club &mdash;
                a study group. Members commit to reading a specific work over
                several months, discussing it as they go. The translator sometimes
                joins the conversation.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-serif text-[#1a1612] mb-2" style={{ fontWeight: 500 }}>
                The quarterly letter
              </h3>
              <p className="text-[16px] leading-[1.8] text-[#444] font-body">
                Every three months, a letter about what we&apos;ve translated, what
                surprised us, and what&apos;s coming next. Members write back.
                Sometimes those responses shape the direction of the project.
              </p>
            </div>

            <div>
              <h3 className="text-lg font-serif text-[#1a1612] mb-2" style={{ fontWeight: 500 }}>
                The annual gathering
              </h3>
              <p className="text-[16px] leading-[1.8] text-[#444] font-body">
                Once a year, members gather in Amsterdam at the Embassy of the
                Free Mind &mdash; the library where this project began. A day
                of reading, discussion, and dinner. Not a conference. A meeting
                of the circle.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ================================================================ */}
      {/* JOIN — free, primary CTA                                         */}
      {/* ================================================================ */}
      {!isMember && (
        <section id="join" className="bg-[#1a1612]">
          <div className="max-w-[520px] mx-auto px-6 py-24 md:py-28 text-center">
            <h2
              className="text-3xl md:text-4xl font-serif text-white/90 mb-4"
              style={{ fontWeight: 300 }}
            >
              Join the Ficino Society
            </h2>
            <p className="text-white/40 font-body text-base leading-relaxed max-w-md mx-auto mb-10">
              Free and open to anyone drawn to these traditions.
              Sign in to join the discussion, the reading groups,
              and the quarterly letter.
            </p>

            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={joining}
                className="px-10 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-50 bg-[#9e4a3a]"
              >
                {joining ? 'Joining...' : 'Join the Society'}
              </button>
            ) : (
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent('/ficino-society')}`}
                className="inline-block px-10 py-3.5 rounded text-white text-[15px] font-sans tracking-wide transition-all hover:brightness-110 bg-[#9e4a3a]"
              >
                Sign in to join
              </Link>
            )}
          </div>
        </section>
      )}

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
          <p className="text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body">
            Every book, every translation, every page is free to read,
            search, and cite. No account required, no paywalls, no
            restrictions on scholarship. The Society is about community,
            not access. The knowledge belongs to everyone.
          </p>
        </div>
      </section>

      {/* ================================================================ */}
      {/* CONTRIBUTE — optional financial support                          */}
      {/* ================================================================ */}
      <section className="bg-[#fdfcf9]">
        <div className="max-w-[580px] mx-auto px-6 py-24 md:py-28">
          <Ornament />
          <h2
            className="text-2xl md:text-3xl font-serif text-[#1a1612] mt-8 mb-6 text-center"
            style={{ fontWeight: 400 }}
          >
            Support the work
          </h2>
          <div className="space-y-5 text-[17px] md:text-[18px] leading-[1.85] text-[#333] font-body text-center max-w-md mx-auto">
            <p>
              The recommended contribution is $100 per year. That&apos;s roughly
              the cost of translating twenty pages of sixteenth-century
              Latin &mdash; one chapter of a book that may never have been
              read in English before.
            </p>
            <p>
              Contributors can dedicate one translation per year &mdash;
              choose a book and put your name on it, permanently.
            </p>
          </div>

          <div className="text-center mt-10">
            {status === 'authenticated' ? (
              <>
                <button
                  onClick={handleContribute}
                  disabled={contributing || isContributor}
                  className="px-10 py-3.5 rounded text-[15px] font-sans tracking-wide transition-all hover:brightness-110 disabled:opacity-50 border border-[#1a1612] text-[#1a1612] bg-transparent"
                >
                  {isContributor ? 'Thank you' : contributing ? 'Redirecting...' : 'Contribute $100 / year'}
                </button>
                {!isMember && (
                  <p className="mt-4 text-[13px] text-[#8a8480] font-body">
                    You can also <a href="#join" className="underline">join without contributing</a>.
                  </p>
                )}
              </>
            ) : (
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent('/ficino-society')}`}
                className="inline-block px-10 py-3.5 rounded text-[15px] font-sans tracking-wide transition-all hover:brightness-110 border border-[#1a1612] text-[#1a1612]"
              >
                Sign in to contribute
              </Link>
            )}
          </div>

          <p className="mt-8 text-[13px] text-[#8a8480] leading-relaxed text-center font-body">
            If you&apos;d like to contribute a different amount, write to{' '}
            <a href="mailto:hello@sourcelibrary.org" className="underline hover:text-[#6b6560] transition-colors">
              hello@sourcelibrary.org
            </a>.
          </p>
        </div>
      </section>

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
