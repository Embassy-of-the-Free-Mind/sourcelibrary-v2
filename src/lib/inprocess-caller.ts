/**
 * The caller behind a request one route built and handed to another in-process
 * (#4307, #6853).
 *
 * PRIOR ART: none — searched src/lib for `WeakMap<Request` and `x-sl-caller`;
 *   the signed-header design in #4307 was never built. Kept apart from
 *   src/lib/mcp-inprocess.ts so a log writer can read it without importing
 *   the routes that module loads.
 *
 * Keyed by the Request OBJECT, so nothing a client sends can claim an
 * identity here: only code that constructed the request can register one.
 */
import type { ApiIdentity } from '@/lib/api-auth';

const callers = new WeakMap<Request, ApiIdentity>();

export function setInProcessCaller(request: Request, identity: ApiIdentity): void {
  callers.set(request, identity);
}

/** The identity behind an in-process request; undefined for one that came over the wire. */
export function inProcessCaller(request: Request): ApiIdentity | undefined {
  return callers.get(request);
}
