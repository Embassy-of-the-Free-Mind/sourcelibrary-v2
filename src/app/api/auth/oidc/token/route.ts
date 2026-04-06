import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/auth/oidc/token
 * OIDC Token endpoint. Synapse exchanges an auth code for tokens.
 */
export async function POST(request: NextRequest) {
  const {
    validateClient,
    exchangeAuthCode,
    createIdToken,
    createAccessToken,
    getUserInfo,
  } = await import('@/lib/oidc/provider');

  const body = await request.formData().catch(() => null);
  const params = body
    ? Object.fromEntries(body.entries())
    : await request.json().catch(() => ({}));

  const grantType = (params.grant_type as string) || '';
  const code = (params.code as string) || '';
  const redirectUri = (params.redirect_uri as string) || '';
  let clientId = (params.client_id as string) || '';
  let clientSecret = (params.client_secret as string) || '';

  // Also check Basic auth header
  const authHeader = request.headers.get('authorization') || '';
  if (authHeader.startsWith('Basic ')) {
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [id, secret] = decoded.split(':');
    if (!clientId) clientId = id;
    if (!clientSecret) clientSecret = secret;
  }

  if (grantType !== 'authorization_code') {
    return NextResponse.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  if (!validateClient(clientId, clientSecret)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 401 });
  }

  const result = await exchangeAuthCode(code, redirectUri);
  if (!result) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  // Get user info for the ID token
  const userInfo = await getUserInfo(result.userId);
  if (!userInfo) {
    return NextResponse.json({ error: 'invalid_grant' }, { status: 400 });
  }

  const idToken = await createIdToken(result.userId, userInfo.email, userInfo.name);
  const accessToken = createAccessToken(result.userId);

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: 3600,
    id_token: idToken,
  });
}
