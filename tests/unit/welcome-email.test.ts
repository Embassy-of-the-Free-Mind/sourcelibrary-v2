import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/mongodb', () => ({ getReadDb: vi.fn() }));

import { renderWelcomeEmail, LIST_WELCOME_LEAD } from '@/lib/welcome-email';

// The welcome email said "over 2,000 rare books" for months after the library
// passed 70,000, because the count was typed into the HTML. It now comes from
// the homepage stats cache at send time; these pin that it does.
describe('welcome email', () => {
  const stats = { books: 71212, languages: 159, illustrations: 0, readableInEnglish: 22683, firstTranslations: 0 };

  it('prints the live counts, rounded down', () => {
    const html = renderWelcomeEmail(LIST_WELCOME_LEAD, stats);
    expect(html).toContain('71,000+ rare books and manuscripts in 159 languages');
    expect(html).toContain('22,000+ of them can be read in English');
    expect(html).toContain(LIST_WELCOME_LEAD);
  });

  it('carries no typed-in count', () => {
    const html = renderWelcomeEmail(LIST_WELCOME_LEAD, stats);
    expect(html).not.toMatch(/over [\d,]+ rare books/);
  });

  it('falls back to words, not a guessed number, without stats', () => {
    const html = renderWelcomeEmail(LIST_WELCOME_LEAD, null);
    expect(html).toContain('tens of thousands of rare books');
    expect(html).not.toMatch(/\d{1,3},\d{3}/);
  });
});
