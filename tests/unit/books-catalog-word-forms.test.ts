import { describe, it, expect, vi, beforeEach } from 'vitest';

// The catalogue book lane (#5517) asks twice when a word has related forms:
// once as typed, once widened, and puts the typed matches first. These pin the
// three things that would fail silently: a query with nothing to fold must not
// change at all (names, Latin, every non-Latin script), the reader's own form
// must not be crowded out of the lane's unordered sample, and a failed widened
// query must not take the typed result down with it.

const state = vi.hoisted(() => ({
  filters: [] as string[],
  respond: (_filter: string): { data: Array<{ id: string }> | null; error: { message: string } | null } => ({ data: [], error: null }),
}));

vi.mock('@/lib/supabase', () => {
  const builder = () => {
    let filter: string | null = null;
    let limit = Infinity;
    const b: any = {
      select: () => b, eq: () => b, gt: () => b, gte: () => b, lte: () => b, contains: () => b, ilike: () => b,
      // The first `or` is the search filter; later ones are the artwork gate.
      or: (f: string) => { if (filter === null) { filter = f; state.filters.push(f); } return b; },
      limit: (n: number) => { limit = n; return b; },
      then: (resolve: any, reject: any) => {
        const r = state.respond(filter || '');
        return Promise.resolve({ ...r, data: r.data ? r.data.slice(0, limit) : r.data }).then(resolve, reject);
      },
    };
    return b;
  };
  return {
    supabase: { from: () => builder() },
    supabaseAdmin: { from: () => builder() },
    sanitizeFilterValue: (v: string) => v.replace(/[,()]/g, ''),
  };
});

const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}` }));
const isWidened = (f: string) => f.includes('.imatch.');

beforeEach(() => {
  state.filters = [];
  state.respond = () => ({ data: [], error: null });
});

describe('catalogue book lane: related word forms', () => {
  it.each(['本草', '煉丹', 'الكيمياء', 'קבלה', 'ज्योतिष', 'φιλοσοφία', 'алхимия', 'Kräuterbuch', 'Paracelsus', 'magic', 'Corpus Hermeticum', 'Zhu Xi'])(
    '%s: one query, matched as typed',
    async (q) => {
      const { searchBookIds, searchBooksCatalog } = await import('@/lib/books-catalog');
      await searchBookIds(q);
      await searchBooksCatalog(q);
      expect(state.filters).toHaveLength(2); // one per function
      for (const f of state.filters) {
        expect(isWidened(f)).toBe(false);
        for (const word of q.split(' ')) expect(f).toContain(`title.ilike.%${word}%`);
      }
    },
  );

  it('a quoted phrase is never widened', async () => {
    const { searchBookIds } = await import('@/lib/books-catalog');
    await searchBookIds('"magical plants"');
    expect(state.filters).toEqual(['title.ilike.%magical plants%,display_title.ilike.%magical plants%,author.ilike.%magical plants%']);
  });

  it('widens a word to its forms, anchored at the start of a word', async () => {
    const { searchBookIds } = await import('@/lib/books-catalog');
    await searchBookIds('optical');
    const [typed, widened] = [state.filters.find(f => !isWidened(f))!, state.filters.find(isWidened)!];
    expect(typed).toContain('title.ilike.%optical%');
    expect(typed).not.toContain('optics');
    expect(widened).toContain('title.imatch.\\moptic');   // \m: "Coptic" does not match
    expect(widened).not.toContain('ilike.%optic%');
    expect(widened).toContain('"optics"');                // subject_keywords forms
    expect(widened).toContain('"Optics"');
  });

  it('widens every word of a multi-word query but never the author match', async () => {
    const { searchBooksCatalog } = await import('@/lib/books-catalog');
    await searchBooksCatalog('magical poetry');
    const widened = state.filters.find(isWidened)!;
    expect(widened).toContain('and(title.imatch.\\mmagic,or(title.imatch.\\mpoet,title.imatch.\\mpoem))');
    expect(widened).toContain('and(author.ilike.%magical%,author.ilike.%poetry%)');
    expect(widened).not.toContain('author.imatch');
  });

  it('puts the typed form first and fills the rest of the limit with related forms', async () => {
    state.respond = f => ({ data: isWidened(f) ? [...ids('related', 30), ...ids('typed', 5)] : ids('typed', 5), error: null });
    const { searchBookIds } = await import('@/lib/books-catalog');
    const out = await searchBookIds('magical', { limit: 12 });
    expect(out.slice(0, 5)).toEqual(ids('typed', 5).map(r => r.id));
    expect(out).toHaveLength(12);
    expect(new Set(out).size).toBe(12);
    expect(out.slice(5).every(id => id.startsWith('related'))).toBe(true);
  });

  it('does not let related forms displace typed matches that already fill the limit', async () => {
    state.respond = f => ({ data: isWidened(f) ? ids('related', 40) : ids('typed', 40), error: null });
    const { searchBookIds } = await import('@/lib/books-catalog');
    const out = await searchBookIds('magical', { limit: 10 });
    expect(out.every(id => id.startsWith('typed'))).toBe(true);
  });

  it('keeps the typed result when the widened query fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.respond = f => (isWidened(f) ? { data: null, error: { message: 'statement timeout' } } : { data: ids('typed', 3), error: null });
    const { searchBookIds } = await import('@/lib/books-catalog');
    expect(await searchBookIds('magical')).toEqual(['typed0', 'typed1', 'typed2']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still throws when the typed query fails', async () => {
    state.respond = () => ({ data: null, error: { message: 'boom' } });
    const { searchBookIds } = await import('@/lib/books-catalog');
    await expect(searchBookIds('magical')).rejects.toThrow('boom');
    await expect(searchBookIds('Paracelsus')).rejects.toThrow('boom');
  });
});
