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
