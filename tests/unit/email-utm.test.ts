import { describe, it, expect } from 'vitest';
import { tagEmailLinks, readUtm, campaignSlug } from '@/lib/email-utm';

// Newsletter clicks arrive with no referrer (mail apps strip it), so without
// utm tags a letter's traffic reads as "direct". These pin which links get
// tagged and what the tracker is willing to store.
describe('tagEmailLinks', () => {
  const tag = (href: string) => tagEmailLinks(`<a href="${href}">x</a>`, 'Solve et Coagula 2026-11');

  it('tags our own links, keeping path and fragment', () => {
    expect(tag('https://sourcelibrary.org/book/abc/page/62#top')).toBe(
      '<a href="https://sourcelibrary.org/book/abc/page/62?utm_source=newsletter&amp;utm_medium=email&amp;utm_campaign=solve-et-coagula-2026-11#top">x</a>',
    );
  });

  it('appends to an existing query and normalises a bare host', () => {
    expect(tag('https://sourcelibrary.org/search?q=salt')).toContain('?q=salt&amp;utm_source=newsletter');
    expect(tag('https://www.sourcelibrary.org')).toContain('https://www.sourcelibrary.org/?utm_source=');
  });

  it('leaves other hosts, look-alike hosts, merge tags and already-tagged links alone', () => {
    for (const href of [
      'https://www.youtube.com/watch?v=MBSFA2FmOj0',
      'https://sourcelibrary.org.evil.example/x',
      '{{{RESEND_UNSUBSCRIBE_URL}}}',
      'https://sourcelibrary.org/x?utm_source=instagram',
    ]) {
      expect(tag(href)).toBe(`<a href="${href}">x</a>`);
    }
  });

  it('slugs a campaign name', () => {
    expect(campaignSlug('Ça va? New Podcast!')).toBe('ca-va-new-podcast');
  });
});

describe('readUtm', () => {
  it('keeps the four utm keys with plain values', () => {
    expect(readUtm('?utm_source=newsletter&utm_medium=email&utm_campaign=sec-2026-11&gclid=zzz')).toEqual({
      source: 'newsletter',
      medium: 'email',
      campaign: 'sec-2026-11',
    });
  });

  it('returns null when absent and drops odd values', () => {
    expect(readUtm('')).toBeNull();
    expect(readUtm('?page=4')).toBeNull();
    expect(readUtm('?utm_source=<script>')).toBeNull();
  });
});
