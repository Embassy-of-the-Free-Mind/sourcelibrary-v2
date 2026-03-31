'use client';

import { useSession } from 'next-auth/react';

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
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <>{fallback}</>;
  }

  if (!session?.user) {
    return <>{fallback}</>;
  }

  const userRole = (session.user as any).role;

  if (role === 'admin' && userRole !== 'admin') {
    return <>{fallback}</>;
  }

  if (role === 'inner_circle' && userRole !== 'admin' && userRole !== 'inner_circle') {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
