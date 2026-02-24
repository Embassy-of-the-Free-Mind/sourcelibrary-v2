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

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    try {
      await signIn('email', { email, callbackUrl, redirect: false });
      setEmailSent(true);
    } catch {
      // Fall through to error state
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
        <div className="w-full max-w-md p-8 rounded-2xl text-center" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
          <div className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-warm)' }}>
            <svg className="w-8 h-8" style={{ color: 'var(--text-primary)' }} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            </svg>
          </div>
          <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Check your email
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            We sent a sign-in link to <strong>{email}</strong>. Click the link in the email to access the library.
          </p>
          <button
            onClick={() => setEmailSent(false)}
            className="text-sm underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
      <div className="w-full max-w-md p-8 rounded-2xl" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
        <div className="text-center mb-8">
          <h1 className="text-3xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
            Source Library
          </h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Sign in for free to access the full collection
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 rounded-lg text-sm" style={{ background: '#fef2f2', color: '#991b1b' }}>
            {error === 'OAuthAccountNotLinked'
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
            className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
            style={{
              background: 'var(--bg-warm)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-medium)',
            }}
          />
          <button
            type="submit"
            disabled={loading || !email}
            className="w-full mt-3 px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90 disabled:opacity-50"
            style={{ background: 'var(--text-primary, #1c1917)', color: '#ffffff' }}
          >
            {loading ? 'Sending link...' : 'Continue with email'}
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

        <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-faint)' }}>
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
