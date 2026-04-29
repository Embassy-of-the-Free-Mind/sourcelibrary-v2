'use client';

import { useState } from 'react';

const CALLBACK_URL = '/platform/dashboard';

export function PlatformSignIn() {
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleEmailSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setLoading(true);
    setError('');
    try {
      // Preflight: validate email is a platform admin before sending the magic link
      const checkRes = await fetch('/api/platform/auth/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!checkRes.ok) {
        const data = await checkRes.json();
        setError(data.error || 'Access denied.');
        return;
      }

      // Email is authorized — proceed with NextAuth magic link
      const csrfRes = await fetch('/api/auth/csrf');
      const { csrfToken } = await csrfRes.json();
      const res = await fetch('/api/auth/signin/nodemailer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, csrfToken, callbackUrl: CALLBACK_URL }),
        redirect: 'follow',
      });
      if (res.ok || res.redirected) {
        setEmailSent(true);
      } else {
        setError('Could not send sign-in link. Please try again.');
      }
    } catch {
      setError('Could not send sign-in link. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (emailSent) {
    return (
      <div style={pageStyle}>
        <div style={cardStyle}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>◆</div>
            <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8, color: '#f0f6fc' }}>Check your email</h1>
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

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12, color: '#f0f6fc' }}>◆</div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: '#f0f6fc', margin: '0 0 4px' }}>
            Platform Admin
          </h1>
          <p style={{ fontSize: 13, color: '#8b949e', margin: 0 }}>
            Sign in with your superadmin account
          </p>
        </div>

        {error && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 6, background: '#3d1a1a', color: '#f87171', fontSize: 13 }}>
            {error}
          </div>
        )}

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
          />
          <button
            type="submit"
            disabled={loading || !email}
            style={{ ...buttonStyle, opacity: loading || !email ? 0.5 : 1 }}
          >
            {loading ? 'Sending...' : 'Continue with Email'}
          </button>
        </form>
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

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 16px',
  borderRadius: 6,
  background: '#238636',
  color: '#ffffff',
  border: 'none',
  fontSize: 14,
  fontWeight: 500,
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
