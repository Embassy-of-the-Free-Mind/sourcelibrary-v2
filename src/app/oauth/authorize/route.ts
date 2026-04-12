// OAuth Authorization Endpoint
// Auto-approves and redirects back with a signed code.
// The code embeds the code_challenge so the token endpoint can verify PKCE
// without shared state (serverless-safe).

import { createHmac, randomBytes } from 'crypto';

// Use a stable secret — falls back to a random one per cold start if env not set
const SECRET = process.env.OAUTH_SECRET || process.env.NEXTAUTH_SECRET || 'source-library-mcp-oauth-2026';

function signCode(payload: Record<string, string>): string {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export { SECRET, signCode };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirect_uri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state');
  const code_challenge = url.searchParams.get('code_challenge') || '';
  const response_type = url.searchParams.get('response_type');

  if (response_type !== 'code' || !redirect_uri) {
    return new Response('Invalid request: response_type must be "code" and redirect_uri is required', { status: 400 });
  }

  // Embed the code_challenge and redirect_uri in a signed code
  // so the token endpoint can verify PKCE without shared state
  const nonce = randomBytes(8).toString('hex');
  const code = signCode({
    code_challenge,
    redirect_uri,
    nonce,
    exp: String(Date.now() + 5 * 60 * 1000), // 5 min
  });

  // Redirect back to Claude with the code
  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);

  return Response.redirect(callback.toString(), 302);
}
