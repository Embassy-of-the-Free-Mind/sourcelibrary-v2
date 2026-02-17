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
 * Require authentication in server components
 * Throws error and redirects if not authenticated
 */
export async function requireAuth(): Promise<Session> {
  const session = await getSession();
  if (!session?.user) {
    redirect('/auth/signin');
  }
  return session;
}

/**
 * Wrapper for API routes requiring authentication
 * Returns 401 if not authenticated
 *
 * @example
 * export const POST = withAuth(async (request, session) => {
 *   session.user is guaranteed to exist
 *   return NextResponse.json({ user: session.user.email });
 * });
 */
export function withAuth(
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
    return handler(request, session, context);
  };
}