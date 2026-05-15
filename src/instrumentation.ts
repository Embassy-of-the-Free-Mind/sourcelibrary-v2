/**
 * Next.js instrumentation hook — runs once per server process at startup.
 * The `onRequestError` export is invoked for every unhandled error during
 * server rendering, route handlers, server actions, and middleware.
 *
 * Without this hook, server-render errors only surface as a React `digest`
 * in the response HTML and a stack in Vercel logs — never reaching the
 * `application_errors` collection. That made the BPH iframe outage on
 * 2026-05-15 invisible to the admin error dashboard.
 *
 * What this does:
 *   1. Always console.error a structured line so Vercel logs reliably catch
 *      it even when the Atlas write path itself is failing.
 *   2. Fire-and-forget POST to /api/errors so the row lands in
 *      `application_errors` when Atlas is healthy.
 */

export function register() {
  // No global setup needed — onRequestError is the workhorse.
}

type RequestErrorRequest = {
  path: string;
  method: string;
  headers: { [key: string]: string };
};

type RequestErrorContext = {
  routerKind: 'Pages Router' | 'App Router';
  routePath: string;
  routeType: 'render' | 'route' | 'action' | 'middleware';
  renderSource?: string;
  renderType?: string;
};

export async function onRequestError(
  err: (Error & { digest?: string }) | unknown,
  request: RequestErrorRequest,
  context: RequestErrorContext
): Promise<void> {
  const e = err instanceof Error ? err : new Error(String(err));
  const digest = (e as { digest?: string }).digest;

  const payload = {
    message: digest ? `${e.message} [digest:${digest}]` : e.message,
    stack: e.stack,
    source: `server_${context.routeType}`,
    url: request.path,
    userAgent: request.headers['user-agent'],
    componentStack: `${context.routerKind} ${context.routePath} (${context.renderSource || 'n/a'})`,
  };

  console.error('[onRequestError]', JSON.stringify({
    msg: payload.message,
    path: request.path,
    method: request.method,
    routeType: context.routeType,
    digest,
  }));

  // Best-effort POST to /api/errors. Uses the request's own host so it
  // works in any environment (preview, prod, local). Swallows failures
  // because the error path must never throw.
  try {
    const host = request.headers.host;
    if (!host) return;
    const proto = request.headers['x-forwarded-proto'] || 'https';
    await fetch(`${proto}://${host}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Already logged via console.error above.
  }
}
