import { describe, it, expect } from 'vitest';
import { threadVisibility, attribution, messageAttribution } from '@/lib/embassy/thread-visibility';

/**
 * The listing rule, on its own. The asymmetry between a signed-in and an
 * anonymous opt-out is the part worth pinning: 'private' for an anonymous
 * thread would lock its own author out, because a null creatorId can never
 * match a session id, so the detail route would 404 the person who wrote it.
 */
describe('threadVisibility', () => {
  it('lists by default for a signed-in reader', () => {
    expect(threadVisibility('user-1', true)).toBe('public');
  });

  it('lists by default for an anonymous visitor', () => {
    expect(threadVisibility(null, true)).toBe('public');
  });

  it('makes a signed-in opt-out fully private', () => {
    expect(threadVisibility('user-1', false)).toBe('private');
  });

  it('leaves an anonymous opt-out reachable by id, not private', () => {
    // 'private' would strand the anonymous author outside their own thread.
    expect(threadVisibility(null, false)).toBe('unlisted');
  });
});

describe('attribution', () => {
  it('gives a stranger no name to work with', () => {
    expect(attribution('Rocio Bernardiner', false)).toBe('A reader');
  });

  it('is anonymous even when the stored name is empty', () => {
    expect(attribution(null, false)).toBe('A reader');
    expect(attribution('', false)).toBe('A reader');
  });

  it('gives the author their own name back', () => {
    expect(attribution('Rocio Bernardiner', true)).toBe('Rocio Bernardiner');
  });

  it('falls back to "You" for an author with no stored name', () => {
    expect(attribution(null, true)).toBe('You');
  });
});

describe('messageAttribution', () => {
  it('anonymises a human author for a stranger', () => {
    expect(messageAttribution({ authorType: 'human', authorName: 'Rocio Bernardiner' }, false))
      .toBe('A reader');
  });

  it('leaves the Librarian named — it is not a person', () => {
    expect(messageAttribution({ authorType: 'ai', authorName: 'The Librarian' }, false))
      .toBe('The Librarian');
  });
});
