import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

// "Books in this article" looks its books up from the slugs an article links.
// A slug repair renames a book without touching the article: the link keeps
// redirecting, so nothing looks broken, and the card just disappears (#7641).
const BOOK = { id: 'b1', slug: 'records-of-miraculous-retribution', slug_aliases: ['untitled-27'], title: '冥報記' };

vi.mock('@/generated/article-books.json', () => ({ default: { essay: ['untitled-27', 'records-of-miraculous-retribution'] } }));

vi.mock('@/lib/mongodb', () => ({
  getReadDb: vi.fn(async () => ({
    collection: () => ({
      find: (filter: { $or: Array<Record<string, { $in: string[] }>> }) => ({
        toArray: async () =>
          filter.$or.some((clause) => clause.slug_aliases?.$in.includes('untitled-27')) ? [BOOK] : [],
      }),
    }),
  })),
}));

describe('/api/articles/books', () => {
  it('finds a renamed book by its old slug, once, without leaking its aliases', async () => {
    const { GET } = await import('@/app/api/articles/books/route');
    const res = await GET(new NextRequest('https://sourcelibrary.org/api/articles/books?slug=essay'));
    const { books } = await res.json();
    expect(books.map((b: { slug: string }) => b.slug)).toEqual(['records-of-miraculous-retribution']);
    expect(books[0]).not.toHaveProperty('slug_aliases');
  });
});
