/**
 * #8184: book-page components that print `books.published` must route it
 * through `displayPublished`, so "Unknown" never reaches a reader (/zh showed
 * 出版 Unknown in 书目信息). Server-rendered with react-dom/server; there is no
 * DOM in this suite. `BibliographicInfo` is a client component that needs the
 * Next router, so it is covered by its use of the same helper, not here.
 */
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BookBiblioPanel from '@/components/book/BookBiblioPanel';
import AuthorCrossReference from '@/components/book/AuthorCrossReference';
import type { Book } from '@/lib/types/book';

const book = (published: string) =>
  ({ id: 'b1', title: '格致鏡原', author: '陳元龍', language: 'Chinese', published } as unknown as Book);

describe('BookBiblioPanel published row', () => {
  it('omits the 出版 row when published is "Unknown"', () => {
    const html = renderToStaticMarkup(<BookBiblioPanel book={book('Unknown')} pagesCount={0} lang="zh" />);
    expect(html).not.toContain('Unknown');
    expect(html).not.toContain('>出版<');
  });

  it('shows a real date, stripped of QuickStatements noise', () => {
    const html = renderToStaticMarkup(
      <BookBiblioPanel book={book('1735date QS:P571,+1735-00-00T00:00:00Z/9')} pagesCount={0} lang="zh" />,
    );
    expect(html).toContain('>出版<');
    expect(html).toContain('1735');
    expect(html).not.toContain('QS:');
  });
});

describe('AuthorCrossReference book line', () => {
  const render = (published: string) =>
    renderToStaticMarkup(
      <AuthorCrossReference
        author="Robert Fludd"
        context="artwork"
        crossRef={{ books: [{ slug: 'b1', title: 'Utriusque Cosmi', published, language: 'Latin' }] }}
      />,
    );

  it('drops "Unknown" from the date · language line', () => {
    const html = render('Unknown');
    expect(html).not.toContain('Unknown');
    expect(html).toContain('Latin');
  });

  it('keeps a real date', () => {
    expect(render('1617')).toContain('1617 · Latin');
  });
});
