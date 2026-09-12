import { describe, it, expect } from 'vitest';
import { applyCitationFixes, findCitedBookLinks } from '@/lib/embassy/citation-fixes';

describe('applyCitationFixes', () => {
  const fix = { fromSlug: 'oedipus-aegyptiacus-kircher', toSlug: 'oedipus-aegyptiacus-volume-i-1652-kircher' };

  it('rewrites a bare book link', () => {
    const text = 'See *[Oedipus](https://sourcelibrary.org/book/oedipus-aegyptiacus-kircher)* for more.';
    expect(applyCitationFixes(text, [fix])).toBe(
      'See *[Oedipus](https://sourcelibrary.org/book/oedipus-aegyptiacus-volume-i-1652-kircher)* for more.',
    );
  });

  it('drops ?page=N, /page-number/N and /page/<id> suffixes — page numbers from the wrong edition must not carry over', () => {
    for (const suffix of ['?page=427', '/page-number/427', '/page/69a5d8114d84314297c08acf']) {
      const text = `[Page 427](https://sourcelibrary.org/book/oedipus-aegyptiacus-kircher${suffix})`;
      expect(applyCitationFixes(text, [fix])).toBe(
        '[Page 427](https://sourcelibrary.org/book/oedipus-aegyptiacus-volume-i-1652-kircher)',
      );
    }
  });

  it('rewrites every occurrence', () => {
    const text = 'A https://sourcelibrary.org/book/oedipus-aegyptiacus-kircher B https://sourcelibrary.org/book/oedipus-aegyptiacus-kircher?page=3 C';
    const out = applyCitationFixes(text, [fix]);
    expect(out).not.toContain('book/oedipus-aegyptiacus-kircher?');
    expect(out.match(/oedipus-aegyptiacus-volume-i-1652-kircher/g)).toHaveLength(2);
  });

  it('does not touch a longer slug that the broken slug prefixes', () => {
    const text = 'https://sourcelibrary.org/book/corpus-hermeticum-with-pneumatica-and-ocellus-lucanus-alexandria';
    const out = applyCitationFixes(text, [{ fromSlug: 'corpus-hermeticum', toSlug: 'poimandres-corpus-hermeticum-ficino' }]);
    expect(out).toBe(text);
  });

  it('ignores no-op and malformed fixes', () => {
    const text = 'https://sourcelibrary.org/book/some-book';
    expect(applyCitationFixes(text, [{ fromSlug: 'some-book', toSlug: 'some-book' }])).toBe(text);
    expect(applyCitationFixes(text, [{ fromSlug: '', toSlug: 'x' }])).toBe(text);
    expect(applyCitationFixes(text, [])).toBe(text);
  });
});

// A Spanish conversation (#4116) cites `/es/book/…` — the same book, verified
// and repaired like the English link, with the locale prefix preserved.
describe('locale-prefixed book links', () => {
  const fix = { fromSlug: 'oedipus-aegyptiacus-kircher', toSlug: 'oedipus-aegyptiacus-volume-i-1652-kircher' };

  it('findCitedBookLinks reads /es/book links', () => {
    const text = '[Página 3](https://sourcelibrary.org/es/book/pimander-ficino?page=3) y https://sourcelibrary.org/book/other';
    expect(findCitedBookLinks(text)).toEqual([{ slug: 'pimander-ficino', page: 3 }, { slug: 'other' }]);
  });

  it('applyCitationFixes keeps the /es prefix on a repaired link', () => {
    const text = '[Página 427](https://sourcelibrary.org/es/book/oedipus-aegyptiacus-kircher?page=427)';
    expect(applyCitationFixes(text, [fix])).toBe(
      '[Página 427](https://sourcelibrary.org/es/book/oedipus-aegyptiacus-volume-i-1652-kircher)',
    );
  });

  it('still ignores the image CDN host', () => {
    expect(findCitedBookLinks('![x](https://images.sourcelibrary.org/es/book/foo.jpg)')).toEqual([]);
  });
});
