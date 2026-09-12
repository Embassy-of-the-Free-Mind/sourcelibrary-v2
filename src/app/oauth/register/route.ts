// RFC 7591 — OAuth Dynamic Client Registration
// Claude's connector flow registers itself here before starting authorization.
// We are a public server with PKCE-only public clients: registration is
// accepted for anyone, no secret is issued, and the client_id is an opaque
// value the other endpoints never need to look up (stateless, serverless-safe).

import { randomBytes } from 'crypto';
import { isAcceptableRedirect } from '@/lib/oauth/redirects';

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json(
      { error: 'invalid_client_metadata', error_description: 'Body must be JSON' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  if (redirectUris.length === 0 || !redirectUris.every(isAcceptableRedirect)) {
    return Response.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https or loopback http URLs' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  return Response.json({
    client_id: `slmcp_${randomBytes(16).toString('hex')}`,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
    scope: 'mcp',
  }, {
    status: 201,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-store',
    },
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
