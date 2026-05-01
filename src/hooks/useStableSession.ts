'use client';

import { useSession } from 'next-auth/react';
import { useRef } from 'react';

/**
 * Wrapper around useSession that suppresses brief 'loading' blips
 * after the session has already been authenticated.
 *
 * Problem: TenantSessionUpdater calls session.update() to attach
 * tenant-scoped roles, which resets status to 'loading' momentarily.
 * Every useSession() consumer re-renders, causing visible flicker
 * (cover images, edit buttons, profile avatar all flash on/off).
 *
 * Solution: Once status has been 'authenticated', hold the previous
 * session data and status during any subsequent loading transitions.
 * The initial loading→authenticated transition works normally.
 */
export function useStableSession() {
  const session = useSession();
  const prevRef = useRef(session);

  // Once we've been authenticated, cache that state
  if (session.status === 'authenticated') {
    prevRef.current = session;
  }

  // If we were previously authenticated but now briefly loading
  // (e.g. from session.update()), return the cached authenticated state
  if (session.status === 'loading' && prevRef.current.status === 'authenticated') {
    return prevRef.current;
  }

  return session;
}
