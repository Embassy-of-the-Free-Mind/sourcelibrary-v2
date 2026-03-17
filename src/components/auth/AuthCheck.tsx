'use client';

import { useSession } from 'next-auth/react';

interface AuthCheckProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /** Require a specific role. 'admin' = whitelist only. Default: any authenticated user. */
  role?: 'admin' | 'reader';
}

/**
 * Client component that conditionally renders children based on auth status and role.
 *
 * @example
 * <AuthCheck>              // Any logged-in user
 * <AuthCheck role="admin"> // Admin-only (whitelist)
 */
export function AuthCheck({ children, fallback = null, role }: AuthCheckProps) {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <>{fallback}</>;
  }

  if (!session?.user) {
    return <>{fallback}</>;
  }

  // If a specific role is required, check it
  if (role && (session.user as any).role !== role) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
