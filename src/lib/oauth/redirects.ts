// Shared redirect_uri policy for the OAuth endpoints: https anywhere, or
// loopback http for local MCP clients (RFC 8252 §7.3).

export function isAcceptableRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol === 'https:') return true;
    return u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}
