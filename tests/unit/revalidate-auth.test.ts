/**
 * The revalidation routes must FAIL CLOSED.
 *
 * INCIDENT (2026-08-31, found during the #4389 slug repair): the auth check in
 * /api/admin/revalidate and /api/admin/revalidate-book/[id] was
 * `if (secret && header !== secret) 401` — so with REVALIDATE_SECRET unset in
 * production the check was skipped entirely, and an unauthenticated POST could
 * force origin re-renders of arbitrary paths (a cache-busting lever anyone on
 * the internet could pull; each accepted call spends origin compute). The call
 * that discovered it carried no secret and no session and was accepted.
 *
 * This pins the replacement: no configured secret ⇒ nothing is authorized;
 * a configured secret must actually match; CRON_SECRET is accepted so every
 * existing pipeline caller keeps working.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { isRevalidateAuthorized } from '@/lib/revalidate-auth';

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('https://sourcelibrary.org/api/admin/revalidate', {
    method: 'POST',
    headers,
  });
}

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved.REVALIDATE_SECRET = process.env.REVALIDATE_SECRET;
  saved.CRON_SECRET = process.env.CRON_SECRET;
  delete process.env.REVALIDATE_SECRET;
  delete process.env.CRON_SECRET;
});

afterEach(() => {
  for (const k of ['REVALIDATE_SECRET', 'CRON_SECRET'] as const) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('isRevalidateAuthorized fails closed', () => {
  it('refuses everything when no secret is configured — the incident shape', () => {
    expect(isRevalidateAuthorized(req())).toBe(false);
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': 'anything' }))).toBe(false);
    expect(isRevalidateAuthorized(req({ authorization: 'Bearer anything' }))).toBe(false);
  });

  it('refuses a missing or wrong secret when one is configured', () => {
    process.env.REVALIDATE_SECRET = 'right';
    expect(isRevalidateAuthorized(req())).toBe(false);
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': 'wrong' }))).toBe(false);
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': '' }))).toBe(false);
  });

  it('accepts a matching x-revalidate-secret', () => {
    process.env.REVALIDATE_SECRET = 'right';
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': 'right' }))).toBe(true);
  });

  it('accepts CRON_SECRET via header or Bearer — pipeline callers keep working', () => {
    process.env.CRON_SECRET = 'cron';
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': 'cron' }))).toBe(true);
    expect(isRevalidateAuthorized(req({ authorization: 'Bearer cron' }))).toBe(true);
  });

  it('an empty configured secret authorizes nothing', () => {
    process.env.REVALIDATE_SECRET = '';
    expect(isRevalidateAuthorized(req({ 'x-revalidate-secret': '' }))).toBe(false);
  });
});

describe('the routes actually use the guard (structural)', () => {
  it.each([
    'src/app/api/admin/revalidate/route.ts',
    'src/app/api/admin/revalidate-book/[id]/route.ts',
  ])('%s imports isRevalidateAuthorized and has no fail-open check', async (rel) => {
    const { readFileSync } = await import('fs');
    const path = await import('path');
    const src = readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    expect(src).toContain('isRevalidateAuthorized');
    // The incident shape: a check guarded on the secret existing.
    expect(src).not.toMatch(/if\s*\(\s*secret\s*&&/);
  });
});
