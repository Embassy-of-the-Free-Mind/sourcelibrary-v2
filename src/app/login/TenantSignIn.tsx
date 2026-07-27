'use client';

import Image from 'next/image';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { TurnstileWidget, turnstileConfigured } from '@/components/auth/TurnstileWidget';

interface TenantSignInProps {
  tenantSlug: string;
  tenantName: string;
  tenantId: string;
  allowSignup: boolean;
  callbackUrl: string;
}

export function TenantSignIn({
  tenantSlug,
  tenantName,
  tenantId,
  allowSignup,
  callbackUrl
}: TenantSignInProps) {
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [inviteRequired, setInviteRequired] = useState(false);
  // Same latent tripwire as the homepage hero: this form POSTs straight to
  // /api/auth/signin/nodemailer, so without a Turnstile token every tenant
  // sign-in would 403 the moment Turnstile is enabled. It is off today.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const router = useRouter();

  // Check if email has a pending invitation (only matters if allowSignup is false)
  const checkPendingInvite = async (emailToCheck: string): Promise<boolean> => {
    if (allowSignup) return true; // No restriction, allow signup

    try {
      const res = await fetch(`/api/tenants/${tenantId}/pending-invite?email=${encodeURIComponent(emailToCheck)}`);
      return res.ok;
    } catch {
      return false;
    }
  };

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;

    setLoading(true);
    setError('');

    try {
      // If signup is restricted, check for pending invite first
      if (!allowSignup) {
        const hasPendingInvite = await checkPendingInvite(email);
        if (!hasPendingInvite) {
          setInviteRequired(true);
          setLoading(false);
          return;
        }
      }

      const csrfRes = await fetch('/api/auth/csrf');
      const { csrfToken } = await csrfRes.json();

      const res = await fetch('/api/auth/signin/nodemailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          email,
          csrfToken,
          callbackUrl,
          'cf-turnstile-response': turnstileToken ?? '',
        }),
        redirect: 'follow',
      });

      if (res.ok || res.redirected) {
        setEmailSent(true);
      } else if (res.status === 429) {
        setError(
          'Too many sign-in requests from your network in the last hour. Wait a little and try again — this limit is shared by everyone on the same connection.',
        );
      } else {
        setError('Could not send sign-in link. Please try again.');
      }
    } catch {
      setError('Could not send sign-in link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    // If signup is restricted, check for pending invite first
    if (!allowSignup) {
      if (!email) {
        setError('Please enter your email to verify your invitation.');
        return;
      }
      const hasPendingInvite = await checkPendingInvite(email);
      if (!hasPendingInvite) {
        setInviteRequired(true);
        return;
      }
    }

    // Trigger sign-in with callback to update JWT with tenant context
    const result = await signIn('google', {
      callbackUrl,
      redirect: false
    });

    if (result?.ok) {
      // Trigger JWT update with tenant context for role resolution
      // This is done via a session update after signin
      router.push(callbackUrl);
    } else {
      setError('Failed to sign in with Google. Please try again.');
    }
  };

  if (emailSent) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>
              Check your email
            </h1>
            <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 16 }}>
              Sign-in link sent to <strong style={{ color: '#e6edf3' }}>{email}</strong>
            </p>
            <button onClick={() => setEmailSent(false)} style={linkButtonStyle}>
              Use a different email
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (inviteRequired) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>🔒</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>
              Invite Required
            </h1>
            <p style={{ fontSize: 14, color: '#8b949e', marginBottom: 24 }}>
              <strong style={{ color: '#e6edf3' }}>{tenantName}</strong> is by invitation only.
              {' '}
              <a href="mailto:team@sourcelibrary.org" style={{ color: '#58a6ff', textDecoration: 'none' }}>
                Contact the administrator
              </a>
              {' '}
              to request access.
            </p>
            <button onClick={() => { setInviteRequired(false); setEmail(''); }} style={linkButtonStyle}>
              Try another email
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <Image
            src="/brand/png/logo-compact--white-on-transparent--64h.png"
            alt="Source Library"
            width={0}
            height={0}
            sizes="200px"
            style={{ height: 28, width: 'auto', display: 'inline-block', marginBottom: 20 }}
          />
          <h1 style={{ fontSize: 18, fontWeight: 600, color: '#f0f6fc', margin: '0 0 4px' }}>
            {tenantName}
          </h1>
          <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>
            Sign in to access your library
          </p>
          {!allowSignup && (
            <p style={{ fontSize: 12, color: '#7b6f6b', margin: '8px 0 0', fontStyle: 'italic' }}>
              Invitation-only
            </p>
          )}
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#3d1a1a', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

        {/* Google */}
        <button onClick={handleGoogleSignIn} style={googleButtonStyle} disabled={loading}>
          <svg width="16" height="16" viewBox="0 0 16 16" style={{ marginRight: 8, flexShrink: 0 }}>
            <path d="M15.545 6.558a9.42 9.42 0 0 1 .139 1.626c0 2.434-.87 4.492-2.384 5.885h.002C11.978 15.292 10.158 16 8 16A8 8 0 1 1 8 0a7.689 7.689 0 0 1 5.352 2.082l-2.284 2.284A4.347 4.347 0 0 0 8 3.166c-2.087 0-3.86 1.408-4.492 3.304a4.792 4.792 0 0 0 0 3.063h.003c.635 1.893 2.405 3.301 4.492 3.301 1.078 0 2.004-.276 2.722-.764h-.003a3.702 3.702 0 0 0 1.599-2.431H8v-3.08h7.545z" fill="currentColor" />
          </svg>
          Continue with Google
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '16px 0' }}>
          <div style={{ flex: 1, height: 1, background: '#21262d' }} />
          <span style={{ fontSize: 12, color: '#8b949e' }}>or</span>
          <div style={{ flex: 1, height: 1, background: '#21262d' }} />
        </div>

        {/* Email */}
        <form onSubmit={handleEmailSignIn}>
          <label style={{ display: 'block', fontSize: 12, color: '#8b949e', marginBottom: 6 }}>
            Email address
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            required
            style={inputStyle}
            disabled={loading}
          />
          {/* Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. */}
          <TurnstileWidget onVerify={setTurnstileToken} />
          <button
            type="submit"
            disabled={loading || !email || (turnstileConfigured && !turnstileToken)}
            style={{ ...submitButtonStyle, opacity: loading || !email ? 0.5 : 1 }}
          >
            {loading ? 'Sending…' : 'Continue with Email'}
          </button>
        </form>

        <p style={{ fontSize: 11, color: '#8b949e', textAlign: 'center', marginTop: 20, marginBottom: 0 }}>
          By signing in you agree to{' '}
          <a href="/terms" style={{ color: '#58a6ff', textDecoration: 'none' }}>Terms of Service</a>
          {' '}and{' '}
          <a href="/privacy" style={{ color: '#58a6ff', textDecoration: 'none' }}>Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#0d1117',
};

const cardStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 380,
  padding: '36px 32px',
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 12,
  margin: '0 16px',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 6,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  fontSize: 14,
  outline: 'none',
  boxSizing: 'border-box',
  marginBottom: 8,
};

const submitButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 6,
  background: '#238636',
  color: '#ffffff',
  border: 'none',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
};

const googleButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 6,
  background: 'transparent',
  color: '#e6edf3',
  border: '1px solid #30363d',
  fontSize: 14,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const linkButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#58a6ff',
  fontSize: 13,
  cursor: 'pointer',
  textDecoration: 'underline',
};
