import { NextRequest, NextResponse } from 'next/server';
import { withAdminAuth } from '@/lib/auth-helpers';

export const POST = withAdminAuth(async (_req: NextRequest) => {
  try {
    // Create response with cleared impersonation token
    const response = NextResponse.json({
      message: 'Impersonation ended',
    });

    // Clear the impersonation token cookie
    response.cookies.set('impersonation-token', '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    console.error('[impersonate/stop]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to stop impersonation' },
      { status: 500 }
    );
  }
});
