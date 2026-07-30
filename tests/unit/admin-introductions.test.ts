import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// /admin/introductions is the only place in the product that can read what
// readers wrote about themselves on /welcome. The form has been collecting free
// text since 2026-07-29 and nothing surfaced it — /admin/users shows *whether*
// someone was welcomed, not a word of what they said.
//
// The load-bearing behaviour here is the language tally. Readers type free text
// on purpose ("English and Spanish", "español", "Spanish-English", "I AM GOOD IN
// ENGLISH, BUT SPANISH IS MY FIRST LANGUAGE") because a dropdown can only offer
// the languages we already thought of. So the tally must count a *mention*, not
// an exact match — and it must not silently drop answers it fails to recognise,
// which would quietly defeat the entire reason the field is free text.
let docs: Record<string, unknown>[] = [];
let welcomedCount = 0;
let pendingCount = 0;

vi.mock('@/lib/auth-helpers', () => ({
  // Auth is exercised by the shared withAuth tests; here it would only obscure
  // the thing under test.
  withAdminAuth: (h: (req: unknown, session: unknown) => Promise<Response>) =>
    (req: unknown) => h(req, { user: { id: 'admin', role: 'superadmin' } }),
}));

vi.mock('@/lib/mongodb', () => ({
  getDb: vi.fn(async () => ({
    collection: () => ({
      find: () => ({
        sort: () => ({ toArray: async () => docs }),
      }),
      countDocuments: async (q: Record<string, unknown>) =>
        'welcomedAt' in q && q.welcomedAt === null ? pendingCount : welcomedCount,
    }),
  })),
}));

function intro(over: Record<string, unknown> = {}) {
  return {
    _id: 'u1',
    name: 'A Reader',
    email: 'reader@example.com',
    createdAt: new Date('2026-07-29T10:00:00Z'),
    profile: {
      aboutYou: 'Here for the Hermetica.',
      helpDescription: '',
      preferredLanguage: 'English',
      preferredLanguageKey: 'english',
      updatedAt: new Date('2026-07-29T11:00:00Z'),
    },
    ...over,
  };
}

async function call() {
  const { GET } = await import('@/app/api/admin/introductions/route');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await (GET as any)(new Request('https://sourcelibrary.org/api/admin/introductions'));
  return res.json();
}

beforeEach(() => { docs = []; welcomedCount = 0; pendingCount = 0; });
afterEach(() => { vi.clearAllMocks(); });

describe('/api/admin/introductions', () => {
  it('returns what the reader actually wrote', async () => {
    docs = [intro()];
    welcomedCount = 1;
    const body = await call();

    expect(body.introductions).toHaveLength(1);
    expect(body.introductions[0].about).toBe('Here for the Hermetica.');
    expect(body.introductions[0].name).toBe('A Reader');
    expect(body.introductions[0].email).toBe('reader@example.com');
  });

  it('counts skipped as welcomed-minus-wrote', async () => {
    docs = [intro(), intro({ _id: 'u2' })];
    welcomedCount = 5;
    pendingCount = 3847;
    const body = await call();

    expect(body.totals.wrote).toBe(2);
    expect(body.totals.welcomed).toBe(5);
    expect(body.totals.skipped).toBe(3);
    expect(body.totals.pending).toBe(3847);
  });

  it('never reports negative skips when the counts disagree', async () => {
    // welcomedAt and profile.updatedAt are written by the same request, but a
    // partial failure could leave more profiles than welcomes. A negative stat
    // on an admin dashboard reads as a bug in the data, not in the arithmetic.
    docs = [intro(), intro({ _id: 'u2' }), intro({ _id: 'u3' })];
    welcomedCount = 1;
    const body = await call();
    expect(body.totals.skipped).toBe(0);
  });
});

describe('language tally — counts mentions, not exact matches', () => {
  const withLang = (lang: string, id: string) =>
    intro({ _id: id, profile: { ...intro().profile, preferredLanguage: lang } });

  it('counts a reader who names two languages for both', async () => {
    docs = [withLang('English and Spanish', 'u1')];
    const body = await call();
    const tally = Object.fromEntries(body.language_tally.map((l: { language: string; count: number }) => [l.language, l.count]));

    expect(tally.English).toBe(1);
    expect(tally.Spanish).toBe(1);
  });

  it('recognises the language in the reader\'s own language', async () => {
    // These are real answers from the first day of responses.
    docs = [
      withLang('español', 'u1'),
      withLang('Español', 'u2'),
      withLang('castellano', 'u3'),
      withLang('Italiano', 'u4'),
      withLang('inglés', 'u5'),
    ];
    const body = await call();
    const tally = Object.fromEntries(body.language_tally.map((l: { language: string; count: number }) => [l.language, l.count]));

    expect(tally.Spanish).toBe(3);
    expect(tally.Italian).toBe(1);
    expect(tally.English).toBe(1);
  });

  it('handles shouting, punctuation and full sentences', async () => {
    docs = [
      withLang('I AM GOOD IN ENGLISH, BUT SPANISH IS MY FIRST LANGUAGE', 'u1'),
      withLang('Spanish-English', 'u2'),
      withLang('English first, but I work directly in the German and Latin', 'u3'),
    ];
    const body = await call();
    const tally = Object.fromEntries(body.language_tally.map((l: { language: string; count: number }) => [l.language, l.count]));

    expect(tally.English).toBe(3);
    expect(tally.Spanish).toBe(2);
    expect(tally.German).toBe(1);
    expect(tally.Latin).toBe(1);
  });

  it('surfaces answers it could not classify instead of dropping them', async () => {
    // The whole point of a free-text field is catching what we did not predict.
    // Silently discarding an unrecognised answer would defeat it — and would look
    // identical to nobody having asked for that language.
    docs = [withLang('Tagalog', 'u1'), withLang('Swahili', 'u2'), withLang('English', 'u3')];
    const body = await call();

    expect(body.language_unmatched).toContain('Tagalog');
    expect(body.language_unmatched).toContain('Swahili');
    expect(body.language_unmatched).not.toContain('English');
  });

  it('ignores blank answers rather than counting them as respondents', async () => {
    docs = [withLang('', 'u1'), withLang('   ', 'u2'), withLang('English', 'u3')];
    const body = await call();

    expect(body.totals.gave_language).toBe(1);
    expect(body.totals.language_respondents).toBe(1);
  });

  it('omits languages nobody named', async () => {
    docs = [withLang('English', 'u1')];
    const body = await call();
    const names = body.language_tally.map((l: { language: string }) => l.language);

    expect(names).toContain('English');
    expect(names).not.toContain('Russian');
  });
});
