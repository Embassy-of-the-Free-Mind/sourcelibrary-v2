/**
 * The page-counter writers stamp `last_translation_at` when a recount finds more
 * translated pages (2026-10-27: CLI-translated books never reached the Recently
 * Translated surfaces because only the old worker set the field).
 */
import { describe, it, expect } from 'vitest';
import { translationAdvancedSet as mjs } from '../../scripts/lib/page-counts.mjs';
import { translationAdvancedSet as ts } from '../../src/lib/page-counts';

const now = new Date('2026-10-27T12:00:00Z');

describe.each([['mjs', mjs], ['ts', ts]])('translationAdvancedSet (%s)', (_name, fn) => {
  it('stamps when the translated count grows', () => {
    expect(fn({ pages_translated: 10 }, { pages_translated: 12 }, now)).toEqual({ last_translation_at: now });
    expect(fn({ pages_translated: 0 }, { pages_translated: 1 }, now)).toEqual({ last_translation_at: now });
  });
  it('does not stamp a retranslation, a drop, or a book never counted', () => {
    expect(fn({ pages_translated: 12 }, { pages_translated: 12 }, now)).toEqual({});
    expect(fn({ pages_translated: 12 }, { pages_translated: 3 }, now)).toEqual({});
    expect(fn({ pages_translated: null }, { pages_translated: 40 }, now)).toEqual({});
    expect(fn(null, { pages_translated: 40 }, now)).toEqual({});
  });
});
