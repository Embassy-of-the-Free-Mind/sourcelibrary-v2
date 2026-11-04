import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Reader pages carry citation_* tags so a reference manager can save one page
 * with its book, author and page (#8161). Each case here is a claim we must not
 * make: a holder as author, a scan index as a printed page, our links in a
 * partner's reading room.
 */
const state = vi.hoisted(() => ({
  ctx: null as null | { id?: string },
  book: {} as Record<string, unknown>,
  page: {} as Record<string, unknown>,
}));

vi.mock('@/lib/tenant-context', () => ({ getTenantContext: async () => state.ctx }));
vi.mock('@/app/book/[id]/page/[pageId]/page-data', () => ({
  getPageData: async () => ({ book: state.book, page: state.page }),
  getTrimmedPageId: async () => null,
}));

import { generateMetadata } from '@/app/book/[id]/page/[pageId]/layout';

const PAGE_ID = '69b4d647853c26e0d1560695';
const tags = async () => {
  const meta = await generateMetadata({
    params: Promise.resolve({ id: 'de-secretis', pageId: PAGE_ID }),
    children: null,
  });
  return (meta.other ?? {}) as Record<string, string>;
};

beforeEach(() => {
  state.ctx = null;
  state.book = {
    id: '69b4d647853c26e0d1560632',
    slug: 'de-secretis',
    title: 'De secretis antimonii liber unus',
    author: 'Suchten, Alexander von',
    published: '1570',
    language: 'Latin',
  };
  state.page = { id: PAGE_ID, page_number: 99, printed_page: { label: '97' } };
});

describe('reader page citation tags', () => {
  it('names the book, author, year, printed page and links', async () => {
    const t = await tags();
    expect(t.citation_title).toBe('De secretis antimonii liber unus');
    expect(t.citation_author).toBe('Suchten, Alexander von');
    expect(t.citation_publication_date).toBe('1570');
    expect(t.citation_language).toBe('Latin');
    expect(t.citation_firstpage).toBe('97');
    expect(t.citation_fulltext_html_url).toBe(`https://sourcelibrary.org/book/de-secretis/page/${PAGE_ID}`);
    expect(t.citation_public_url).toMatch(/^https:\/\/sourcelibrary\.org\/q\//);
  });

  it('never gives a scan index as the printed page', async () => {
    state.page = { id: PAGE_ID, page_number: 99 };
    expect(await tags()).not.toHaveProperty('citation_firstpage');
  });

  it('never gives a year it cannot assert', async () => {
    state.book = { ...state.book, published: '16th century' };
    expect(await tags()).not.toHaveProperty('citation_publication_date');
  });

  it('does not name a holding institution as the author', async () => {
    state.book = { ...state.book, author: 'Thadrak Temple' };
    expect(await tags()).not.toHaveProperty('citation_author');
  });

  it('adds nothing in a partner reading room', async () => {
    state.ctx = { id: 'tenant-1' };
    expect(await tags()).toEqual({});
  });
});
