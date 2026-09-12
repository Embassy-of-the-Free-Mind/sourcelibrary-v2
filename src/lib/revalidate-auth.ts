import { NextRequest } from 'next/server';

/**
 * Auth for the on-demand revalidation routes (/api/admin/revalidate,
 * /api/admin/revalidate-book/[id]).
 *
 * Fail-closed: a request is authorized only when it presents a secret matching
 * REVALIDATE_SECRET or CRON_SECRET, via the `x-revalidate-secret` header or
 * `Authorization: Bearer <secret>`. If neither env var is set, nothing is
 * authorized.
 *
 * History: the previous check was `if (secret && header !== secret) 401` —
 * with REVALIDATE_SECRET unset in production that skipped auth entirely,
 * leaving an unauthenticated cache-invalidation lever on the public site
 * (each accepted call forces origin re-renders, i.e. someone else's compute
 * bill). Found 2026-08-31 during the #4389 slug repair. CRON_SECRET is
 * accepted so every existing pipeline caller already holds a working secret.
 */
export function isRevalidateAuthorized(request: NextRequest): boolean {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const presented = [request.headers.get('x-revalidate-secret'), bearer].filter(
    (p): p is string => typeof p === 'string' && p.length > 0
  );
  const secrets = [process.env.REVALIDATE_SECRET, process.env.CRON_SECRET].filter(
    (s): s is string => typeof s === 'string' && s.length > 0
  );
  return secrets.length > 0 && presented.some((p) => secrets.includes(p));
}
