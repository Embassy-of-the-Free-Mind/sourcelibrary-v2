import { describe, it, expect } from 'vitest';
import { chatRequestSchema } from '@/lib/embassy/chat-request';
import { attribution } from '@/lib/embassy/thread-visibility';

/**
 * The default for a new Librarian thread is LISTED.
 *
 * This file previously pinned the opposite, and was right to at the time. The
 * default had been 'public' while the feed also carried `creatorName` — the
 * reader's real account name — so 515 conversations and 10 readers' full names
 * went public without anyone choosing it, and a reader wrote in asking why her
 * questions carried her name (#3505). Flipping the default to private was the
 * fix, and this test held it there.
 *
 * It also left the Recent feed at zero of 1,240 threads with no way to refill,
 * which is its own kind of broken. The mistake underneath both states was
 * treating one switch as the answer to two questions:
 *
 *     listing the conversation   is not   naming the person who had it
 *
 * Names are now stripped server-side on every surface but the reader's own, so
 * listing no longer implies exposure and the default can safely go back.
 *
 * THE DEFAULT BELOW IS ONLY SAFE WHILE THAT HOLDS. The precondition is
 * asserted here rather than merely cross-referenced, so that breaking the
 * anonymisation fails this test too — a listed-by-default schema and a feed
 * that serves names are individually defensible and catastrophic together.
 * Full coverage of the anonymisation is in librarian-thread-anonymity.test.ts.
 */
describe('Librarian chat request — thread visibility', () => {
  it('defaults to listed when the client sends no visibility', () => {
    const parsed = chatRequestSchema.parse({ message: 'what did Ficino say about the sun?' });
    expect(parsed.visibility).toBe('public');
  });

  it('defaults to listed when visibility is explicitly undefined', () => {
    const parsed = chatRequestSchema.parse({ message: 'hello', visibility: undefined });
    expect(parsed.visibility).toBe('public');
  });

  it('still honours an explicit opt-out', () => {
    const parsed = chatRequestSchema.parse({ message: 'hello', visibility: 'private' });
    expect(parsed.visibility).toBe('private');
  });

  it('rejects any visibility value outside the two-state toggle', () => {
    // 'unlisted' is a server-side outcome of opting out anonymously, never
    // something a client may ask for.
    expect(() => chatRequestSchema.parse({ message: 'hello', visibility: 'unlisted' })).toThrow();
  });

  it('is only safe because a listed thread carries no name', () => {
    expect(attribution('Rocio Bernardiner', false)).toBe('A reader');
  });
});
