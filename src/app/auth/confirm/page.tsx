import Link from 'next/link';
import { headers } from 'next/headers';
import { ConfirmTracker } from './ConfirmTracker';

/**
 * Prefetch-safe magic-link interstitial.
 *
 * The email's "Sign in" button points here (/auth/confirm?next=<callback url>)
 * instead of straight at the one-time-token callback. Mail clients and security
 * scanners — Gmail's link prefetcher above all — GET links in an email to build
 * previews / scan for malware; pointed at the raw callback that GET burns the
 * single-use token before the human clicks, which is the dominant
 * /auth/error?error=Verification failure. They land HERE instead (no token
 * consumed) and stop; only a real click on the button below follows through to
 * the callback, so the token survives until the person actually uses it.
 *
 * Deliberately a static server component with NO auto-redirect — an auto
 * redirect (meta-refresh / JS) would re-introduce the prefetch consumption.
 * The button is a plain <a> to the absolute callback URL so Next.js never
 * prefetches it.
 */

// Only forward to a same-site NextAuth callback — never an arbitrary URL
// (open-redirect / token-leak guard).
function isSafeNext(next: string | undefined, requestHost: string | null): next is string {
  if (!next) return false;
  let u: URL;
  try {
    u = new URL(next);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!u.pathname.startsWith('/api/auth/callback/')) return false;
  // Same host as this request, or any *.sourcelibrary.org (shared-cookie
  // subdomains), or localhost in dev.
  const host = u.host.toLowerCase();
  if (requestHost && host === requestHost.toLowerCase()) return true;
  if (host === 'sourcelibrary.org' || host.endsWith('.sourcelibrary.org')) return true;
  if (host.startsWith('localhost') || host.startsWith('127.0.0.1')) return true;
  return false;
}

export default async function ConfirmSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const requestHost = (await headers()).get('host');
  const safe = isSafeNext(next, requestHost);

  return (
    <div className="min-h-screen relative flex items-center justify-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/auth-bg.jpg" alt="" className="absolute inset-0 w-full h-full object-cover" />
      <div className="absolute inset-0 bg-black/50" />

      <div className="relative z-10 w-full max-w-md p-8 rounded-2xl text-center bg-white/95 backdrop-blur-sm border border-white/20 mx-4">
        <ConfirmTracker safe={safe} />
        <svg className="w-12 h-12 mx-auto mb-4" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <circle cx="12" cy="12" r="10" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="7" stroke="var(--text-primary)" strokeWidth="1" />
          <circle cx="12" cy="12" r="4" stroke="var(--text-primary)" strokeWidth="1" />
        </svg>

        {safe ? (
          <>
            <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              You&rsquo;re one tap away
            </h1>
            <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
              Confirm to finish signing in to Source Library.
            </p>
            {/* Plain <a> (not next/link) to the absolute callback URL so Next.js
                never prefetches it — only a human click consumes the token. */}
            <a
              id="confirm-signin"
              href={next}
              rel="nofollow"
              className="inline-block w-full px-4 py-3 rounded-lg text-base font-medium transition-all hover:brightness-110"
              style={{ background: 'var(--accent-rust)', color: '#ffffff' }}
            >
              Sign in
            </a>
            <p className="mt-6 text-xs" style={{ color: 'var(--text-faint)' }}>
              For your security this link can only be used once and expires in 24 hours.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              This link can&rsquo;t be confirmed
            </h1>
            <p className="text-base mb-6" style={{ color: 'var(--text-muted)' }}>
              It may have expired or already been used. Request a fresh sign-in link to continue.
            </p>
            <Link
              href="/auth/signin"
              className="inline-block w-full px-4 py-3 rounded-lg text-base font-medium transition-all hover:brightness-110"
              style={{ background: 'var(--accent-rust)', color: '#ffffff' }}
            >
              Request a fresh link
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
