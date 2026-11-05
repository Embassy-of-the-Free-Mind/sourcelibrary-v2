import { describe, it, expect } from 'vitest';
import { isResolvableSlug, parseDeadContentLink, searchTermFromSlug } from '@/lib/not-found-recovery';

describe('parseDeadContentLink', () => {
  it('reads a book slug with or without a page suffix or locale', () => {
    const book = { kind: 'book', slug: 'brihat-parashara-hora-shastra-vol-1' };
    expect(parseDeadContentLink('/book/brihat-parashara-hora-shastra-vol-1')).toEqual(book);
    expect(parseDeadContentLink('/book/brihat-parashara-hora-shastra-vol-1/page-number/5')).toEqual(book);
    expect(parseDeadContentLink('/es/book/brihat-parashara-hora-shastra-vol-1')).toEqual(book);
    expect(parseDeadContentLink('/zh/book/brihat-parashara-hora-shastra-vol-1/page/abc')).toEqual(book);
  });

  it('reads the other content kinds, including the singular /collection the model writes', () => {
    expect(parseDeadContentLink('/author/weyer-johann')).toEqual({ kind: 'author', slug: 'weyer-johann' });
    expect(parseDeadContentLink('/artwork/art-kircher-tree-of-life')).toEqual({ kind: 'artwork', slug: 'art-kircher-tree-of-life' });
    expect(parseDeadContentLink('/collection/aldine-press')).toEqual({ kind: 'collection', slug: 'aldine-press' });
    expect(parseDeadContentLink('/collections/aldine-press')).toEqual({ kind: 'collection', slug: 'aldine-press' });
  });

  it('ignores every other page', () => {
    expect(parseDeadContentLink('/about')).toBeNull();
    expect(parseDeadContentLink('/book')).toBeNull();
    expect(parseDeadContentLink('/es')).toBeNull();
    expect(parseDeadContentLink('/books/foo')).toBeNull();
  });
});

describe('searchTermFromSlug', () => {
  it('turns a slug into words', () => {
    expect(searchTermFromSlug('brihat-parashara-hora-shastra-vol-1')).toBe('brihat parashara hora shastra vol');
    expect(searchTermFromSlug('art-kircher-tree-of-life')).toBe('kircher tree of life');
  });

  it('gives nothing for an id or malformed token', () => {
    expect(searchTermFromSlug('69905f4640bc3a0478efbc86')).toBe('');
    expect(searchTermFromSlug('dGhyZWUtYm')).toBe('');
  });
});

describe('isResolvableSlug', () => {
  it('accepts catalogue slugs and refuses anything else', () => {
    expect(isResolvableSlug('tetrabiblos-ptolemy')).toBe(true);
    expect(isResolvableSlug('ab')).toBe(false);
    expect(isResolvableSlug('../etc')).toBe(false);
    expect(isResolvableSlug('Upper-Case')).toBe(false);
    expect(isResolvableSlug('a'.repeat(201))).toBe(false);
  });
});
