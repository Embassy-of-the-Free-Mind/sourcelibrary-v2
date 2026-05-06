'use client';

import { useStableSession } from '@/hooks/useStableSession';
import { useEffect, useState } from 'react';

interface AuthCheckProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Require a specific role. 'admin' = admin only. 'inner_circle' = admin or inner_circle. Default: any authenticated user. */
  role?: 'admin' | 'inner_circle' | 'reader';
}

/**
 * Client component that conditionally renders children based on auth status and role.
 *
 * @example
 * <AuthCheck>                      // Any logged-in user
 * <AuthCheck role="inner_circle">  // Admin or inner circle
 * <AuthCheck role="admin">         // Admin-only (whitelist)
 */
export function AuthCheck({ children, fallback = null, role }: AuthCheckProps) {
  const { data: session, status } = useStableSession();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Ensure server render and first client render match.
  // Auth-gated UI is resolved only after hydration.
  if (!isMounted) {
    return <>{fallback}</>;
  }

  if (status === 'loading') {
    // During loading, show fallback (the safe, non-interactive default).
    // This avoids invisible → visible flash since fallback is visually
    // identical to the authenticated view (e.g. same cover image, just not clickable).
    return <>{fallback}</>;
  }

  if (!session?.user) {
    return <>{fallback}</>;
  }

  const userRole = (session.user as any).role;
  const ROLE_LEVEL: Record<string, number> = { reader: 1, inner_circle: 2, editor: 2, admin: 3, superadmin: 4 };
  const level = ROLE_LEVEL[userRole] ?? 0;

  if (role === 'admin' && level < 3) {
    return <>{fallback}</>;
  }

  if (role === 'inner_circle' && level < 2) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
