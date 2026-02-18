'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

interface BetaGateModalProps {
  onSuccess: (email: string) => void;
  onDismiss: () => void;
}

export default function BetaGateModal({ onSuccess, onDismiss }: BetaGateModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'magic-sent' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [mode, setMode] = useState<'email' | 'magic'>('email');

  // Quick email — just collect + localStorage, no auth
  const handleQuickEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'reader_gate' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Something went wrong');
        setStatus('error');
        return;
      }
      onSuccess(email.trim());
    } catch {
      setErrorMsg('Network error — please try again');
      setStatus('error');
    }
  };

  // Magic link — real auth via next-auth
  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      // Also subscribe for the email list
      fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), source: 'reader_gate_magic' }),
      }).catch(() => {}); // fire-and-forget

      await signIn('email', {
        email: email.trim(),
        callbackUrl: window.location.pathname,
        redirect: false,
      });
      setStatus('magic-sent');
    } catch {
      setErrorMsg('Could not send sign-in link');
      setStatus('error');
    }
  };

  const handleGoogleSignIn = () => {
    // Also fire subscribe as fire-and-forget for tracking
    signIn('google', { callbackUrl: window.location.pathname });
  };

  // Magic link sent state
  if (status === 'magic-sent') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onDismiss} />
        <div
          className="relative w-full max-w-md rounded-2xl shadow-xl p-10 border"
          style={{
            background: 'var(--bg-cream, #fdfcf9)',
            borderColor: 'var(--border-light, #e8e4dc)',
          }}
        >
          <div className="text-center">
            <div className="w-14 h-14 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: 'var(--bg-warm, #f5f0e8)' }}>
              <svg className="w-7 h-7" style={{ color: 'var(--accent-rust, #9e4a3a)' }} fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
            </div>
            <h3
              className="text-xl mb-2"
              style={{ fontFamily: 'Cormorant Garamond, Georgia, serif', color: 'var(--text-primary, #1a1612)', fontWeight: 500 }}
            >
              Check your email
            </h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted, #6b6560)' }}>
              We sent a sign-in link to <strong style={{ color: 'var(--text-primary, #1a1612)' }}>{email}</strong>.
              <br />Click it to access the full library.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onDismiss} />

      {/* Modal */}
      <div
        className="relative w-full max-w-md rounded-2xl shadow-xl border overflow-hidden"
        style={{
          background: 'var(--bg-cream, #fdfcf9)',
          borderColor: 'var(--border-light, #e8e4dc)',
        }}
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-4 right-4 rounded-full p-1.5 transition-colors"
          style={{ color: 'var(--text-faint, #8a8480)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary, #1a1612)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint, #8a8480)'}
          aria-label="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="px-10 pt-10 pb-8">
          {/* Brand mark + heading */}
          <div className="text-center mb-8">
            {/* Brand icon */}
            <img
              src="/brand/svg/icon-only--black-on-white.svg"
              alt="Source Library"
              className="mx-auto mb-5"
              style={{ width: 48, height: 48 }}
            />
            <h2
              className="text-2xl mb-2"
              style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                color: 'var(--text-primary, #1a1612)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
              }}
            >
              Read the full text
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted, #6b6560)', fontFamily: 'Newsreader, Georgia, serif' }}>
              5,000+ rare books, translated for the first time.
              <br />Free access — just your email.
            </p>
          </div>

          {mode === 'email' ? (
            <>
              {/* Quick email form */}
              <form onSubmit={handleQuickEmail} className="space-y-3">
                <input
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                  style={{
                    background: 'var(--bg-warm, #f5f0e8)',
                    color: 'var(--text-primary, #1a1612)',
                    border: '1px solid var(--border-medium, #d4cfc4)',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-rust, #9e4a3a)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-medium, #d4cfc4)'}
                  disabled={status === 'loading'}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full px-4 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                  style={{
                    background: 'var(--accent-rust, #9e4a3a)',
                    color: '#ffffff',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}
                  onMouseEnter={(e) => { if (status !== 'loading') e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {status === 'loading' ? 'Opening...' : 'Continue'}
                </button>
              </form>

              {/* Divider */}
              <div className="flex items-center gap-3 my-5">
                <div className="flex-1 h-px" style={{ background: 'var(--border-light, #e8e4dc)' }} />
                <span className="text-xs" style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif' }}>or</span>
                <div className="flex-1 h-px" style={{ background: 'var(--border-light, #e8e4dc)' }} />
              </div>

              {/* Google sign-in */}
              <button
                onClick={handleGoogleSignIn}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all"
                style={{
                  background: 'var(--bg-warm, #f5f0e8)',
                  color: 'var(--text-primary, #1a1612)',
                  border: '1px solid var(--border-medium, #d4cfc4)',
                  fontFamily: 'Inter, system-ui, sans-serif',
                }}
                onMouseEnter={(e) => e.currentTarget.style.borderColor = 'var(--accent-rust, #9e4a3a)'}
                onMouseLeave={(e) => e.currentTarget.style.borderColor = 'var(--border-medium, #d4cfc4)'}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Continue with Google
              </button>

              {/* Magic link option */}
              <button
                onClick={() => setMode('magic')}
                className="w-full text-center mt-3 text-xs transition-colors"
                style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-rust, #9e4a3a)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint, #8a8480)'}
              >
                Sign in with a magic link instead
              </button>
            </>
          ) : (
            <>
              {/* Magic link form */}
              <form onSubmit={handleMagicLink} className="space-y-3">
                <input
                  type="email"
                  required
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-3 rounded-lg text-sm outline-none transition-all"
                  style={{
                    background: 'var(--bg-warm, #f5f0e8)',
                    color: 'var(--text-primary, #1a1612)',
                    border: '1px solid var(--border-medium, #d4cfc4)',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}
                  onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-rust, #9e4a3a)'}
                  onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-medium, #d4cfc4)'}
                  disabled={status === 'loading'}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={status === 'loading'}
                  className="w-full px-4 py-3 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                  style={{
                    background: 'var(--accent-rust, #9e4a3a)',
                    color: '#ffffff',
                    fontFamily: 'Inter, system-ui, sans-serif',
                  }}
                  onMouseEnter={(e) => { if (status !== 'loading') e.currentTarget.style.opacity = '0.9'; }}
                  onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
                >
                  {status === 'loading' ? 'Sending...' : 'Send sign-in link'}
                </button>
              </form>

              <button
                onClick={() => setMode('email')}
                className="w-full text-center mt-4 text-xs transition-colors"
                style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif' }}
                onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-rust, #9e4a3a)'}
                onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint, #8a8480)'}
              >
                &larr; Back to quick access
              </button>
            </>
          )}

          {status === 'error' && (
            <p className="text-sm mt-3 text-center" style={{ color: '#b91c1c' }}>{errorMsg}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-10 py-4 text-center"
          style={{ borderTop: '1px solid var(--border-light, #e8e4dc)' }}
        >
          <p className="text-xs" style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif' }}>
            We don&apos;t share your email. Ever.
          </p>
        </div>
      </div>
    </div>
  );
}
