// Resolve the public origin of the current request, so OAuth metadata points
// at the host that was actually asked (prod, preview, or localhost) instead of
// a hardcoded production URL.

export function requestOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'sourcelibrary.org';
  const proto = req.headers.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
