import { auth } from '@/lib/auth';
import { ROLE_LEVEL, type Role } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getDb } from '@/lib/mongodb';

function normalizeRole(role: unknown): Role {
  if (role === 'superadmin' || role === 'admin' || role === 'editor' || role === 'reader') {
    return role;
  }
  // Backward compatibility with older role labels.
  if (role === 'inner_circle' || role === 'curator') return 'editor';
  if (role === 'user') return 'reader';
  return 'reader';
}

async function getTenantMembershipRole(
  email: string | null | undefined,
  tenantId: string | null | undefined,
): Promise<Role | null> {
  if (!email || !tenantId) return null;

  try {
    const db = await getDb();
    const membership = await db.collection('memberships').findOne(
      {
        email: email.toLowerCase(),
        tenantId,
        status: 'active',
      },
      { projection: { role: 1 } }
    );

    if (!membership?.role) return null;
    return normalizeRole(membership.role);
  } catch {
    // Auth guards should fail closed on role checks if membership lookup fails.
    return null;
  }
}

/**
 * Get the current session in API routes or server components
 */
export async function getSession(): Promise<Session | null> {
  return await auth();
}

/**
 * Require any authentication in server components.
 * Redirects to signin if not authenticated.
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  return session;
}

/**
 * Require a minimum role level in server components.
 * Redirects to loginPath if not authenticated, or /unauthorized if role is insufficient.
 *
 * TODO (Phase 1): Callers in tenant layouts must pass loginPath = `/${tenantSlug}/login`,
 * reading tenantSlug from headers() set by proxy.ts.
 */
export async function requireRole(minRole: Role, loginPath = '/auth/signin'): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    redirect(loginPath);
  }
  let effectiveRole = normalizeRole((session.user as any).role);

  if ((ROLE_LEVEL[effectiveRole] ?? 0) < ROLE_LEVEL[minRole]) {
    const h = await headers();
    const tenantId = h.get('x-tenant-id');
    const tenantRole = await getTenantMembershipRole(session.user.email, tenantId);
    if (tenantRole && (ROLE_LEVEL[tenantRole] ?? 0) > (ROLE_LEVEL[effectiveRole] ?? 0)) {
      effectiveRole = tenantRole;
    }
  }

  if ((ROLE_LEVEL[effectiveRole] ?? 0) < ROLE_LEVEL[minRole]) {
    redirect('/unauthorized');
  }
  return session;
}

// Convenience shorthands
export const requireSuperAdmin = () => requireRole('superadmin', '/platform/login');
export const requireAdmin = () => requireRole('admin'); // TODO (Phase 1): pass /${tenantSlug}/login
export const requireEditor = () => requireRole('editor'); // TODO (Phase 1): pass /${tenantSlug}/login

/**
 * Check if current user is a superadmin
 */
export async function isSuperAdmin(): Promise<boolean> {
  const session = await getSession();
  return (session?.user as any)?.role === 'superadmin';
}

/**
 * Check if current user is admin or superadmin
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  const role = normalizeRole((session?.user as any)?.role);
  return (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL['admin'];
}

/**
 * Legacy compatibility alias for older callsites.
 * Inner circle maps to editor-level access in the new role model.
 */
export async function isInnerCircle(): Promise<boolean> {
  const session = await getSession();
  const role = normalizeRole((session?.user as any)?.role);
  return (ROLE_LEVEL[role] ?? 0) >= ROLE_LEVEL['editor'];
}

/**
 * Legacy compatibility alias for older server-component guards.
 */
export const requireInnerCircle = () => requireRole('editor');

// --- Dual-mode identity resolution for engagement APIs ---

export interface ResolvedIdentity {
  id: string;
  type: 'authenticated' | 'anonymous';
  email?: string | null;
}

/**
 * Resolve the identity of the request sender.
 * Checks NextAuth session first, falls back to X-Visitor-ID header.
 * Used by engagement APIs (likes) that accept both auth modes.
 */
