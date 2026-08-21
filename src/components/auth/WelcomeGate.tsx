'use client';

import { useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { usePathname, useRouter } from 'next/navigation';
import { shouldFireWelcomeGate } from '@/lib/welcome-gate';

// The gate interrupts a reader once per tab and never again.
//
// Why that matters: `redirected` below only guards a single mount, which is no
// guard at all, because every firing of the gate is a navigation and every
// navigation remounts. So when the session's needsWelcome flag went stale-true
// (see the update() note in WelcomeForm), saving the form returned the reader to
// their page and the freshly-mounted gate sent them straight back to /welcome — on
// every page, until the token expired 30 days later. 36 readers were locked out
// that way on 2026-07-29/30. This flag is the structural fix: whatever else goes
// wrong upstream, the reader loses one navigation, not the site.
const GATE_FIRED_KEY = 'sl_welcome_gate_fired';

function alreadyFired(): boolean {
  try {
    return window.sessionStorage.getItem(GATE_FIRED_KEY) === '1';
  } catch {
    return false; // Safari private mode and friends — degrade to the old behaviour
  }
}

function markFired(): void {
  try {
    window.sessionStorage.setItem(GATE_FIRED_KEY, '1');
  } catch {
    /* non-fatal */
  }
}

export default function WelcomeGate() {
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const redirected = useRef(false);

  useEffect(() => {
    if (redirected.current) return;
    if (typeof window === 'undefined') return;

    const fire = shouldFireWelcomeGate({
      status,
      needsWelcome: (session?.user as { needsWelcome?: boolean } | undefined)?.needsWelcome === true,
      pathname,
      hostname: window.location.hostname,
      alreadyFired: alreadyFired(),
    });
    if (!fire) return;

    redirected.current = true;
    markFired();
    router.push(`/welcome?from=${encodeURIComponent(pathname!)}`);
  }, [status, session, pathname, router]);

  return null;
}
