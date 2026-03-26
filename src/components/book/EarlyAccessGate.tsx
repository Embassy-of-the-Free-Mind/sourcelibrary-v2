'use client';

import { useSession } from 'next-auth/react';
import Link from 'next/link';

interface EarlyAccessGateProps {
  membersOnlyUntil: string; // ISO date
  children: React.ReactNode;
}

/**
 * Wraps book content that's in the early access window.
 * Members see the content immediately. Everyone else sees a gentle message
 * explaining that the translation will be publicly available soon.
 */
export default function EarlyAccessGate({ membersOnlyUntil, children }: EarlyAccessGateProps) {
  const { data: session } = useSession();
  const isMember = (session?.user as any)?.membership != null;

  const until = new Date(membersOnlyUntil);
  const now = new Date();

  // Past the early access window — show to everyone
  if (until <= now) {
    return <>{children}</>;
  }

  // Members get early access
  if (isMember) {
    return (
      <>
        <div
          className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-6"
        >
          <div
            className="rounded-lg px-5 py-3 text-sm flex items-center gap-2"
            style={{ background: 'rgba(201,168,108,0.1)', color: 'var(--accent-gold-dark, #9e7c3c)' }}
          >
            <span>Early access</span>
            <span style={{ opacity: 0.5 }}>
              &mdash; public {until.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
            </span>
          </div>
        </div>
        {children}
      </>
    );
  }

  // Non-members see a message
  const daysLeft = Math.ceil((until.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div
        className="rounded-xl p-8 text-center max-w-lg mx-auto"
        style={{ background: 'var(--bg-warm)', border: '1px solid var(--border-light)' }}
      >
        <p className="text-lg font-serif mb-3" style={{ color: 'var(--text-primary)' }}>
          This translation is new.
        </p>
        <p className="leading-relaxed mb-4" style={{ color: 'var(--text-secondary)' }}>
          This translation will be available to everyone
          {daysLeft <= 1
            ? ' tomorrow.'
            : ` in ${daysLeft} days.`
          }
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/auth/signin"
            className="inline-block px-6 py-2.5 rounded-lg text-white font-medium transition-opacity hover:opacity-90"
            style={{ background: 'var(--accent-rust)' }}
          >
            Create a free account
          </Link>
        </div>
      </div>
    </div>
  );
}
