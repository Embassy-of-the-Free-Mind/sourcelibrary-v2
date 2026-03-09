import Link from 'next/link';

export default function VerifyRequestPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-cream)' }}>
      <div className="w-full max-w-md p-8 rounded-2xl text-center" style={{ background: 'var(--bg-white)', border: '1px solid var(--border-light)' }}>
        <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
        </svg>
        <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
          Check your email
        </h1>
        <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
          A sign-in link has been sent to your email address. Click the link to unlock the full Source Library collection.
        </p>
        <Link
          href="/"
          className="text-sm underline"
          style={{ color: 'var(--text-muted)' }}
        >
          Return to library
        </Link>
      </div>
    </div>
  );
}
