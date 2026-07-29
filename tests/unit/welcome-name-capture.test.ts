import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// /welcome is the ONLY place Source Library ever asks for a name. Google
// sign-ins arrive with one from the OAuth profile; magic-link sign-ins never do
// — 1,762 of 3,854 user documents (46%) had users.name null when this shipped.
//
// These tests exercise the real route handler and assert on the update document
// it actually writes. The cases that matter are the two asymmetries, both of
// which are easy to "simplify" away later:
//   1. a blank name must NOT clear an existing one (didn't answer ≠ delete it)
//   2. skipping must still stamp welcomedAt, or the gate re-fires forever
const userUpdates: { filter: unknown; update: Record<string, any> }[] = [];
const volunteerUpdates: { filter: unknown; update: Record<string, any> }[] = [];

let sessionUser: { id: string; email: string; name?: string | null } | null = null;

vi.mock('@/lib/auth', () => ({
  auth: vi.fn(async () => (sessionUser ? { user: sessionUser } : null)),
  RESEND_AUDIENCE_ID: 'test-audience',
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: (name: string) => ({
      updateOne: async (filter: unknown, update: Record<string, any>) => {
        (name === 'users' ? userUpdates : volunteerUpdates).push({ filter, update });
        return { modifiedCount: 1 };
      },
    }),
  })),
}));

function post(body: unknown) {
  return new Request('https://sourcelibrary.org/api/me/welcome', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;
}

beforeEach(() => {
  userUpdates.length = 0;
  volunteerUpdates.length = 0;
  sessionUser = { id: '699508ede7f094a3786bed8e', email: 'Reader@Example.com', name: null };
  delete process.env.RESEND_API_KEY;
});
afterEach(() => { vi.clearAllMocks(); });

describe('/api/me/welcome name capture', () => {
  it('saves a name given by a magic-link user who had none', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    const res = await POST(post({ name: 'Derek Lomas', about_you: 'Here for the Hermetica.' }));

    expect(res.status).toBe(200);
    expect(userUpdates).toHaveLength(1);
    expect(userUpdates[0].update.$set.name).toBe('Derek Lomas');
    expect(userUpdates[0].update.$set['profile.aboutYou']).toBe('Here for the Hermetica.');
    expect(userUpdates[0].update.$set.welcomedAt).toBeInstanceOf(Date);
  });

  it('does NOT clear an existing name when the field is left blank', async () => {
    // A Google user's name is prefilled; if they clear the box, that is far more
    // likely to be a stray keystroke than a request to become anonymous. Writing
    // '' here would silently strip names from the very users who have them.
    sessionUser = { id: '699508ede7f094a3786bed8e', email: 'reader@example.com', name: 'Existing Name' };
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: '   ', about_you: 'Something.' }));

    expect(userUpdates[0].update.$set).not.toHaveProperty('name');
  });

  it('normalises whitespace and caps length', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: '  Marsilio   Ficino  ', about_you: 'x' }));
    expect(userUpdates[0].update.$set.name).toBe('Marsilio Ficino');

    userUpdates.length = 0;
    await POST(post({ name: 'a'.repeat(500), about_you: 'x' }));
    expect((userUpdates[0].update.$set.name as string).length).toBe(100);
  });

  it('stamps welcomedAt on skip so the gate never fires again, without a profile', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ skip: true, name: 'Ignored On Skip' }));

    const set = userUpdates[0].update.$set;
    expect(set.welcomedAt).toBeInstanceOf(Date);
    expect(set).not.toHaveProperty('name');
    expect(set).not.toHaveProperty('profile.aboutYou');
    expect(volunteerUpdates).toHaveLength(0);
  });

  it('keys the user update by ObjectId, not the raw session string', async () => {
    // The whole reason this flow was unreachable for 3,850 users. See
    // tests/unit/user-id-objectid.test.ts.
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'X', about_you: 'y' }));

    const filter = userUpdates[0].filter as { _id: unknown };
    expect(typeof filter._id).not.toBe('string');
    expect(String(filter._id)).toBe('699508ede7f094a3786bed8e');
  });

  it('carries the new name into the volunteers outreach mirror', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'New Name', about_you: 'a', help_description: 'b' }));

    expect(volunteerUpdates).toHaveLength(1);
    expect(volunteerUpdates[0].update.$set.name).toBe('New Name');
    // email is lowercased for the outreach key
    expect(volunteerUpdates[0].filter).toEqual({ email: 'reader@example.com' });
  });

  it('rejects an unauthenticated caller', async () => {
    sessionUser = null;
    const { POST } = await import('@/app/api/me/welcome/route');
    const res = await POST(post({ name: 'Nobody' }));

    expect(res.status).toBe(401);
    expect(userUpdates).toHaveLength(0);
  });
});
