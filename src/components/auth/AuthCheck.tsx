'use client';

import { useSession } from 'next-auth/react';

interface AuthCheckProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Client component that conditionally renders children only for authenticated users
 *
 * @example
 * <AuthCheck>
 *   <Button onClick={handleDelete}>Delete Book</Button>
 * </AuthCheck>
 */
export function AuthCheck({ children, fallback = null }: AuthCheckProps) {
  const { data: session, status } = useSession();

  // Don't render while loading to avoid flicker
  if (status === 'loading') {
    return <>{fallback}</>;
  }

  // Only render for authenticated users (who are all admins via whitelist)
  if (!session?.user) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
