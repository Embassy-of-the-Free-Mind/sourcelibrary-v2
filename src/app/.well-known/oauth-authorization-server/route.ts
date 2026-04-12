// RFC 8414 — OAuth Authorization Server Metadata
// Claude reads this to discover our authorize + token endpoints

export async function GET() {
  return Response.json({
    issuer: 'https://sourcelibrary.org',
    authorization_endpoint: 'https://sourcelibrary.org/oauth/authorize',
    token_endpoint: 'https://sourcelibrary.org/oauth/token',
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: ['mcp'],
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
