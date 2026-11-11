// PRIOR ART: tests/unit/citation-pages.test.ts pins the pass that re-points a page link after the turn;
// this pins the step before it (#6946): the model cites `[P7]`, the server writes the link while the
// text streams, and the links come out in the shapes findPageLinks and citationTail already read.
import { describe, it, expect } from 'vitest';
import { CiteIds, CiteIdStream } from '@/lib/embassy/cite-ids';
import { findPageLinks } from '@/lib/embassy/citation-pages';

const BASE = 'https://sourcelibrary.org';
function ids() {
  const c = new CiteIds(BASE);
  c.tag({ bookId: 'b1', slug: 'de-vita-ficino', title: 'De vita libri tres', page: 19 }); // P1
  c.tag({ bookId: 'b1', slug: 'de-vita-ficino', title: 'De vita libri tres', page: 20 }); // P2
  c.tag({ bookId: 'b2', slug: 'picatrix', title: 'Picatrix', page: 323 }); // P3
  return c;
}
const run = (c: CiteIds, chunks: string[]) => {
  const s = new CiteIdStream(c);
  return { text: chunks.map(x => s.push(x)).join('') + s.flush(), stats: s.stats };
};

describe('CiteIds', () => {
  it('gives the same page the same ID across tool calls', () => {
    const c = ids();
    expect(c.tag({ bookId: 'b2', slug: 'picatrix', title: 'Picatrix', page: 323 })).toBe('[P3]');
    expect(c.tag({ bookId: 'b2', slug: 'picatrix', title: 'Picatrix', page: 324 })).toBe('[P4]');
  });
});

describe('CiteIdStream', () => {
  it('writes the page link after a title the model already linked', () => {
    const { text, stats } = run(ids(), ['"Music is a spirit" — *[De vita](https://sourcelibrary.org/book/de-vita-ficino)*, [P2].']);
    expect(text).toBe('"Music is a spirit" — *[De vita](https://sourcelibrary.org/book/de-vita-ficino)*, [Page 20](https://sourcelibrary.org/book/de-vita-ficino?page=20).');
    expect(findPageLinks(text).map(l => [l.slug, l.page])).toEqual([['de-vita-ficino', 20]]);
    expect(stats).toEqual({ rendered: 1, dropped: 0 });
  });

  it('names the book when the paragraph has not', () => {
    const { text } = run(ids(), ['Saturn rules melancholy [P3].']);
    expect(text).toBe('Saturn rules melancholy *[Picatrix](https://sourcelibrary.org/book/picatrix)*, [Page 323](https://sourcelibrary.org/book/picatrix?page=323).');
  });

  it('survives a token split across chunks', () => {
    const { text } = run(ids(), ['It says so — *[De vita](https://sourcelibrary.org/book/de-vita-ficino)*, [', 'P', '1', '] and more.']);
    expect(findPageLinks(text).map(l => l.page)).toEqual([19]);
    expect(text.endsWith(' and more.')).toBe(true);
  });

  it('renders several IDs, the book named once', () => {
    const { text } = run(ids(), ['Both pages [P1][P2] and [P1, P3].']);
    const links = findPageLinks(text);
    expect(links.map(l => `${l.slug}:${l.page}`)).toEqual(['de-vita-ficino:19', 'de-vita-ficino:20', 'de-vita-ficino:19', 'picatrix:323']);
    expect(text.match(/\*\[De vita libri tres\]/g)).toHaveLength(1);
  });

  it('drops an ID no tool gave, keeping the claim as plain text', () => {
    const { text, stats } = run(ids(), ['A claim [P99]. Another [P9] here.\n\n[P42]\n\nNext.']);
    expect(text).toBe('A claim. Another here.\n\n\n\nNext.');
    expect(stats).toEqual({ rendered: 0, dropped: 3 });
  });

  it('replaces a URL the model hung on an ID with the real one', () => {
    const { text } = run(ids(), ['See [P3](https://sourcelibrary.org/book/picatrix?page=999).']);
    expect(findPageLinks(text).map(l => l.page)).toEqual([323]);
  });

  it('leaves ordinary links and brackets alone', () => {
    const src = 'See [Page 5](https://sourcelibrary.org/book/x?page=5) and [Pp. 3–4] or [note].';
    expect(run(ids(), [src.slice(0, 7), src.slice(7)]).text).toBe(src);
  });

  it('uses the locale prefix and word', () => {
    const c = new CiteIds('https://sourcelibrary.org/es', 'Página');
    c.tag({ bookId: 'b2', slug: 'picatrix', title: 'Picatrix', page: 3 });
    expect(run(c, ['Dice [P1].']).text).toBe('Dice *[Picatrix](https://sourcelibrary.org/es/book/picatrix)*, [Página 3](https://sourcelibrary.org/es/book/picatrix?page=3).');
  });
});

describe('CiteIdStream separators', () => {
  it('joins adjacent IDs: a comma within a book, a semicolon between books', () => {
    const { text } = run(ids(), ['Claim [P1][P2][P3].']);
    expect(text).toBe('Claim *[De vita libri tres](https://sourcelibrary.org/book/de-vita-ficino)*, [Page 19](https://sourcelibrary.org/book/de-vita-ficino?page=19), [Page 20](https://sourcelibrary.org/book/de-vita-ficino?page=20); *[Picatrix](https://sourcelibrary.org/book/picatrix)*, [Page 323](https://sourcelibrary.org/book/picatrix?page=323).');
  });

  it('names the book again after a link to another page', () => {
    const { text } = run(ids(), ['*[De vita](https://sourcelibrary.org/book/de-vita-ficino)* says one thing [P3], and another [P1].']);
    expect(text).toContain('another *[De vita libri tres](https://sourcelibrary.org/book/de-vita-ficino)*, [Page 19]');
  });
});
