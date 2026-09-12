import { describe, it, expect } from 'vitest';
import { editionTag } from '@/lib/embassy/librarian';

// The passage header the model reads now says which edition it is looking at,
// so the ad-fontes rule in the prompt has something to act on (#4704).
describe('editionTag', () => {
  it('shows year, language and original status', () => {
    expect(editionTag({ year: 1591, language: 'Latin', textRole: 'original' })).toBe(' (1591, Latin, original)');
  });

  it('names a modern translation for what it is', () => {
    expect(editionTag({ year: 1893, language: 'English', textRole: 'modern-translation' })).toBe(' (1893, English, modern translation)');
  });

  it('degrades to whatever is known, and to nothing', () => {
    expect(editionTag({ year: 1928 })).toBe(' (1928)');
    expect(editionTag({ language: 'German' })).toBe(' (German)');
    expect(editionTag({})).toBe('');
  });
});
