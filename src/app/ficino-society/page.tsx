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

  // After payment: poll until the webhook has activated membership, then refresh the session
  useEffect(() => {
    if (!success || !session?.user) return;
    setActivating(true);

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20; // 20 x 1.5s = 30s max wait

    const poll = async () => {
      while (!cancelled && attempts < maxAttempts) {
        attempts++;
        try {
          const res = await fetch('/api/membership');
          const data = await res.json();
          if (data.active) {
            setMembership(data);
            setActivating(false);
            // Refresh the JWT so session.user.membership updates everywhere
            await updateSession();
            return;
          }
        } catch {
          // Retry on failure
        }
        await new Promise(r => setTimeout(r, 1500));
      }
      // Webhook hasn't fired yet — show success anyway, session will catch up on next sign-in
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
    <div className="min-h-screen" style={{ background: 'var(--bg-cream)' }}>
      <div className="max-w-2xl mx-auto px-4 py-16 md:py-24">

        {/* Success state */}
        {success && (
          <div
            className="rounded-xl p-8 mb-12 text-center"
            style={{ background: 'var(--bg-warm)', border: `1px solid ${activating ? 'var(--border-light)' : 'var(--accent-sage)'}` }}
          >
            {activating ? (
              <>
                <h1 className="text-2xl font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
                  Activating your membership...
                </h1>
                <p style={{ color: 'var(--text-secondary)' }}>
                  This usually takes just a moment.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-serif font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                  Welcome to the Ficino Society
                </h1>
                <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                  Your membership is active. You now have full access to high-resolution
                  gallery downloads and the complete translated collection.
                </p>
                <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
                  {returnUrl ? (
                    <Link
                      href={returnUrl}
                      className="inline-block px-6 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
                      style={{ background: 'var(--accent-rust)' }}
                    >
                      Continue where you left off
                    </Link>
                  ) : (
                    <Link
                      href="/gallery"
                      className="inline-block px-6 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
                      style={{ background: 'var(--accent-rust)' }}
                    >
                      Browse the gallery
                    </Link>
                  )}
                  <Link
                    href="/account"
                    className="inline-block px-6 py-2.5 rounded-lg font-medium transition-opacity hover:opacity-90"
                    style={{ background: 'white', color: 'var(--text-primary)', border: '1px solid var(--border-light)' }}
                  >
                    Your account
                  </Link>
                </div>
              </>
            )}
          </div>
        )}

        {/* Already a member */}
        {isMember && !success && (
          <div
            className="rounded-xl p-6 mb-12 text-center"
            style={{ background: 'var(--bg-warm)', border: '1px solid var(--accent-sage)' }}
          >
            <h2 className="text-xl font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              You are a member of the Ficino Society
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {membership?.expiresAt && `Renews ${new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
            </p>
          </div>
        )}

        {/* Header — the pitch */}
        <div className="mb-12">
          <h1
            className="text-4xl md:text-5xl font-serif font-medium mb-6 tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            The Ficino Society
          </h1>
          <div className="space-y-4 text-[17px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <p>
              In 1462, Cosimo de&apos; Medici gave Marsilio Ficino a villa and a stack of Greek manuscripts,
              and asked him to translate them. What followed was the recovery of an entire intellectual
              tradition — Plato, the Hermetica, Plotinus — that had been lost to the Latin West for a thousand years.
              It changed everything.
            </p>
            <p>
              Source Library is doing something similar, at a different scale.
              We are digitizing thousands of rare texts in alchemy, Kabbalah, astrology,
              natural philosophy, and the Western esoteric tradition, and translating them into
              English for the first time — many from books that exist in only a handful of libraries worldwide.
            </p>
            <p>
              The Ficino Society is for people who want this work to continue.
              Your membership directly funds the digitization, translation, and preservation of these texts.
              Everything in the library remains free to read. Your support makes that possible.
            </p>
          </div>
        </div>

        {/* What members get */}
        <div
          className="rounded-xl p-8 mb-8"
          style={{ background: 'white', border: '1px solid var(--border-light)' }}
        >
          <h2 className="text-xl font-serif font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
            As a member
          </h2>
          <div className="space-y-5">
            {[
              { title: 'Download high-resolution images', desc: 'Full-size gallery images — woodcuts, emblems, engravings, diagrams — for research, printing, or simply having.' },
              { title: 'Download complete translations', desc: 'Every translated book as EPUB, PDF, or plain text. Take them offline, annotate them, share them.' },
              { title: 'Order archival prints', desc: 'Gallery images printed on museum-quality archival paper and shipped worldwide.' },
              { title: 'API access', desc: 'Programmatic access to the full catalog and translations — for research tools, AI applications, or your own projects.' },
              { title: 'Your name in the colophon', desc: 'Supporters are credited in every scholarly edition we publish.' },
            ].map((item) => (
              <div key={item.title} className="flex gap-3">
                <span className="mt-2 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent-rust)' }} />
                <div>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* The commitment */}
        <div
          className="rounded-xl p-8 mb-10"
          style={{ background: 'white', border: '1px solid var(--border-light)' }}
        >
          <h2 className="text-xl font-serif font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            The library stays free
          </h2>
          <p className="leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
            Every book, every translation, every page — free to read, search, and cite.
            No account required, no paywalls, no restrictions on scholarship.
            Membership sustains the work. It does not gate the knowledge.
          </p>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            If the membership fee is a barrier for you, write to{' '}
            <a href="mailto:hello@sourcelibrary.org" className="underline" style={{ color: 'var(--text-muted)' }}>
              hello@sourcelibrary.org
            </a>
            {' '}and we will find an amount that works. No questions, no proof required.
          </p>
        </div>

        {/* CTA */}
        {!isMember && (
          <div className="text-center py-4">
            <div className="mb-6">
              <span className="text-3xl font-serif font-medium" style={{ color: 'var(--text-primary)' }}>$100</span>
              <span className="text-lg ml-1" style={{ color: 'var(--text-muted)' }}>/ year</span>
            </div>
            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={loading}
                className="inline-block px-10 py-3.5 rounded-lg text-white text-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent-rust)' }}
              >
                {loading ? 'Redirecting to checkout...' : 'Join the Ficino Society'}
              </button>
            ) : (
              <Link
                href={`/auth/signin?callbackUrl=${encodeURIComponent(`/ficino-society${returnUrl ? `?return=${encodeURIComponent(returnUrl)}` : ''}`)}`}
                className="inline-block px-10 py-3.5 rounded-lg text-white text-lg font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent-rust)' }}
              >
                Sign in to join
              </Link>
            )}
            <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              Billed annually. You can cancel at any time from your account.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
