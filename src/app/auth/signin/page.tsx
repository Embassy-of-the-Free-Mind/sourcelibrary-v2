'use client';

import { signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { BookLoader } from '@/components/ui/BookLoader';

function SignInContent() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get('callbackUrl') || '/';
  const error = searchParams.get('error');
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setEmailError('');
    try {
      // Auth.js v5 requires CSRF double-submit: fetch token first (sets cookie),
      // then POST to signin endpoint with that token in the body.
      const csrfRes = await fetch('/api/auth/csrf');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch('/api/auth/signin/nodemailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, csrfToken, callbackUrl }),
        redirect: 'follow',
      });
      if (res.ok || res.redirected) {
        setEmailSent(true);
      } else {
        setEmailError('Could not send sign-in link. Please try again.');
      }
    } catch {
      setEmailError('Could not send sign-in link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen relative flex items-center justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/auth-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50" />
        <div className="relative z-10 w-full max-w-md p-8 rounded-2xl text-center bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
          <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
            <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
            <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
          </svg>
          <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Check your email</h1>
          <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
            We sent a sign-in link to <strong>{email}</strong>. Click the link to access the library.
          </p>
          <button onClick={() => setEmailSent(false)} className="text-sm underline" style={{ color: 'var(--text-muted)' }}>
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* Background image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/auth-bg.jpg"
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative z-10 w-full max-w-md p-8 rounded-2xl bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 mb-4" aria-label="Source Library home">
            <svg className="w-10 h-10" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
              <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
              <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
            </svg>
            <span className="text-xl uppercase tracking-wider" style={{ color: 'var(--text-primary)' }}>
              <span className="font-semibold">Source</span>
              <span className="font-light">Library</span>
            </span>
          </Link>
          <h1 className="text-2xl font-display mb-2" style={{ color: 'var(--text-primary)' }}>
            Sign In
          </h1>
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            Access the full collection of rare texts in alchemy, Hermetica, and natural philosophy.
          </p>
        </div>

        {(error || emailError) && (
          <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {emailError
              ? emailError
              : error === 'OAuthAccountNotLinked'
                ? 'This email is already associated with another account.'
                : error === 'EmailSignin'
                  ? 'Could not send sign-in email. Please try again or use Google.'
                  : 'An error occurred during sign in. Please try again.'}
          </div>
        )}

        {/* Email sign-in */}
        <form onSubmit={handleEmailSignIn} className="mb-4">
          <label htmlFor="email" className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Email address
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            className="w-full px-4 py-3 rounded-lg text-base outline-none transition-all"
            style={{
              background: 'var(--bg-warm)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-medium)',
            }}
          />
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full mt-3 px-4 py-3 rounded-lg text-base font-medium transition-all hover:brightness-110 disabled:opacity-50"
            style={{ background: 'var(--accent-rust)', color: '#ffffff' }}
          >
            {loading ? 'Sending link...' : 'Continue with Email'}
          </button>
        </form>

        <div className="flex items-center gap-3 my-6">
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>or</span>
          <div className="flex-1 h-px" style={{ background: 'var(--border-light)' }} />
        </div>

        <div className="space-y-3">
          <button
            onClick={() => signIn('google', { callbackUrl })}
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
        </div>

        <p className="mt-4 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
          By signing in, you agree to our{' '}
          <Link href="/terms" className="underline hover:opacity-80">terms of service</Link>
          {' '}and{' '}
          <Link href="/privacy" className="underline hover:opacity-80">privacy policy</Link>.
        </p>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
        <BookLoader size="xs" />
      </div>
    }>
      <SignInContent />
    </Suspense>
  );
}
