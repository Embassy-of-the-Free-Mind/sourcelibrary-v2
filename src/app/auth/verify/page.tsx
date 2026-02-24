import Link from 'next/link';

export default function VerifyRequestPage() {
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
          A sign-in link has been sent to your email address. Click the link to access the full Source Library collection.
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
