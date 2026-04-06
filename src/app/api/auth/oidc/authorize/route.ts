import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { validateClient, createAuthCode } from '@/lib/oidc/provider';

/**
 * GET /api/auth/oidc/authorize
 * OIDC Authorization endpoint. Synapse redirects users here.
 * If signed in → issues auth code and redirects back to Synapse.
 * If not signed in → redirects to Source Library sign-in first.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get('client_id') || '';
  const redirectUri = url.searchParams.get('redirect_uri') || '';
  const state = url.searchParams.get('state') || '';
  const responseType = url.searchParams.get('response_type') || '';

  if (responseType !== 'code') {
    return NextResponse.json({ error: 'unsupported_response_type' }, { status: 400 });
  }

  if (!validateClient(clientId)) {
    return NextResponse.json({ error: 'invalid_client' }, { status: 400 });
  }

  // Validate redirect_uri against allowed origins
  try {
    const redirectHost = new URL(redirectUri).hostname;
    const allowedHosts = (process.env.OIDC_ALLOWED_REDIRECT_HOSTS || 'chat.embassyofthefreemind.com').split(',');
    if (!allowedHosts.some(h => redirectHost === h.trim() || redirectHost.endsWith('.' + h.trim()))) {
      return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'invalid_redirect_uri' }, { status: 400 });
  }

  // Check if user is signed in to Source Library
  const session = await auth();

  if (!session?.user?.id) {
    // Not signed in — redirect to Source Library sign-in, then back here
    const callbackUrl = request.url;
    return NextResponse.redirect(
      `${process.env.NEXTAUTH_URL || 'https://sourcelibrary.org'}/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`
    );
  }

  // Signed in — create auth code and redirect back to Synapse
  const code = await createAuthCode(session.user.id, redirectUri);
  const redirectUrl = new URL(redirectUri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return NextResponse.redirect(redirectUrl.toString());
}
