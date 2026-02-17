'use client';

import { signIn } from 'next-auth/react';
import { useState } from 'react';
import Link from 'next/link';

interface RegistrationWallProps {
  bookTitle: string;
  freeBookCount: number;
}

export default function RegistrationWall({ bookTitle, freeBookCount }: RegistrationWallProps) {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      const currentPath = window.location.pathname;
      await signIn('email', { email, callbackUrl: currentPath, redirect: false });
      setSent(true);
    } catch {
      // Fall through
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <div className="max-w-lg mx-auto text-center py-16 px-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-warm)' }}>
          <svg className="w-8 h-8" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
        </div>
        <h3 className="text-xl font-medium mb-2" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
          Check your email
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          We sent a sign-in link to <strong>{email}</strong>. Click it to access this book.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto text-center py-16 px-6">
      <div className="card p-8">
        <h3 className="text-2xl font-medium mb-3" style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary)' }}>
          Register to keep reading
        </h3>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)', lineHeight: '1.6' }}>
          <strong>{freeBookCount} books</strong> are free and open to everyone.
          Register with your email for free access to the full collection of 5,000+ rare texts.
          No payment required — ever.
        </p>

        {/* Email sign-in */}
        <form onSubmit={handleEmailSignIn} className="mb-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all mb-3"
            style={{
              background: 'var(--bg-warm)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-medium)',
            }}
          />
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--text-primary, #1c1917)', color: '#ffffff' }}
          >
            {loading ? 'Sending link...' : 'Continue with email'}
          </button>
        </form>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
        </div>

        <button
          onClick={() => signIn('google', { callbackUrl: window.location.pathname })}
          className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90"
          style={{ background: 'var(--bg-warm)', color: 'var(--text-primary)', border: '1px solid var(--border-medium)' }}
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <p className="mt-6 text-xs" style={{ color: 'var(--text-faint)' }}>
          By registering, you agree to our{' '}
          <Link href="/terms" className="underline hover:opacity-80">terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:opacity-80">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}
