// RFC 8414 — OAuth Authorization Server Metadata
// Claude reads this to discover our register + authorize + token endpoints.
// Origin is derived from the request host so preview deployments are
// self-contained (a hardcoded prod origin would send the flow to endpoints
// that don't exist on the preview branch).

import { requestOrigin } from '@/lib/oauth/origin';

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['mcp'],
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
