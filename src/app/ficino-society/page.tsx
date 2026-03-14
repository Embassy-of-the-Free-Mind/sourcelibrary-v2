'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import type { MembershipInfo } from '@/lib/membership';

export default function FicinoSocietyPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === 'true';
  const [membership, setMembership] = useState<MembershipInfo | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (session?.user) {
      fetch('/api/membership').then(r => r.json()).then(setMembership);
    }
  }, [session]);

  const handleJoin = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/stripe/checkout', { method: 'POST' });
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
        {/* Header */}
        <div className="text-center mb-12">
          <h1
            className="text-4xl md:text-5xl font-serif font-medium mb-4 tracking-tight"
            style={{ color: 'var(--text-primary)' }}
          >
            The Ficino Society
          </h1>
          <p className="text-lg" style={{ color: 'var(--text-secondary)' }}>
            A cooperative of scholars and seekers sustaining the digitization
            and translation of ancient texts.
          </p>
        </div>

        {/* Success state */}
        {success && (
          <div
            className="rounded-xl p-6 mb-8 text-center"
            style={{ background: 'var(--bg-warm)', border: '1px solid var(--accent-sage)' }}
          >
            <h2 className="text-xl font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              Welcome to the Ficino Society
            </h2>
            <p style={{ color: 'var(--text-secondary)' }}>
              Your membership is active. Thank you for supporting the preservation of these texts.
            </p>
          </div>
        )}

        {/* Already a member */}
        {isMember && !success && (
          <div
            className="rounded-xl p-6 mb-8 text-center"
            style={{ background: 'var(--bg-warm)', border: '1px solid var(--accent-sage)' }}
          >
            <h2 className="text-xl font-serif font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              You are a member
            </h2>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {membership?.expiresAt && `Renews ${new Date(membership.expiresAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`}
            </p>
          </div>
        )}

        {/* What you get */}
        <div
          className="rounded-xl p-8 mb-8"
          style={{ background: 'white', border: '1px solid var(--border-light)' }}
        >
          <h2 className="text-xl font-serif font-medium mb-6" style={{ color: 'var(--text-primary)' }}>
            Membership includes
          </h2>
          <ul className="space-y-4">
            {[
              { title: 'High-resolution gallery downloads', desc: 'Full-size images from thousands of rare illustrations — woodcuts, emblems, diagrams, engravings.' },
              { title: 'Print ordering', desc: 'Museum-quality prints of gallery images on archival paper, shipped worldwide.' },
              { title: 'Full translation downloads', desc: 'Download complete books as EPUB, PDF, or plain text.' },
              { title: 'API access', desc: 'Programmatic access to the full catalog for research tools, AI applications, and scholarship.' },
              { title: 'Named in the colophon', desc: 'Your name appears in the supporter credits of every scholarly edition we publish.' },
            ].map((item) => (
              <li key={item.title} className="flex gap-3">
                <span className="mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent-rust)' }} />
                <div>
                  <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{item.title}</span>
                  <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* What stays free */}
        <div
          className="rounded-xl p-8 mb-8"
          style={{ background: 'white', border: '1px solid var(--border-light)' }}
        >
          <h2 className="text-xl font-serif font-medium mb-4" style={{ color: 'var(--text-primary)' }}>
            Everything else stays free
          </h2>
          <p className="mb-4" style={{ color: 'var(--text-secondary)' }}>
            Reading, browsing, searching, citing — all free, no account required.
            Membership sustains the work; it doesn&apos;t gate the knowledge.
          </p>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            If you can&apos;t afford the membership fee, reach out to us at{' '}
            <a href="mailto:hello@sourcelibrary.org" style={{ color: 'var(--accent-rust)' }}>
              hello@sourcelibrary.org
            </a>
            . We&apos;ll work something out.
          </p>
        </div>

        {/* CTA */}
        {!isMember && (
          <div className="text-center">
            <div className="mb-6">
              <span className="text-3xl font-serif font-medium" style={{ color: 'var(--text-primary)' }}>$100</span>
              <span className="text-lg ml-1" style={{ color: 'var(--text-muted)' }}>/ year</span>
            </div>
            {status === 'authenticated' ? (
              <button
                onClick={handleJoin}
                disabled={loading}
                className="inline-block px-8 py-3 rounded-lg text-white text-lg font-medium transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--accent-rust)' }}
              >
                {loading ? 'Redirecting to checkout...' : 'Join the Ficino Society'}
              </button>
            ) : (
              <Link
                href="/auth/signin?callbackUrl=/ficino-society"
                className="inline-block px-8 py-3 rounded-lg text-white text-lg font-medium transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent-rust)' }}
              >
                Sign in to join
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
