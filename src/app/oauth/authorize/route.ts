// OAuth Authorization Endpoint
// Shows a consent page, then redirects back with a signed code.
// The code embeds the code_challenge so the token endpoint can verify PKCE
// without shared state (serverless-safe).

import { createHmac, randomBytes } from 'crypto';
import { isAcceptableRedirect } from '@/lib/oauth/redirects';

const SECRET = process.env.OAUTH_SECRET || process.env.NEXTAUTH_SECRET || 'source-library-mcp-oauth-2026';

function signCode(payload: Record<string, string>): string {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

export { SECRET, signCode };

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const redirect_uri = url.searchParams.get('redirect_uri');
  const state = url.searchParams.get('state') || '';
  const code_challenge = url.searchParams.get('code_challenge') || '';
  const code_challenge_method = url.searchParams.get('code_challenge_method') || 'S256';
  const response_type = url.searchParams.get('response_type');
  const client_id = url.searchParams.get('client_id') || 'claude';

  if (response_type !== 'code' || !redirect_uri) {
    return new Response('Invalid request: response_type must be "code" and redirect_uri is required', { status: 400 });
  }

  // Only redirect to https or loopback targets — anything else turns the
  // auto-approve consent flow into an open-redirect gadget.
  if (!isAcceptableRedirect(redirect_uri)) {
    return new Response('Invalid redirect_uri: must be https or loopback http', { status: 400 });
  }

  // Consent is auto-granted: there is no account and the token gates nothing,
  // so a consent click would be pure ceremony. Redirect straight back with the
  // code — the user experience is click-Connect → connected, zero clicks.
  // Pass ?prompt=consent to see the consent card anyway (kept for debugging
  // and as the branded fallback if a client ever renders this URL in a tab).
  if (url.searchParams.get('prompt') !== 'consent') {
    return approve(redirect_uri, state, code_challenge);
  }

  // Show consent page
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect to Source Library</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f3f0; display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 20px; }
    .card { background: white; border-radius: 16px; padding: 40px; max-width: 420px; width: 100%; box-shadow: 0 2px 8px rgba(0,0,0,0.06); border: 1px solid #e8e5e0; text-align: center; }
    h1 { font-size: 22px; color: #2c2824; margin-bottom: 8px; }
    .subtitle { color: #8a8480; font-size: 14px; margin-bottom: 24px; }
    .perms { text-align: left; background: #faf9f7; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
    .perms h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #8a8480; margin-bottom: 8px; }
    .perms li { font-size: 14px; color: #2c2824; padding: 4px 0; list-style: none; }
    .perms li::before { content: "\\2713 "; color: #7c6f4a; font-weight: bold; }
    .btn { display: inline-block; width: 100%; padding: 12px; border: none; border-radius: 8px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
    .btn-allow { background: #2c2824; color: white; margin-bottom: 8px; }
    .btn-allow:hover { background: #3d3530; }
    .btn-cancel { background: transparent; color: #8a8480; }
    .btn-cancel:hover { color: #2c2824; }
    .footer { font-size: 13px; color: #b0aaa4; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Source Library</h1>
    <p class="subtitle">wants to connect to your conversation</p>
    <div class="perms">
      <h3>This will allow</h3>
      <ul>
        <li>Search 10,000+ rare historical texts</li>
        <li>Read full book translations</li>
        <li>Browse 90,000+ historical illustrations</li>
        <li>Get page citations with DOIs</li>
      </ul>
    </div>
    <form method="GET" action="/oauth/authorize">
      <input type="hidden" name="response_type" value="code">
      <input type="hidden" name="redirect_uri" value="${escAttr(redirect_uri)}">
      <input type="hidden" name="state" value="${escAttr(state)}">
      <input type="hidden" name="code_challenge" value="${escAttr(code_challenge)}">
      <input type="hidden" name="code_challenge_method" value="${escAttr(code_challenge_method)}">
      <input type="hidden" name="client_id" value="${escAttr(client_id)}">
      <input type="hidden" name="approve" value="1">
      <button type="submit" class="btn btn-allow">Allow access</button>
    </form>
    <button class="btn btn-cancel" onclick="window.close()">Cancel</button>
    <p class="footer">No account required. <a href="https://sourcelibrary.org/terms" style="color: #7c6f4a;">Terms</a></p>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html' },
  });
}

function approve(redirect_uri: string, state: string, code_challenge: string) {
  const nonce = randomBytes(8).toString('hex');
  const code = signCode({
    code_challenge,
    redirect_uri,
    nonce,
    exp: String(Date.now() + 5 * 60 * 1000),
  });

  const callback = new URL(redirect_uri);
  callback.searchParams.set('code', code);
  if (state) callback.searchParams.set('state', state);

  return Response.redirect(callback.toString(), 302);
}
