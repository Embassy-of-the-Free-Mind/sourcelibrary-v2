import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Session } from 'next-auth';
import type { SpendAccessDoc, SpendData, SpendViewer } from '@/lib/spend-report';

/**
 * /admin/spend (#5225) is gated by a NAMED allow-list, not by role. This drives
 * the real `requireSpendViewer` / `resolveSpendViewer` / `redactForViewer` with
 * `auth()`, the database and `redirect()` faked.
 *
 * Negative control (run 2026-09-28): deleting the `!listed` branch in
 * resolveSpendViewer turns "refuses an admin who is not on the list" and the
 * missing-access-document case red.
 */

let currentSession: Session | null = null;
let accessDoc: SpendAccessDoc | null = null;

vi.mock('@/lib/auth', () => ({
  ROLE_LEVEL: { reader: 1, contributor: 2, editor: 3, admin: 4, superadmin: 5 },
  auth: vi.fn(async () => currentSession),
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      findOne: async (q: { _id?: string }) => (q?._id === 'spend-dashboard-access' ? accessDoc : null),
    }),
  })),
}));

vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => { throw new Error(`NEXT_REDIRECT ${url}`); }),
}));

const signedIn = (email: string, role = 'admin'): Session => ({
  user: { id: 'u1', name: 'Someone', email, role } as Session['user'],
  expires: new Date(Date.now() + 3600_000).toISOString(),
});

describe('requireSpendViewer', () => {
  beforeEach(() => {
    currentSession = null;
    accessDoc = {
      _id: 'spend-dashboard-access',
      viewers: ['Listed@Example.com'],
      people_viewers: ['owner@example.com'],
    };
    process.env.PLATFORM_ADMIN_EMAILS = 'super@example.com';
  });

  it('sends a signed-out visitor to sign in', async () => {
    const { requireSpendViewer } = await import('@/lib/spend-report');
    await expect(requireSpendViewer()).rejects.toThrow('NEXT_REDIRECT /auth/signin');
  });

  it('refuses an admin who is not on the list', async () => {
    currentSession = signedIn('other-admin@example.com');
    const { requireSpendViewer } = await import('@/lib/spend-report');
    await expect(requireSpendViewer()).rejects.toThrow('NEXT_REDIRECT /unauthorized');
  });

  it('refuses everyone but platform superadmins when the access document is missing', async () => {
    accessDoc = null;
    const { resolveSpendViewer } = await import('@/lib/spend-report');
    expect(await resolveSpendViewer(signedIn('listed@example.com'))).toBeNull();
    expect(await resolveSpendViewer(signedIn('super@example.com'))).toMatchObject({ canSeePeople: false });
  });

  it('admits a listed account, case-insensitively, without the people sections', async () => {
    currentSession = signedIn('listed@example.com');
    const { requireSpendViewer } = await import('@/lib/spend-report');
    const v = await requireSpendViewer();
    expect(v.email).toBe('listed@example.com');
    expect(v.canSeePeople).toBe(false);
  });

  it('admits a platform superadmin who is not listed, still without people', async () => {
    currentSession = signedIn('super@example.com', 'reader');
    const { requireSpendViewer } = await import('@/lib/spend-report');
    expect((await requireSpendViewer()).canSeePeople).toBe(false);
  });

  it('gives the people sections only to people_viewers', async () => {
    accessDoc!.viewers.push('owner@example.com');
    const { resolveSpendViewer } = await import('@/lib/spend-report');
    expect((await resolveSpendViewer(signedIn('owner@example.com')))?.canSeePeople).toBe(true);
  });
});

describe('redactForViewer', () => {
  it('drops hours, people and their intros for a plain viewer, without mutating', async () => {
    const { redactForViewer } = await import('@/lib/spend-report');
    const data: SpendData = {
      generated: '2026-09-28', gcpFrom: 'a', gcpTo: 'b', drivers: [], projects: [], daily: [], skus: [],
      monthly: { vendors: [], months: [], excluded: [], people: [{ name: 'X', role: 'r', monthly_usd: 1 }] },
      hours: { months: { '2026-09': { hours: 1, active_days: 1, prompts: 1 } } },
      text: { findings: ['f'], hours_intro: 'h', people_intro: 'p' },
    };
    const viewer: SpendViewer = { session: signedIn('v@example.com'), email: 'v@example.com', canSeePeople: false };
    const out = redactForViewer(data, viewer);
    expect(out.hours).toBeNull();
    expect(out.monthly.people).toBeUndefined();
    expect(out.text?.hours_intro).toBeUndefined();
    expect(out.text?.findings).toEqual(['f']);
    expect(data.monthly.people).toHaveLength(1);
    expect(redactForViewer(data, { ...viewer, canSeePeople: true }).monthly.people).toHaveLength(1);
  });
});
