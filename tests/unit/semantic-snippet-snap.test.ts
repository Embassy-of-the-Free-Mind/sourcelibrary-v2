import { describe, it, expect, vi } from 'vitest';

// #3083: search_concept snippets were a bare slice(0, 300), which stopped
// inside a word on about two in three pages longer than the window.

vi.mock('@/lib/supabase-admin', () => ({ supabase: {} }));
vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const { snapSnippet, stripContinuityPrefix } = await import('@/lib/semantic-search');

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('snapSnippet', () => {
  it('returns text within the window untouched', () => {
    expect(snapSnippet('Short page.')).toBe('Short page.');
    expect(snapSnippet('')).toBe('');
  });

  it('never ends inside a word, and is always a verbatim prefix', () => {
    const text = words(120);
    const s = snapSnippet(text);
    expect(text.startsWith(s)).toBe(true);
    expect(s.length).toBeLessThanOrEqual(300);
    expect(s.length).toBeGreaterThanOrEqual(180);
    // The next character in the source is the space that ended the last word.
    expect(text[s.length]).toBe(' ');
    expect(s).not.toMatch(/…$/);
  });

  it('prefers a sentence end in the last 40% of the window', () => {
    const text = `${'a'.repeat(9)} ${words(28)}. The stars incline but do not compel, as ${words(40)}`;
    const end = text.indexOf('.') + 1;
    expect(end).toBeGreaterThan(180);
    expect(end).toBeLessThan(300);
    expect(snapSnippet(text)).toBe(text.slice(0, end));
  });

  it('ignores a sentence end too early to be worth the lost text', () => {
    const text = `Short. ${words(120)}`;
    expect(snapSnippet(text).length).toBeGreaterThan(180);
  });

  it('keeps the plain cut for text with no spaces, without splitting a surrogate pair', () => {
    const cjk = '道可道非常道'.repeat(100);
    expect(snapSnippet(cjk)).toBe(cjk.slice(0, 300));
    const astral = 'x' + '𠀀'.repeat(400); // pair straddles index 300
    const s = snapSnippet(astral);
    expect(s.length).toBe(299);
    expect(astral.startsWith(s)).toBe(true);
    expect(s.isWellFormed()).toBe(true);
  });

  it('leaves a window that already ends between words alone', () => {
    const text = `${'a'.repeat(300)} tail`;
    expect(snapSnippet(text)).toBe('a'.repeat(300));
  });
});

describe('stripContinuityPrefix', () => {
  it('snaps a plain translation and keeps its type', () => {
    const text = words(120);
    const { snippet, type } = stripContinuityPrefix(text);
    expect(type).toBe('translation');
    expect(text[snippet.length]).toBe(' ');
  });

  it('still trims a Continuity preamble at the heading, then snaps', () => {
    const body = words(120);
    const { snippet, type } = stripContinuityPrefix(`Continuity: the author was discussing salt. # ${body}`);
    expect(type).toBe('translation');
    expect(snippet.startsWith('# word0')).toBe(true);
    expect(snippet).not.toMatch(/Continuity/);
    expect(snippet).toMatch(/word\d+$/);
  });

  it('still tags an unstrippable preamble as summary', () => {
    expect(stripContinuityPrefix(`Continuity: ${words(120)}`).type).toBe('summary');
  });
});
