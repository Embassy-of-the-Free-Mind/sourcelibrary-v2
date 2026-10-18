/**
 * A quota error is read from stderr and agy's JSON envelope, never from a long model reply.
 *
 * 2026-10-12: a Latin page's transcription contained "429", matched `\b429\b`, and was classified as a quota stop.
 * The read runner slept 600 s and retried the same page — 39 times, holding the whole lane B run for 6.5 hours.
 */
import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs helper, no types
import { isQuotaError } from '../../scripts/lib/agy-cli.mjs';

const page = 'Anno Domini MCCCCXXIX, id est 1429, et folio 429 recto: ' + 'Lorem ipsum dolor sit amet. '.repeat(30);

describe('isQuotaError', () => {
  it('a long transcription that mentions 429 or "exhausted your" is not a quota error', () => {
    const j = { response: page, conversation_id: 'c1' };
    expect(isQuotaError({ out: JSON.stringify(j), err: '', j, text: page })).toBe(false);
    const t2 = 'He had exhausted your patience, the abbot wrote. ' + page;
    expect(isQuotaError({ out: JSON.stringify({ response: t2 }), err: '', j: { response: t2 }, text: t2 })).toBe(false);
  });

  it('a token count or duration of 429 in the envelope is not a quota error', () => {
    const j = { conversation_id: 'c2', status: 'SUCCESS', response: page, duration_seconds: 23.429, num_turns: 1, usage: { input_tokens: 429, output_tokens: 195, thinking_tokens: 0, total_tokens: 624 } };
    expect(isQuotaError({ out: JSON.stringify(j), err: '', j, text: page })).toBe(false);
  });

  it('a real quota error is still caught, in stderr, in the envelope, or as a short reply', () => {
    expect(isQuotaError({ out: '', err: 'Error: 429 RESOURCE_EXHAUSTED: Individual quota reached', j: {}, text: '' })).toBe(true);
    const j = { error: { code: 429, message: 'Individual quota reached. Resets in 2h48m' } };
    expect(isQuotaError({ out: JSON.stringify(j), err: '', j, text: '' })).toBe(true);
    const short = 'Individual quota reached. Resets in 38m.';
    expect(isQuotaError({ out: JSON.stringify({ response: short }), err: '', j: { response: short }, text: short })).toBe(true);
    expect(isQuotaError({ out: 'RESOURCE_EXHAUSTED', err: '', j: {}, text: 'RESOURCE_EXHAUSTED' })).toBe(true);
  });
});
