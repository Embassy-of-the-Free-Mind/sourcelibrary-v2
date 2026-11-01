import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'fs';
import path from 'path';

// A hidden repeat capture (#5056) opened inside a partner frame must 307 to the
// kept page WITHOUT leaving /embed/<tenant>/ (tenant-lockdown.md), and as a real
// redirect: a loading.tsx above the route turns it into a 200 + meta refresh.

const navigation = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(public url: string, public status: number) { super(`redirect ${status} ${url}`); }
  }
  return {
    Redirect,
    redirect: vi.fn((url: string) => { throw new Redirect(url, 307); }),
    permanentRedirect: vi.fn((url: string) => { throw new Redirect(url, 308); }),
    notFound: vi.fn(() => { throw new Error('notFound'); }),
  };
});
vi.mock('next/navigation', () => navigation);

const state = vi.hoisted(() => ({
  page: null as Record<string, unknown> | null,
  keeper: null as string | null,
}));

function cursor(rows: unknown[]) {
  const c = { project: () => c, sort: () => c, maxTimeMS: () => c, toArray: async () => rows };
  return c;
}
vi.mock('@/lib/mongodb', () => ({
  getReadDb: async () => ({
    collection: () => ({
      findOne: async () => state.page,
      find: () => cursor([]),
    }),
  }),
}));
vi.mock('@/lib/tenant-context', () => ({
  getTenantContext: async () => ({ id: 'tenant-bph', slug: 'bph', isEmbedded: true }),
  resolveTenantId: async () => 'tenant-bph',
}));
vi.mock('@/lib/tenant-catalog-books', () => ({
  findBookForTenant: async () => ({ book: { id: 'B', slug: 'the-imagines', visible: true, title: 'Imagines' } }),
}));
vi.mock('@/lib/music-transcriptions', () => ({ getTranscriptionsForPage: async () => [] }));
vi.mock('@/app/book/[id]/page/[pageId]/page-data', () => ({
  getRepeatKeeperId: vi.fn(async () => state.keeper),
  getSplitLeafId: vi.fn(async () => null),
  isArchivedSplit: () => false,
}));
vi.mock('@/lib/auth', () => ({ auth: async () => null }));
vi.mock('@/lib/fonts/aldine', () => ({ aldineVariables: '' }));
vi.mock('@/components/reader-v2/Reader2C', () => ({ default: () => null }));
vi.mock('@/components/book/HymnPlayer', () => ({ default: () => null }));
vi.mock('@/components/embed/EmbedNavigationReporter', () => ({ default: () => null }));

import EmbedReaderPage from '@/app/embed/[tenant]/book/[slug]/page/[pageId]/page';
import RoomReaderPage from '@/app/rooms/[slug]/book/[book]/page/[pageId]/page';

vi.mock('@/components/rooms/room-loader', () => ({ getCachedRoom: async () => ({ slug: 'my-room' }) }));
vi.mock('@/lib/reading-rooms', () => ({ findBookInRoom: async () => ({ id: 'B', slug: 'the-imagines' }) }));

async function caught(p: Promise<unknown>) {
  try { await p; } catch (e) { return e; }
  throw new Error('expected a redirect');
}

describe('embed reader: hidden repeat capture (#5056)', () => {
  beforeEach(() => {
    state.page = { id: 'hidden', book_id: 'B', page_number: 170, repeat_of: 'kept' };
    state.keeper = 'kept';
  });

  it('307s to the kept page and stays under /embed/<tenant>/', async () => {
    const element = await EmbedReaderPage({ params: Promise.resolve({ tenant: 'bph', slug: 'the-imagines', pageId: 'hidden' }) });
    const e = await caught((element as { type: (p: unknown) => Promise<unknown>; props: unknown }).type(
      (element as { props: unknown }).props,
    )) as InstanceType<typeof navigation.Redirect>;
    expect(e).toBeInstanceOf(navigation.Redirect);
    expect(e.status).toBe(307);
    expect(e.url).toBe('/embed/bph/book/the-imagines/page/kept');
  });

  it('in a reading room, stays under /rooms/<slug>/', async () => {
    const element = await RoomReaderPage({ params: Promise.resolve({ slug: 'my-room', book: 'the-imagines', pageId: 'hidden' }) });
    const e = await caught((element as { type: (p: unknown) => Promise<unknown>; props: unknown }).type(
      (element as { props: unknown }).props,
    )) as InstanceType<typeof navigation.Redirect>;
    expect(e.url).toBe('/rooms/my-room/book/the-imagines/page/kept');
  });

  it('renders a listed page without redirecting', async () => {
    state.page = { id: 'kept', book_id: 'B', page_number: 168 };
    navigation.redirect.mockClear();
    const element = await EmbedReaderPage({ params: Promise.resolve({ tenant: 'bph', slug: 'the-imagines', pageId: 'kept' }) });
    await (element as { type: (p: unknown) => Promise<unknown>; props: unknown }).type((element as { props: unknown }).props);
    expect(navigation.redirect).not.toHaveBeenCalled();
  });

  it('no loading.tsx sits above the embed reader (it would turn the 307 into a 200 + meta refresh)', () => {
    const root = path.resolve(__dirname, '../../src/app');
    const segments = ['embed', '[tenant]', 'book', '[slug]', 'page', '[pageId]'];
    const above = segments.map((_, i) => path.join(root, ...segments.slice(0, i + 1), 'loading.tsx'));
    expect(above.filter(existsSync).map(f => path.relative(root, f))).toEqual([]);
    // The catalogue skeleton still covers the library routes.
    expect(existsSync(path.join(root, 'embed', '[tenant]', '(library)', 'loading.tsx'))).toBe(true);
  });
});
