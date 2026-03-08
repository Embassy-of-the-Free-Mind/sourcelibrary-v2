'use client';

import { signIn } from 'next-auth/react';
import { usePathname } from 'next/navigation';

interface AuthPromptProps {
  message?: string;
  onClose?: () => void;
  className?: string;
}

/**
 * Inline sign-up prompt shown when an anonymous user tries a feature that requires auth.
 * Compact and contextual — not a full-page modal.
 */
export default function AuthPrompt({
  message = 'Sign in to save your activity across devices',
  onClose,
  className = '',
}: AuthPromptProps) {
  const pathname = usePathname();
  const callbackUrl = pathname || '/';

  return (
    <div
      className={`rounded-xl p-4 shadow-lg max-w-xs ${className}`}
      style={{
        background: 'var(--bg-white, #fff)',
        border: '1px solid var(--border-light)',
      }}
    >
      <p
        className="text-sm mb-3 leading-relaxed"
        style={{ color: 'var(--text-secondary)' }}
      >
        {message}
      </p>

      <div className="space-y-2">
        <button
          onClick={() => signIn('google', { callbackUrl })}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{
            background: 'var(--bg-warm)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-medium)',
          }}
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <button
          onClick={() => signIn('email', { callbackUrl })}
          className="w-full px-3 py-2 rounded-lg text-sm font-medium transition-all hover:opacity-90"
          style={{
            background: 'var(--text-primary, #1c1917)',
            color: '#ffffff',
          }}
        >
          Sign in with email
        </button>
      </div>

      {onClose && (
        <button
          onClick={onClose}
          className="w-full mt-2 text-xs text-center py-1 transition-colors"
          style={{ color: 'var(--text-faint)' }}
        >
          Not now
        </button>
      )}
    </div>
  );
}
