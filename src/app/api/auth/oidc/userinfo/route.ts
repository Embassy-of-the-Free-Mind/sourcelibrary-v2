import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/auth/oidc/userinfo
 * OIDC UserInfo endpoint. Returns profile data for the authenticated user.
 */
export async function GET(request: NextRequest) {
  const { decodeAccessToken, getUserInfo } = await import('@/lib/oidc/provider');

  const authHeader = request.headers.get('authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const token = authHeader.slice(7);
  const decoded = decodeAccessToken(token);
  if (!decoded) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  const userInfo = await getUserInfo(decoded.sub);
  if (!userInfo) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 401 });
  }

  return NextResponse.json(userInfo);
}
