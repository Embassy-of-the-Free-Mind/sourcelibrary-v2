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

  it('persists preferred language, with a lowercased key for grouping', async () => {
    // The failure mode this guards is silent: a field the form sends but the
    // route never parses is dropped with a 200 and simply absent later — the
    // shape of the analytics prop-allowlist bug (#3405/CLAUDE.md). The only way
    // to catch it is to assert the round trip, not the form.
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'X', preferred_language: '  Brazilian   Portuguese ' }));

    const set = userUpdates[0].update.$set;
    expect(set['profile.preferredLanguage']).toBe('Brazilian Portuguese');
    expect(set['profile.preferredLanguageKey']).toBe('brazilian portuguese');
  });

  it('mirrors preferred language to volunteers even with no other answer', async () => {
    // Language alone is a real signal (it tells us what to translate next), so
    // it must not need `about_you` to ride along to be recorded.
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ preferred_language: 'Spanish' }));

    expect(volunteerUpdates).toHaveLength(1);
    expect(volunteerUpdates[0].update.$set.preferred_language).toBe('Spanish');
  });

  // "Asked and declined" must still be distinguishable from "never asked" — but
  // the signal now comes from the caller SENDING the key, not from the route
  // inventing an empty value for a key nobody sent. That inference was the
  // data-loss bug: the welcome form rendered blank, so a save meant to record a
  // name wrote '' over answers the reader had given earlier and could not see
  // (two readers lost theirs on 2026-07-30). The form sends all four fields
  // whenever it could prefill them, so the declined case is unchanged in
  // production; it omits only what it could not show the reader.
  it('records an empty language when the reader explicitly left it blank', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'X', about_you: 'y', preferred_language: '' }));

    expect(userUpdates[0].update.$set).toHaveProperty('profile.preferredLanguage', '');
    expect(userUpdates[0].update.$set).toHaveProperty('profile.preferredLanguageKey', '');
  });

  it('leaves a field alone when the caller omits it', async () => {
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'X', about_you: 'y' }));

    const set = userUpdates[0].update.$set;
    expect(set).toHaveProperty('profile.aboutYou', 'y');
    expect(set).not.toHaveProperty('profile.preferredLanguage');
    expect(set).not.toHaveProperty('profile.helpDescription');
  });

  it('never lets an omitted field blank the volunteers copy of record', async () => {
    // volunteers is the last-resort backup — it is the only reason the two
    // blanked profiles were recoverable at all.
    const { POST } = await import('@/app/api/me/welcome/route');
    await POST(post({ name: 'X', about_you: 'still here' }));

    expect(volunteerUpdates).toHaveLength(1);
    const set = volunteerUpdates[0].update.$set;
    expect(set).toHaveProperty('about_you', 'still here');
    expect(set).not.toHaveProperty('help_description');
    expect(set).not.toHaveProperty('preferred_language');
  });

  it('rejects an unauthenticated caller', async () => {
    sessionUser = null;
    const { POST } = await import('@/app/api/me/welcome/route');
    const res = await POST(post({ name: 'Nobody' }));

    expect(res.status).toBe(401);
    expect(userUpdates).toHaveLength(0);
  });
});
