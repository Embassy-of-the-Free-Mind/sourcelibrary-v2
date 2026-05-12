'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';

// Paths where the welcome gate should not fire (auth flow itself, the welcome page,
// API routes, embed/tenant subdomains where we don't own the chrome).
const SKIP_PATH_PREFIXES = [
  '/welcome',
  '/auth/',
  '/api/',
  '/admin',
  '/embed/',
];

export default function WelcomeGate() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (status !== 'authenticated') return;
    if (redirected.current) return;
    if (!pathname) return;
    const needs = (session?.user as { needsWelcome?: boolean } | undefined)?.needsWelcome === true;
    if (!needs) return;
    if (SKIP_PATH_PREFIXES.some(p => pathname.startsWith(p))) return;

    // Only fire on apex/sourcelibrary host — tenant subdomains have their own chrome.
    if (typeof window !== 'undefined') {
      const host = window.location.hostname;
      // Match sourcelibrary.org, www.sourcelibrary.org, localhost. Skip tenant subdomains.
      const isApex = host === 'sourcelibrary.org' || host === 'www.sourcelibrary.org' || host.startsWith('localhost') || host.endsWith('.vercel.app');
      if (!isApex) return;
    }

    redirected.current = true;
    router.push(`/welcome?from=${encodeURIComponent(pathname)}`);
  }, [status, session, pathname, router]);

  return null;
}
