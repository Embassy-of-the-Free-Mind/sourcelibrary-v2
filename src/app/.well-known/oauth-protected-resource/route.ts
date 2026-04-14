// RFC 9728 — Protected Resource Metadata
// Tells Claude where to find our OAuth authorization server

export async function GET() {
  return Response.json({
    resource: 'https://sourcelibrary.org/api/mcp',
    authorization_servers: ['https://sourcelibrary.org'],
    scopes_supported: ['mcp'],
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
}
