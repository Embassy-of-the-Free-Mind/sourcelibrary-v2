import { describe, it, expect } from 'vitest';
import { buildSystemPromptBody, toolCallRecord } from '@/lib/embassy/librarian';

// 16.7% of follow-up answers over 90 days used one round or fewer and cited
// nothing, and Librarian tool queries were not stored at all (#8151).
const prompt = (messageIndex: number, followupSearch: boolean) =>
  buildSystemPromptBody('', messageIndex, '', 'en', true, false, false, followupSearch);
const RULE = 'a follow-up gets its own search';

describe('follow-up search prompt', () => {
  it('leaves the first message of a thread unchanged', () => {
    expect(prompt(1, true)).toBe(prompt(1, false));
  });

  it('tells every later message to search', () => {
    expect(prompt(2, true)).toContain(RULE);
    expect(prompt(7, true)).toContain(RULE);
  });

  it('can be turned off', () => {
    expect(prompt(2, false)).not.toContain(RULE);
  });
});

describe('toolCallRecord', () => {
  it('keeps what the model searched for and how many came back', () => {
    expect(toolCallRecord('search', { query: 'azoth', collection: 'alchemy' }, { query: 'azoth', found: 8 }, { found: 8 }, 1))
      .toEqual({ name: 'search', query: 'azoth', found: 8, round: 1, collection: 'alchemy' });
  });

  it('keeps the question of a tool that takes one', () => {
    expect(toolCallRecord('find_passages', { question: 'who left their body?' }, { query: 'who left their body?', found: 3 }, {}, 2).query)
      .toBe('who left their body?');
  });

  it('falls back to what the tool says it did, and names the book', () => {
    expect(toolCallRecord('get_book_page', { book_id: 'a-slug', page_number: 4 }, { query: 'p.4', found: 1 }, {}, 2))
      .toEqual({ name: 'get_book_page', query: 'p.4', found: 1, round: 2, book: 'a-slug' });
  });

  it('keeps the reason a turn gave for not searching', () => {
    expect(toolCallRecord('no_search_needed', { reason: 'thanks_or_small_talk' }, { found: 0 }, { ok: true }, 1).query).toBe('thanks_or_small_talk');
  });

  it('tells a failed tool from an empty result', () => {
    expect(toolCallRecord('search', { query: 'x' }, { query: 'x', found: 0 }, { error: 'Tool search encountered an error' }, 1).failed).toBe(true);
    expect(toolCallRecord('search', { query: 'x' }, { query: 'x', found: 0 }, { found: 0 }, 1)).not.toHaveProperty('failed');
  });

  it('caps a long query', () => {
    expect(toolCallRecord('search', { query: 'a'.repeat(900) }, { found: 0 }, {}, 1).query).toHaveLength(300);
  });
});
