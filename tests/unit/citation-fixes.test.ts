import { describe, it, expect } from 'vitest';
import { applyCitationFixes } from '@/lib/embassy/citation-fixes';

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
