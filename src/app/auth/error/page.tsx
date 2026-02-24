import Link from 'next/link';

export default function AuthErrorPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
      <div className="w-full max-w-md p-8 rounded-2xl text-center" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
        <div className="w-16 h-16 mx-auto mb-6 rounded-full flex items-center justify-center" style={{ background: '#fef2f2' }}>
          <svg
            className="w-8 h-8 text-status-error"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          Sign-in failed
        </h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
          Something went wrong during sign-in. The link may have expired or already been used.
        </p>
        <div className="space-y-3">
          <Link
            href="/auth/signin"
            className="inline-block w-full px-4 py-3 rounded-lg font-medium transition-all hover:opacity-90"
            style={{ background: 'var(--text-primary, #1c1917)', color: '#ffffff' }}
          >
            Try again
          </Link>
          <Link
            href="/"
            className="block text-sm underline"
            style={{ color: 'var(--text-muted)' }}
          >
            Return to library
          </Link>
        </div>
      </div>
    </div>
  );
}
