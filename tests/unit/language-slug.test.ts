import { describe, it, expect } from 'vitest';
import { languageSlug } from '@/lib/language-utils';

describe('languageSlug', () => {
  it('drops punctuation so a slash cannot add a path segment', () => {
    // The sitemap used to emit /languages/greek/latin, a 404.
    expect(languageSlug('Greek/Latin')).toBe('greeklatin');
  });

  it('hyphenates spaces and lowercases', () => {
    expect(languageSlug('Middle High German')).toBe('middle-high-german');
  });
});
