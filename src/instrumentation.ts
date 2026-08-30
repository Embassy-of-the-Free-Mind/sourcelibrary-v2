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
 *      `application_errors` when Atlas is healthy — but never for an error on
 *      /api/errors itself, and not at all while that path is failing.
 *
 * That second guard is load-bearing, not defensive dressing. The POST is a real
 * HTTP request back into this deployment, so an unguarded reporter turns any
 * failure of the reporting path into more traffic to the reporting path. See
 * the comment at the POST for what that cost on 2026-08-18.
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

  // NEVER report an error that happened ON the reporting endpoint.
  //
  // This POST is a real HTTP request back through Cloudflare into this same
  // deployment. So when /api/errors itself fails, reporting that failure calls
  // /api/errors again — a feedback loop with gain > 1. On 2026-08-18 it produced
  // 389,193 gateway timeouts on /api/errors in 35 minutes while storing 161 rows,
  // drove edge traffic from ~20K to ~357K requests per 5 minutes, and exhausted
  // the Atlas connection pool (every POST wants a Mongo connection) until
  // unrelated API routes and production builds could not get one.
  //
  // The console.error above already ran, so Vercel logs still capture it. That
  // is the reliable channel here — the network hop is the optional one.
  if (request.path.startsWith('/api/errors')) return;

  // Circuit breaker: once the reporting path starts failing, stop feeding it.
  //
  // Self-recursion is the sharpest form of the loop, but not the only one — any
  // widespread failure (Atlas unreachable) makes EVERY route error and each one
  // POSTs. That is a stampede onto the exact dependency that is already down.
  // After REPORT_FAILURE_LIMIT consecutive failures we stay silent for
  // REPORT_COOLDOWN_MS, then allow one probe through to test recovery.
  const now = Date.now();
  if (reportCircuitOpenUntil > now) return;

  try {
    const host = request.headers.host;
    if (!host) return;
    const proto = request.headers['x-forwarded-proto'] || 'https';
    const res = await fetch(`${proto}://${host}/api/errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
      // Without a deadline this await can occupy the function for the full
      // platform timeout while the reporting path is wedged.
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (res.ok) consecutiveReportFailures = 0;
    else noteReportFailure();
  } catch {
    // Already logged via console.error above.
    noteReportFailure();
  }
}

// Module scope: per server instance, which is the right granularity — each
// Vercel instance throttles its own contribution to the stampede.
const REPORT_FAILURE_LIMIT = 3;
const REPORT_COOLDOWN_MS = 60_000;
const REPORT_TIMEOUT_MS = 2_000;
let consecutiveReportFailures = 0;
let reportCircuitOpenUntil = 0;

function noteReportFailure(): void {
  consecutiveReportFailures += 1;
  if (consecutiveReportFailures >= REPORT_FAILURE_LIMIT) {
    reportCircuitOpenUntil = Date.now() + REPORT_COOLDOWN_MS;
    consecutiveReportFailures = 0;
    console.error('[onRequestError] error reporting is failing — pausing POSTs for 60s');
  }
}
