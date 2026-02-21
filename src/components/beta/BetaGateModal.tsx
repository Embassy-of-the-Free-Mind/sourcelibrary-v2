'use client';

import { useState } from 'react';

interface BetaGateModalProps {
  onSuccess: (email: string) => void;
  onDismiss: () => void;
  bookCount?: number;
}

export default function BetaGateModal({ onSuccess, onDismiss }: BetaGateModalProps) {
  const [email, setEmail] = useState('');
  const [comment, setComment] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setStatus('loading');
    setErrorMsg('');

    try {
      const res = await fetch('/api/beta/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          source: 'reader_gate',
          ...(comment.trim() && { comment: comment.trim() }),
        }),
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      {/* Backdrop — lighter so page content shows through blurred */}
      <div className="absolute inset-0 bg-black/30 backdrop-blur-md" onClick={onDismiss} />

      {/* Modal */}
      <div
        className="relative w-full max-w-2xl rounded-2xl sm:rounded-3xl shadow-2xl border overflow-hidden"
        style={{
          background: 'var(--bg-cream, #fdfcf9)',
          borderColor: 'var(--border-light, #e8e4dc)',
          animation: 'fadeInUp 0.3s ease-out',
        }}
      >
        {/* Close button */}
        <button
          onClick={onDismiss}
          className="absolute top-5 right-5 sm:top-7 sm:right-7 rounded-full p-2 transition-colors z-10"
          style={{ color: 'var(--text-faint, #8a8480)' }}
          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--text-primary, #1a1612)'}
          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint, #8a8480)'}
          aria-label="Close"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        <div className="px-6 pt-10 pb-6 sm:px-16 sm:pt-16 sm:pb-12">
          {/* Heading area */}
          <div className="text-center mb-8 sm:mb-12">
            <img
              src="/brand/svg/icon-only--black-on-white.svg"
              alt="SourceLibrary"
              className="mx-auto mb-6 sm:mb-8"
              style={{ width: 56, height: 56 }}
            />
            <h2
              className="mb-4 sm:mb-5"
              style={{
                fontFamily: 'Cormorant Garamond, Georgia, serif',
                color: 'var(--text-primary, #1a1612)',
                fontWeight: 500,
                letterSpacing: '-0.01em',
                lineHeight: 1.1,
                fontSize: 'clamp(1.75rem, 5vw, 2.75rem)',
              }}
            >
              Welcome to the SourceLibrary
            </h2>
            <p
              className="leading-relaxed mb-5 sm:mb-7"
              style={{
                color: 'var(--text-muted, #6b6560)',
                fontFamily: 'Newsreader, Georgia, serif',
                maxWidth: '32em',
                margin: '0 auto',
                fontSize: 'clamp(1rem, 2.5vw, 1.25rem)',
              }}
            >
              Share your email for beta access to 1,234 rare books,
              translated and searchable for the first time.
            </p>
            <p
              className="leading-relaxed"
              style={{
                color: 'var(--text-secondary, #444)',
                fontFamily: 'Newsreader, Georgia, serif',
                fontStyle: 'italic',
                fontSize: 'clamp(0.9rem, 2vw, 1.1rem)',
              }}
            >
              We truly appreciate your participation, support, and feedback.
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
            <input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-lg outline-none transition-all"
              style={{
                background: 'var(--bg-warm, #f5f0e8)',
                color: 'var(--text-primary, #1a1612)',
                border: '1px solid var(--border-medium, #d4cfc4)',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '17px',
                padding: '16px 20px',
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-rust, #9e4a3a)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-medium, #d4cfc4)'}
              disabled={status === 'loading'}
              autoFocus
            />
            <textarea
              placeholder="Optionally, please introduce yourself or your interest"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full rounded-lg outline-none transition-all resize-none"
              style={{
                background: 'var(--bg-warm, #f5f0e8)',
                color: 'var(--text-primary, #1a1612)',
                border: '1px solid var(--border-medium, #d4cfc4)',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '16px',
                padding: '14px 20px',
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = 'var(--accent-rust, #9e4a3a)'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'var(--border-medium, #d4cfc4)'}
              disabled={status === 'loading'}
            />
            <button
              type="submit"
              disabled={status === 'loading'}
              className="w-full rounded-lg font-medium transition-all disabled:opacity-50"
              style={{
                background: 'var(--accent-rust, #9e4a3a)',
                color: '#ffffff',
                fontFamily: 'Inter, system-ui, sans-serif',
                fontSize: '17px',
                padding: '16px 20px',
              }}
              onMouseEnter={(e) => { if (status !== 'loading') e.currentTarget.style.opacity = '0.9'; }}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
            >
              {status === 'loading' ? 'Opening...' : 'Continue'}
            </button>
          </form>

          {status === 'error' && (
            <p className="mt-4 text-center" style={{ color: '#b91c1c', fontSize: '15px' }}>{errorMsg}</p>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-5 sm:px-16 flex items-center justify-between"
          style={{ borderTop: '1px solid var(--border-light, #e8e4dc)' }}
        >
          <p style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px' }}>
            No spam, ever.
          </p>
          <button
            onClick={onDismiss}
            className="transition-colors"
            style={{ color: 'var(--text-faint, #8a8480)', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '14px' }}
            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--accent-rust, #9e4a3a)'}
            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-faint, #8a8480)'}
          >
            Browse first
          </button>
        </div>
      </div>

      <style>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(16px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}
