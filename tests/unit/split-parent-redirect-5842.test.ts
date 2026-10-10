import { describe, it, expect, vi, beforeEach } from 'vitest';

// #5842: an archived split parent (page_number < 0 + split_into) must 308 to
// its first leaf. The reader's page list drops negative pages, so rendering the
// parent opened the book's FIRST page — every citation made against the photo
// read the wrong text. Shapes below are the real Neyphug Kanjur rows (photo 5
// → p.7 upper leaf, p.9 lower leaf).

const BOOK = { id: 'book-1', slug: 'neyphug', visible: true };
let PAGES: Record<string, unknown>[] = [];

vi.mock('@/lib/mongodb', () => ({
  getReadDb: async () => ({
    collection: () => ({
      findOne: async (q: Record<string, unknown>) =>
        PAGES.find(p => Object.entries(q).every(([k, v]) => p[k] === v)) ?? null,
    }),
  }),
}));
vi.mock('@/lib/book-access', () => ({ isHiddenBook: (b: { visible?: boolean }) => b.visible === false }));
vi.mock('@/lib/tenant-context', () => ({ getTenantContext: async () => null }));
vi.mock('@/lib/tenant-catalog-books', () => ({ findBookForTenant: async () => ({ book: BOOK }) }));

const { getSplitLeafId, isArchivedSplit } = await import('@/app/book/[id]/page/[pageId]/page-data');
const { default: PublicReaderLayout } = await import('@/app/book/[id]/page/[pageId]/(reader)/layout');

async function render(pageId: string, lang?: 'en' | 'es') {
  try {
    const out = await PublicReaderLayout({ children: 'body', params: Promise.resolve({ id: 'neyphug', pageId }), lang });
    return { rendered: out };
  } catch (e) {
    const digest = String((e as { digest?: string }).digest ?? '');
    if (!digest.startsWith('NEXT_REDIRECT')) throw e;
    const [, , url, status] = digest.split(';');
    return { url, status };
  }
}

beforeEach(() => {
  PAGES = [
    { id: 'photo5', book_id: 'book-1', page_number: -5, split_into: ['leaf7', 'leaf9'] },
    { id: 'leaf7', book_id: 'book-1', page_number: 7 },
    { id: 'leaf9', book_id: 'book-1', page_number: 9 },
    { id: 'plain', book_id: 'book-1', page_number: 3 },
  ];
});

describe('archived split parent → first leaf (#5842)', () => {
  it('308s the parent to split_into[0] on the book slug', async () => {
    expect(await render('photo5')).toEqual({ url: '/book/neyphug/page/leaf7', status: '308' });
  });

  it('keeps a localized reader inside its locale', async () => {
    expect(await render('photo5', 'es')).toEqual({ url: '/es/book/neyphug/page/leaf7', status: '308' });
  });

  it('renders an ordinary page untouched', async () => {
    expect(await render('plain')).toEqual({ rendered: 'body' });
  });

  it('follows a re-split leaf to the live page', async () => {
    PAGES[1] = { id: 'leaf7', book_id: 'book-1', page_number: -7, split_into: ['leaf7a'] };
    PAGES.push({ id: 'leaf7a', book_id: 'book-1', page_number: 8 });
    expect(await getSplitLeafId('book-1', 'leaf7')).toBe('leaf7a');
  });

  it('falls back to rendering the parent when the leaf is missing or in another book', async () => {
    PAGES[1] = { id: 'leaf7', book_id: 'other-book', page_number: 7 };
    expect(await getSplitLeafId('book-1', 'leaf7')).toBeNull();
    expect(await render('photo5')).toEqual({ rendered: 'body' });
  });

  it('only treats negative pages with leaves as archived splits', () => {
    expect(isArchivedSplit({ page_number: -5, split_into: ['a'] })).toBe(true);
    expect(isArchivedSplit({ page_number: 5, split_into: ['a'] })).toBe(false);
    expect(isArchivedSplit({ page_number: -5 })).toBe(false);
    expect(isArchivedSplit({ page_number: -5, split_into: [] })).toBe(false);
    expect(isArchivedSplit(null)).toBe(false);
  });
});
