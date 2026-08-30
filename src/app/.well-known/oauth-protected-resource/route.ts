// RFC 9728 — Protected Resource Metadata
// Tells Claude where to find our OAuth authorization server.

import { requestOrigin } from '@/lib/oauth/origin';

export async function GET(req: Request) {
  const origin = requestOrigin(req);
  return Response.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: ['mcp'],
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
