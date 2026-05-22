'use client';

import { useStableSession } from '@/hooks/useStableSession';

interface AuthCheckProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /**
   * Require a specific role.
   * - 'admin'         — admin or superadmin (global only)
   * - 'inner_circle'  — editor-equivalent (global OR tenant membership)
   * - 'reader'        — any authenticated user
   * - 'bph_librarian' — editor on the BPH tenant OR global admin. Used to gate
   *   the BPH cataloguer panel. The underlying check is tenant-scoped (not a
   *   new global role) but the name makes the intent obvious at the callsite.
   */
  role?: 'admin' | 'inner_circle' | 'reader' | 'bph_librarian';
}

// Mirrors ROLE_LEVEL in src/lib/auth.ts, with legacy aliases (inner_circle, curator)
// kept so older sessions/tokens still resolve.
const ROLE_LEVEL: Record<string, number> = {
  reader: 1,
  inner_circle: 2,
  curator: 2,
  editor: 2,
  admin: 3,
  superadmin: 4,
};

/**
 * Client component that conditionally renders children based on auth status and role.
 *
 * Effective role = max(global session role, tenant membership role). This lets a
 * user who is only a `reader` globally but an `editor` on the BPH tenant see
 * editor-gated UI when browsing under that tenant.
 *
 * @example
 * <AuthCheck>                      // Any logged-in user
 * <AuthCheck role="inner_circle">  // Editor or above (globally or on the current tenant)
 * <AuthCheck role="admin">         // Admin or above
 */
export function AuthCheck({ children, fallback = null, role }: AuthCheckProps) {
  const { data: session, status } = useStableSession();

  if (status === 'loading') {
    // During loading, show fallback (the safe, non-interactive default).
    // This avoids invisible → visible flash since fallback is visually
    // identical to the authenticated view (e.g. same cover image, just not clickable).
    return <>{fallback}</>;
  }

  if (!session?.user) {
    return <>{fallback}</>;
  }

  const user = session.user as any;
  const globalLevel = ROLE_LEVEL[user.role] ?? 0;
  const tenantLevel = ROLE_LEVEL[user.tenantRole] ?? 0;
  const level = Math.max(globalLevel, tenantLevel);

  if (role === 'admin' && level < ROLE_LEVEL.admin) {
    return <>{fallback}</>;
  }

  if (role === 'inner_circle' && level < ROLE_LEVEL.editor) {
    return <>{fallback}</>;
  }

  // BPH cataloguer panel: tenant-scoped editor on BPH, OR global admin/superadmin.
  // We check tenantSlug explicitly because a `tenantRole = 'editor'` set on a
  // different tenant must not unlock BPH writes.
  if (role === 'bph_librarian') {
    const tenantSlug = user.tenantSlug;
    const isBphEditor = tenantSlug === 'bph' && (ROLE_LEVEL[user.tenantRole] ?? 0) >= ROLE_LEVEL.editor;
    const isGlobalAdmin = globalLevel >= ROLE_LEVEL.admin;
    if (!isBphEditor && !isGlobalAdmin) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}
