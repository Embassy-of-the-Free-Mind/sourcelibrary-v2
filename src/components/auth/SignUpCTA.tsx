'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface SignUpCTAProps {
  variant?: 'section' | 'inline';
}

export default function SignUpCTA({ variant = 'section' }: SignUpCTAProps) {
  const { data: session, status } = useSession();

  // Don't show to authenticated users or while loading
  if (status !== 'unauthenticated') return null;

  // Inline variant — just a small nudge within a larger section
  if (variant === 'inline') {
    return (
      <div className="text-center mt-10 pt-8" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p className="text-sm mb-3" style={{ color: '#6b6560' }}>
          Create a free account to save books and track your reading.
        </p>
        <Link
          href="/auth/signin"
          className="text-sm font-medium hover:underline"
          style={{ color: 'var(--accent-gold)' }}
        >
          Sign in with Google or email
        </Link>
      </div>
    );
  }

  // Full section variant (original)
  return (
    <section className="py-20 md:py-28" style={{ background: 'var(--bg-dark)' }}>
      <div className="px-6 md:px-12 max-w-2xl mx-auto text-center">
        <p
          className="text-sm uppercase tracking-[0.2em] mb-6"
          style={{ color: 'var(--accent-gold)' }}
        >
          Join the project
        </p>
        <h2
          className="text-2xl md:text-3xl lg:text-4xl font-display mb-5 leading-snug"
          style={{ color: '#f5f0e8' }}
        >
          Help recover the lost intellectual heritage of humanity
        </h2>
        <p
          className="text-base md:text-lg mb-10 max-w-lg mx-auto leading-relaxed"
          style={{ color: '#a09a90' }}
        >
          Create a free account to save books, track your reading, and follow
          new translations as they&apos;re published.
        </p>
        <Link
          href="/auth/signin"
          className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-full text-sm font-medium transition-all hover:brightness-110"
          style={{ background: 'var(--accent-rust)', color: '#fff' }}
        >
          Create free account
        </Link>
        <p className="text-xs mt-5" style={{ color: '#6b6560' }}>
          Sign in with Google or email &middot; No spam, ever
        </p>
      </div>
    </section>
  );
}
