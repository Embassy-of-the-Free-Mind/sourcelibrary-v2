import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { BOOK_VIEW_PAGE_SIZE, bookViewHref, bookViewPageLinks, parseBookViewPage } from '@/lib/gallery-book-view';

/**
 * A crawler reaches a book's pictures through /gallery?bookId=…. The failures this
 * guards: the view calling itself a duplicate of /gallery, later pages rendering page 1,
 * and a stray `page` value becoming a cache key or a huge skip.
 */
describe('parseBookViewPage', () => {
  it('reads a page number', () => {
    expect(parseBookViewPage('2')).toBe(2);
    expect(parseBookViewPage('14')).toBe(14);
  });

  it('treats anything else as page 1', () => {
    for (const bad of [undefined, null, '', '0', '-1', '1.5', 'abc', '2e3', '999999', ['2']]) {
      expect(parseBookViewPage(bad)).toBe(1);
    }
  });
});

describe('bookViewHref', () => {
  it('leaves page 1 bare, so one page has one address', () => {
    expect(bookViewHref('b1', 1)).toBe('/gallery?bookId=b1');
    expect(bookViewHref('b1', 3)).toBe('/gallery?bookId=b1&page=3');
  });

  it('encodes the id', () => {
    expect(bookViewHref('a b&c', 1)).toBe('/gallery?bookId=a%20b%26c');
  });
});

describe('bookViewPageLinks', () => {
  it('links nothing for a book that fits on one page', () => {
    expect(bookViewPageLinks(0, 1)).toEqual([]);
    expect(bookViewPageLinks(BOOK_VIEW_PAGE_SIZE, 1)).toEqual([]);
  });

  it('reaches every picture of a book of 661', () => {
    const links = bookViewPageLinks(661, 1);
    expect(links).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(links[links.length - 1] * BOOK_VIEW_PAGE_SIZE).toBeGreaterThanOrEqual(661);
  });

  it('caps the list around the current page, so a very large book can still be walked', () => {
    const links = bookViewPageLinks(50_000, 300);
    expect(links).toHaveLength(100);
    expect(links).toContain(300);
    expect(links).toContain(301);
    const last = bookViewPageLinks(50_000, 500);
    expect(last[last.length - 1]).toBe(500);
  });
});

describe('the gallery page', () => {
  const src = readFileSync(join(process.cwd(), 'src/app/gallery/page.tsx'), 'utf8');
  const client = readFileSync(join(process.cwd(), 'src/components/gallery/GalleryClient.tsx'), 'utf8');

  it('agrees with the client on what a page is', () => {
    expect(client).toContain('const limit = BOOK_VIEW_PAGE_SIZE;');
  });

  it('keeps the server pictures of a book view instead of refetching over them', () => {
    expect(client).toContain("const matchesServer = bookId ? true :");
  });

  it('keeps the page number in the cache key, or page 2 would serve page 1', () => {
    expect(src).toMatch(/'gallery-initial-v3', tenantId \|\| 'main', bookId \|\| 'all', String\(page\)/);
  });

  it('gives the book view its own canonical and keeps /gallery for everything else', () => {
    expect(src).toContain('canonical: bookViewHref(bookId, page)');
    expect(src).toContain("canonical: '/gallery'");
  });
});
