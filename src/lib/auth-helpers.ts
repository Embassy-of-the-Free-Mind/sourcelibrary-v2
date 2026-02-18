import { auth } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { Session } from 'next-auth';
import { redirect } from 'next/navigation';

/**
 * Get the current session in API routes or server components
 */
export async function getSession(): Promise<Session | null> {
  return await auth();
}

/**
 * Require any authentication in server components (admin or reader)
 * Redirects to signin if not authenticated
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  return session;
}

/**
 * Require admin role in server components
 * Redirects to signin if not authenticated, or unauthorized if not admin
 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  if ((session.user as any).role !== 'admin') {
    redirect('/unauthorized');
  }
  return session;
}

/**
 * Check if current user is an admin
 */
export async function isAdmin(): Promise<boolean> {
  const session = await getSession();
  return (session?.user as any)?.role === 'admin';
}

/**
 * Wrapper for API routes requiring any authentication.
 * Accepts either a NextAuth session or a CRON_SECRET bearer token
 * (for internal server-to-server calls from pipeline crons).
 * Returns 401 if not authenticated.
 */
export function withAuth(
  handler: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>
): (request: NextRequest, context?: any) => Promise<NextResponse> {
  return async (request: NextRequest, context?: any) => {
    // Check for CRON_SECRET bearer token (internal service-to-service calls)
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');
    if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
      // Create a synthetic admin session for cron calls
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
    return handler(request, session, context);
  };
}

/**
 * Wrapper for API routes requiring admin role
 * Returns 401 if not authenticated, 403 if not admin
 */
export function withAdminAuth(
  handler: (request: NextRequest, session: Session, context?: any) => Promise<NextResponse>
): (request: NextRequest, context?: any) => Promise<NextResponse> {
  return async (request: NextRequest, context?: any) => {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json(
        { error: 'Unauthorized - Authentication required' },
        { status: 401 }
      );
    }
    if ((session.user as any).role !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }
    return handler(request, session, context);
  };
}
