import { describe, it, expect } from 'vitest';
import { chatRequestSchema } from '@/lib/embassy/chat-request';

/**
 * A Librarian thread is published in the public "Recent" feed under the
 * reader's real account name (`creatorName`, surfaced by GET /api/embassy/threads).
 * Publishing therefore has to be a choice the reader makes, never a default they
 * failed to opt out of.
 *
 * The old default was 'public'. It put 515 conversations — 10 readers' full
 * first-and-last names — into that feed, and a reader wrote in to ask why her
 * questions carried her name.
 *
 * These exercise the schema rather than grepping the source: flipping the
 * default back to 'public', or dropping `.default()` so the destructure falls
 * through to undefined, fails here.
 */
describe('Librarian chat request — thread visibility', () => {
  it('defaults to private when the client sends no visibility', () => {
    const parsed = chatRequestSchema.parse({ message: 'what did Ficino say about the sun?' });
    expect(parsed.visibility).toBe('private');
  });

  it('defaults to private when visibility is explicitly undefined', () => {
    const parsed = chatRequestSchema.parse({ message: 'hello', visibility: undefined });
    expect(parsed.visibility).toBe('private');
  });

  it('still honours an explicit opt-in to public', () => {
    const parsed = chatRequestSchema.parse({ message: 'hello', visibility: 'public' });
    expect(parsed.visibility).toBe('public');
  });

  it('rejects any visibility value outside the two-state toggle', () => {
    expect(() => chatRequestSchema.parse({ message: 'hello', visibility: 'unlisted' })).toThrow();
  });
});
