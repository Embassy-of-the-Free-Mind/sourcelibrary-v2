/**
 * A publish through the SCRIPT writer must evict the book's cached pages (#6227).
 *
 * Three lojong books published with setPublication() from a script kept serving
 * cached 404s (x-vercel-cache: HIT) until a hand-run layout-pattern revalidation
 * and a Cloudflare purge — the in-process route did it, the script writer did not.
 * These pin: withdrawn → public calls the eviction with the book's id and slug;
 * the eviction is the layout-pattern call THEN the page call; a failed eviction
 * is reported with the exact follow-up instead of a silent success.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { setPublication, setPublicationMany, needsEviction } from '../../scripts/lib/publication.mjs';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import { revalidateBookPages, READER_PAGE_PATTERN } from '../../scripts/lib/revalidate.mjs';

type Doc = Record<string, unknown>;

/** Just enough of a Db for the writer: books by `id`, updates recorded, events kept. */
function fakeDb(docs: Doc[]) {
  const books = docs.map((d) => ({ ...d }));
  const match = (f: Doc, d: Doc): boolean => {
    if (Array.isArray(f.$or)) return (f.$or as Doc[]).some((g) => match(g, d));
    return Object.entries(f).every(([k, v]) => {
      if (v && typeof v === 'object' && '$in' in (v as Doc)) return ((v as Doc).$in as unknown[]).some((x) => String(x) === String(d[k]));
      return String(d[k]) === String(v);
    });
  };
  const apply = (d: Doc, u: Doc) => {
    Object.assign(d, u.$set);
    for (const k of Object.keys((u.$unset as Doc) || {})) delete d[k];
  };
  const events: Doc[] = [];
  const db = {
    collection(name: string) {
      if (name === 'publication_events') {
        return { insertOne: async (e: Doc) => { events.push(e); }, insertMany: async (es: Doc[]) => { events.push(...es); } };
      }
      return {
        findOne: async (f: Doc) => books.find((d) => match(f, d)) ?? null,
        find: (f: Doc) => ({ toArray: async () => books.filter((d) => match(f, d)) }),
        updateOne: async (f: Doc, u: Doc) => { const d = books.find((x) => match(f, x)); if (d) apply(d, u); },
        updateMany: async (f: Doc, u: Doc) => { for (const d of books.filter((x) => match(f, x))) apply(d, u); },
      };
    },
  };
  return { db, books, events };
}

const BY = 'test:publication-eviction';
const HIDDEN = { _id: 'oid-1', id: 'lojong-1', slug: 'seven-points', visible: false, hidden: true, hidden_reason: 'quality' };
const PUBLIC = { _id: 'oid-2', id: 'pub-1', slug: 'already-public', visible: true, hidden: false };

describe('setPublication evicts the cache on a publish (#6227)', () => {
  it('hidden → public calls the eviction once, with the book id and slug', async () => {
    const { db } = fakeDb([HIDDEN]);
    const evict = vi.fn(async () => {});
    const r = await setPublication(db, 'lojong-1', { state: 'public', by: BY, evict });
    expect(r.status).toBe('written');
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict.mock.calls[0][0]).toEqual([{ id: 'lojong-1', slug: 'seven-points' }]);
    expect(r.eviction).toEqual({ ok: true });
  });

  it('a failed eviction is not a silent success: the result carries the exact follow-up', async () => {
    const { db, books } = fakeDb([HIDDEN]);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await setPublication(db, 'lojong-1', {
      state: 'public', by: BY, evict: async () => { throw new Error('no REVALIDATE_SECRET'); },
    });
    err.mockRestore();
    expect(books[0].visible).toBe(true); // the write stands
    expect(r.eviction.ok).toBe(false);
    expect(r.eviction.followUp).toContain('"type":"layout"');
    expect(r.eviction.followUp).toContain(READER_PAGE_PATTERN);
    expect(r.eviction.followUp).toContain('/book/seven-points');
  });

  it('no eviction for an unchanged write, a skip, or a plain hide', async () => {
    const { db } = fakeDb([PUBLIC, HIDDEN]);
    const evict = vi.fn(async () => {});
    await setPublication(db, 'pub-1', { state: 'public', by: BY, evict });
    await setPublication(db, 'lojong-1', { state: 'public', by: BY, evict, from: ['unpublished'] });
    await setPublication(db, 'pub-1', { state: 'hidden', reason: 'duplicate', by: BY, evict });
    expect(evict).not.toHaveBeenCalled();
  });

  it('setPublicationMany evicts every published book in ONE call', async () => {
    const hidden2 = { ...HIDDEN, _id: 'oid-3', id: 'lojong-2', slug: 'mind-training' };
    const { db } = fakeDb([HIDDEN, hidden2, PUBLIC]);
    const evict = vi.fn(async () => {});
    const r = await setPublicationMany(db, ['lojong-1', 'lojong-2', 'pub-1'], { state: 'public', by: BY, evict });
    expect(r.written).toEqual(expect.arrayContaining(['lojong-1', 'lojong-2'])); // pub-1 gains a publication field; no eviction
    expect(evict).toHaveBeenCalledTimes(1);
    expect(evict.mock.calls[0][0].map((b: Doc) => b.id).sort()).toEqual(['lojong-1', 'lojong-2']);
  });

  it('needsEviction: withdrawn → reachable and anything → takedown', () => {
    expect(needsEviction('hidden', 'public')).toBe(true);
    expect(needsEviction('takedown', 'public')).toBe(true);
    expect(needsEviction('hidden', 'unpublished')).toBe(true);
    expect(needsEviction('public', 'takedown')).toBe(true);
    expect(needsEviction('unpublished', 'public')).toBe(false);
    expect(needsEviction('public', 'hidden')).toBe(false);
    expect(needsEviction('takedown', 'takedown')).toBe(false);
  });
});

describe('revalidateBookPages (#6227)', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv('REVALIDATE_SECRET', 'test-secret');
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ revalidated: 1 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it('layout-pattern call first, then the book paths as pages (which the route purges)', async () => {
    await revalidateBookPages([{ id: 'lojong-1', slug: 'seven-points' }], { quiet: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies[0]).toEqual({ paths: [READER_PAGE_PATTERN, '/book/seven-points', '/book/lojong-1'], type: 'layout' });
    expect(bodies[1]).toEqual({ paths: ['/book/seven-points', '/book/lojong-1'] });
  });

  it('throws when the server revalidated nothing', async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ revalidated: 0 }), { status: 200 }));
    await expect(revalidateBookPages([{ id: 'x' }], { quiet: true })).rejects.toThrow(/revalidated 0/);
  });
});
