import { describe, it, expect } from 'vitest';
import { applyLinkRemovals, findCitedAuthorSlugs, findCitedCollectionSlugs } from '@/lib/embassy/citation-fixes';
import { reorderedSlugs } from '@/lib/author-thesaurus';

describe('applyLinkRemovals', () => {
  it('keeps the words and drops the link', () => {
    const text = 'As [Lynn Thorndike](https://sourcelibrary.org/author/thorndike-lynn) notes.';
    expect(applyLinkRemovals(text, ['/author/thorndike-lynn'])).toBe('As Lynn Thorndike notes.');
  });

  it('keeps emphasis around the link', () => {
    const text = '*[Aldine Press](https://sourcelibrary.org/collection/aldine-press)*';
    expect(applyLinkRemovals(text, ['/collection/aldine-press'])).toBe('*Aldine Press*');
  });

  it('does not touch a longer slug that starts the same way', () => {
    const text = '[Longer](https://sourcelibrary.org/author/weyer-johann-2)';
    expect(applyLinkRemovals(text, ['/author/weyer-johann'])).toBe(text);
  });

  it('takes a file extension or query on the URL with the link', () => {
    const text = '[Plate](https://sourcelibrary.org/artwork/art-kircher.jpg) and [Set](https://sourcelibrary.org/collections/yoga?x=1)';
    expect(applyLinkRemovals(text, ['/artwork/art-kircher', '/collections/yoga'])).toBe('Plate and Set');
  });

  it('matches the /es form of a plain path, and an /es path only under /es', () => {
    const es = '[Yoga](https://sourcelibrary.org/es/collections/yoga)';
    const en = '[Yoga](https://sourcelibrary.org/collections/yoga)';
    expect(applyLinkRemovals(es, ['/collections/yoga'])).toBe('Yoga');
    expect(applyLinkRemovals(es, ['/es/collections/yoga'])).toBe('Yoga');
    expect(applyLinkRemovals(en, ['/es/collections/yoga'])).toBe(en);
  });

  it('leaves a bare URL, another host, and book links alone', () => {
    const text = 'https://sourcelibrary.org/author/x and [a](https://images.sourcelibrary.org/author/x) and [b](https://sourcelibrary.org/book/x)';
    expect(applyLinkRemovals(text, ['/author/x'])).toBe(text);
  });
});

describe('findCitedAuthorSlugs', () => {
  it('splits by locale, because /author has no /es twin', () => {
    const text = 'https://sourcelibrary.org/author/a and https://sourcelibrary.org/es/author/b';
    expect(findCitedAuthorSlugs(text)).toEqual({ english: ['a'], spanish: ['b'] });
  });

  it('does not read the image host as a link to an author page', () => {
    expect(findCitedAuthorSlugs('https://images.sourcelibrary.org/author/a.jpg').english).toEqual([]);
  });
});

describe('findCitedCollectionSlugs', () => {
  it('still reports the singular form separately, for its own dead path', () => {
    const { singular, plural } = findCitedCollectionSlugs('https://sourcelibrary.org/collection/yoga');
    expect(singular).toEqual(['yoga']);
    expect(plural).toEqual([]);
  });
});

describe('reorderedSlugs', () => {
  it('rotates the words without returning the slug itself', () => {
    expect(reorderedSlugs('thorndike-lynn')).toEqual(['lynn-thorndike']);
    expect(reorderedSlugs('rosenroth-christian-knorr-von')).toEqual([
      'christian-knorr-von-rosenroth',
      'knorr-von-rosenroth-christian',
      'von-rosenroth-christian-knorr',
    ]);
  });

  it('refuses a single word, which could be anyone, and very long slugs', () => {
    expect(reorderedSlugs('ficino')).toEqual([]);
    expect(reorderedSlugs('a-b-c-d-e-f-g')).toEqual([]);
  });
});
