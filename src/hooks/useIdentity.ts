'use client';

import { useSession } from 'next-auth/react';
import { useMemo } from 'react';

const VISITOR_ID_KEY = 'sl_visitor_id';

export type IdentityType = 'authenticated' | 'anonymous';

export interface Identity {
  id: string;
  type: IdentityType;
  email?: string | null;
  name?: string | null;
  loading: boolean;
}

export function getVisitorId(): string {
  if (typeof window === 'undefined') return '';
  let visitorId = localStorage.getItem(VISITOR_ID_KEY);
  if (!visitorId) {
    visitorId = 'v_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(VISITOR_ID_KEY, visitorId);
  }
  return visitorId;
}

/**
 * Single source of truth for user identity.
 * Authenticated users get their NextAuth user.id.
 * Anonymous users get a localStorage-based visitor_id.
 */
export function useIdentity(): Identity {
  const { data: session, status } = useSession();

  return useMemo(() => {
    if (status === 'loading') {
      return { id: '', type: 'anonymous' as const, loading: true };
    }

    if (session?.user?.id) {
      return {
        id: session.user.id,
        type: 'authenticated' as const,
        email: session.user.email,
        name: session.user.name,
        loading: false,
      };
    }

    return {
      id: getVisitorId(),
      type: 'anonymous' as const,
      loading: false,
    };
  }, [session, status]);
}

/**
 * Get the current visitor_id from localStorage (for non-hook contexts).
 * After migration, this may no longer exist.
 */
export function getStoredVisitorId(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(VISITOR_ID_KEY);
}

export function clearStoredVisitorId(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(VISITOR_ID_KEY);
}