export async function resolveIdentity(request: NextRequest): Promise<ResolvedIdentity | null> {
  // Try NextAuth session first
  try {
    const session = await auth();
    if (session?.user?.id) {
      return {
        id: session.user.id,
        type: 'authenticated',
        email: session.user.email,
      };
    }
  } catch {
    // Session check failed — fall through to visitor_id
  }

  // Fall back to X-Visitor-ID header
  const visitorId = request.headers.get('x-visitor-id');
  if (visitorId) {
    return {
      id: visitorId,
      type: 'anonymous',
    };
  }

  return null;
}

// --- API route wrappers ---

/**
 * Unified API route wrapper with role-based access control and tenant verification.
 * Accepts CRON_SECRET bearer token for internal pipeline workers.
 * Returns 401 if not authenticated, 403 if role is insufficient or tenant mismatch.
 *
 * Phase 1 tenant verification:
 * - If x-tenant-id is present (tenant-scoped route), verifies session tenantId matches
 * - Prevents cross-tenant data access via crafted headers
 */
export function withAuth(
  handler: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>,
  { minRole = 'reader' as Role }: { minRole?: Role } = {}
): (request: NextRequest, context?: any) => Promise<NextResponse> {
  return async (request: NextRequest, context?: any) => {
    // CRON_SECRET bypass — pipeline workers call admin routes with this token
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      const cronSession: Session = {
        user: { name: 'Pipeline Cron', email: 'cron@sourcelibrary.org', role: 'admin' } as any,
        expires: new Date(Date.now() + 3600000).toISOString(),
      };
      return handler(request, cronSession, context);
    }

    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }

    const headerTenantId = request.headers.get('x-tenant-id');
    const membershipRole = await getTenantMembershipRole(session.user.email, headerTenantId);

    let effectiveRole = normalizeRole((session.user as any).role);
    if (membershipRole && (ROLE_LEVEL[membershipRole] ?? 0) > (ROLE_LEVEL[effectiveRole] ?? 0)) {
      effectiveRole = membershipRole;
    }

    if ((ROLE_LEVEL[effectiveRole] ?? 0) < ROLE_LEVEL[minRole]) {
      return NextResponse.json(
        { error: 'Forbidden - Insufficient role' },
        { status: 403 }
      );
    }

    // Phase 1 tenant verification: prevent cross-tenant access
    if (headerTenantId) {
      const sessionTenantId = (session.user as any).tenantId;

      // Superadmin can access any tenant (bypass check)
      if (effectiveRole !== 'superadmin') {
        const sessionMatchesTenant = Boolean(sessionTenantId) && sessionTenantId === headerTenantId;
        const membershipMatchesTenant = Boolean(membershipRole);
        if (!sessionMatchesTenant && !membershipMatchesTenant) {
          return NextResponse.json(
            { error: 'Forbidden - Tenant mismatch' },
            { status: 403 }
          );
        }
      }
    }

    return handler(request, session, context);
  };
}

// --- Shims — keep existing callsites working during Phase 1 migration ---
// TODO: Remove withAdminAuth once all callsites use withAuth({ minRole: 'admin' })
export const withAdminAuth = (h: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>) => withAuth(h, { minRole: 'admin' });

// TODO: Remove withSuperadminAuth once all callsites use withAuth({ minRole: 'superadmin' })
export const withSuperadminAuth = (h: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>) => withAuth(h, { minRole: 'superadmin' });

// TODO: Remove withEditorAuth once all callsites use withAuth({ minRole: 'editor' })
export const withEditorAuth = (h: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>) => withAuth(h, { minRole: 'editor' });

// TODO: Remove withInnerCircleAuth — mapped to 'editor'. Verify each callsite matches
// this permission level before removing.
export const withInnerCircleAuth = (h: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>) => withAuth(h, { minRole: 'editor' });

// TODO: Remove withCuratorAuth — mapped to 'editor'. Verify each callsite matches
// this permission level before removing.
export const withCuratorAuth = (h: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>) => withAuth(h, { minRole: 'editor' });
