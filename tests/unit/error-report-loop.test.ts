import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `onRequestError` reports server errors by POSTing to /api/errors — a real HTTP
 * request back into the same deployment. Unguarded, an error ON that endpoint
 * reports itself, and the loop has gain > 1.
 *
 * On 2026-08-18 that produced 389,193 gateway timeouts on /api/errors in 35
 * minutes while storing 161 rows, took edge traffic from ~20K to ~357K requests
 * per 5 minutes, and exhausted the Atlas connection pool until unrelated API
 * routes and production builds could not get a connection.
 *
 * These pin the two guards. They are behavioural, not structural: they assert
 * that no fetch leaves the process, so a refactor that keeps the comment and
 * drops the guard still fails.
 */

const req = (path: string) => ({
  path,
  method: 'GET',
  headers: { host: 'sourcelibrary.org', 'x-forwarded-proto': 'https' },
});
const ctx = {
  routerKind: 'App Router' as const,
  routePath: '/x',
  routeType: 'route' as const,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('onRequestError does not feed its own reporting endpoint', () => {
  it('POSTs a report for an ordinary route error', async () => {
    const { onRequestError } = await import('@/instrumentation');
    await onRequestError(new Error('boom'), req('/book/atalanta-fugiens-maier'), ctx);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/errors');
  });

  it('sends NOTHING when the failing request is /api/errors itself', async () => {
    const { onRequestError } = await import('@/instrumentation');
    await onRequestError(new Error('gateway timeout'), req('/api/errors'), ctx);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still logs to console for a self-error, so the report is not lost', async () => {
    const spy = vi.spyOn(console, 'error');
    const { onRequestError } = await import('@/instrumentation');
    await onRequestError(new Error('gateway timeout'), req('/api/errors'), ctx);
    expect(spy).toHaveBeenCalled(); // Vercel logs remain the reliable channel
  });

  it('opens a circuit breaker after repeated reporting failures', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    const { onRequestError } = await import('@/instrumentation');
    // Three failures trip the breaker...
    for (let i = 0; i < 3; i++) await onRequestError(new Error('e'), req(`/book/${i}`), ctx);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    // ...after which further errors stop generating traffic at all.
    for (let i = 0; i < 5; i++) await onRequestError(new Error('e'), req(`/book/x${i}`), ctx);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('bounds the report request so a wedged endpoint cannot hold the function', async () => {
    const { onRequestError } = await import('@/instrumentation');
    await onRequestError(new Error('boom'), req('/search'), ctx);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeDefined();
  });
});
