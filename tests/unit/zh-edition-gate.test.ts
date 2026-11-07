import { describe, expect, it } from 'vitest';
import { hasLocalizedEdition, localizedEditionFilter } from '@/lib/localized';

describe('the /zh edition gate', () => {
  it('opens a book translated into Chinese instead of redirecting it to English', () => {
    expect(hasLocalizedEdition({ language: 'Latin', pages_translated_zh: 71 }, 'zh')).toBe(true);
  });

  it('still opens a book written in Chinese', () => {
    expect(hasLocalizedEdition({ language: 'Chinese' }, 'zh')).toBe(true);
  });

  it('still sends a Latin book with no Chinese edition to English', () => {
    expect(hasLocalizedEdition({ language: 'Latin' }, 'zh')).toBe(false);
    expect(hasLocalizedEdition({ language: 'Latin', pages_translated_zh: 0 }, 'zh')).toBe(false);
  });

  it('cannot answer when the payload carries neither input', () => {
    expect(hasLocalizedEdition({}, 'zh')).toBeNull();
  });

  it('does not lend the Chinese counter to another language', () => {
    expect(hasLocalizedEdition({ language: 'Latin', pages_translated_zh: 71 }, 'nl')).toBe(false);
  });

  it('keeps the /zh shelves to books written in Chinese', () => {
    const filter = localizedEditionFilter('zh');
    expect(JSON.stringify(filter)).not.toContain('pages_translated_zh');
    expect(filter).toHaveProperty('language');
  });
});
