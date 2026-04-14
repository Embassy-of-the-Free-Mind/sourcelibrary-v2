// OAuth Token Endpoint
// Exchanges an authorization code for a bearer token.
// Verifies PKCE (S256) to prevent code interception.

import { createHmac, createHash } from 'crypto';
import { randomUUID } from 'crypto';

const SECRET = process.env.OAUTH_SECRET || process.env.NEXTAUTH_SECRET || 'source-library-mcp-oauth-2026';

function verifyCode(code: string): Record<string, string> | null {
  const parts = code.split('.');
  if (parts.length !== 2) return null;
  const [b64, sig] = parts;
  const expected = createHmac('sha256', SECRET).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    return JSON.parse(Buffer.from(b64, 'base64url').toString());
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  // Parse form-encoded body (OAuth spec requires application/x-www-form-urlencoded)
  const body = await req.text();
  const params = new URLSearchParams(body);

  const grant_type = params.get('grant_type');
  const code = params.get('code');
  const code_verifier = params.get('code_verifier');
  const redirect_uri = params.get('redirect_uri');

  if (grant_type !== 'authorization_code' || !code) {
    return Response.json({ error: 'unsupported_grant_type' }, { status: 400 });
  }

  // Verify the signed code
  const payload = verifyCode(code);
  if (!payload) {
    return Response.json({ error: 'invalid_grant', error_description: 'Invalid or tampered code' }, { status: 400 });
  }

  // Check expiration
  if (Number(payload.exp) < Date.now()) {
    return Response.json({ error: 'invalid_grant', error_description: 'Code expired' }, { status: 400 });
  }

  // Verify redirect_uri matches
  if (redirect_uri && redirect_uri !== payload.redirect_uri) {
    return Response.json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, { status: 400 });
  }

  // Verify PKCE — S256: base64url(sha256(code_verifier)) must equal code_challenge
  if (payload.code_challenge && code_verifier) {
    const expected = createHash('sha256').update(code_verifier).digest('base64url');
    if (expected !== payload.code_challenge) {
      return Response.json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, { status: 400 });
    }
  }

  // Issue a token — for now, a random UUID. The MCP endpoint doesn't validate it.
  // Later: issue a JWT with user info, store in DB, etc.
  const access_token = `sl_${randomUUID().replace(/-/g, '')}`;

  return Response.json({
    access_token,
    token_type: 'Bearer',
    expires_in: 86400, // 24 hours
    scope: 'mcp',
  }, {
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
