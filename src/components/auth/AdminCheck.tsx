'use client';

import { useSession } from 'next-auth/react';

interface AdminCheckProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Client component that conditionally renders children only for admin users.
 * Non-admins and unauthenticated users see the fallback (default: nothing).
 */
export function AdminCheck({ children, fallback = null }: AdminCheckProps) {
  const { data: session, status } = useSession();

  if (status === 'loading') {
    return <>{fallback}</>;
  }

  if ((session?.user as any)?.role !== 'admin') {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
