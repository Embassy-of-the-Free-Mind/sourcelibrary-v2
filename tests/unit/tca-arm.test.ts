/**
 * The translation corpus audit names every served translation model (#5274 wave 2).
 *
 * The incident: draw.mjs's armOf() knew two models, gemini-3.1-flash-lite and gemini-3-flash-preview, and read
 * everything else as `other`, which the draw then EXCLUDED. After routing moved pages to agy Flash-low, Opus-direct
 * and Argon, the monthly audit could not sample those pages at all, and nothing said so.
 *
 * Pinned here: every model value the 2026-10-30 census found on served pages of live books maps to a named arm, never
 * `other`; the family split the self-preference check depends on; and the wave-2 period buckets.
 */
import { describe, it, expect } from 'vitest';
import { armOf, familyOf, MACHINE_ARMS, period4 } from '../../scripts/eval/translation-corpus-audit/arm.mjs';

// Every distinct translation.model in census-summary.json (2026-10-30, 24,810 books, 5.74M pages).
const CENSUS_MODELS: Record<string, string> = {
  'gemini-3-flash-preview': 'flash',
  'gemini-3.1-flash-lite-preview': 'lite',
  'gemini-3.1-flash-lite': 'lite',
  'gemini-3.8-flash-low': 'agy-flash',
  'claude-opus-5-5': 'opus',
  'gemini-2.5-flash': 'gemini-legacy',
  'etcsl-corpus': 'reference',
  'gemini-4-argon-low': 'argon',
  human: 'reference',
  'claude-sonnet-4-6': 'claude-other',
  gemini: 'gemini-legacy',
  'gemini-2.0-flash': 'gemini-legacy',
  manual: 'reference',
  'tla-manual': 'reference',
  'claude-opus-4-8': 'opus',
  'claude-haiku-4-5-20251001': 'claude-other',
};

describe('armOf', () => {
  it('maps every census model to a named arm, never other', () => {
    for (const [model, arm] of Object.entries(CENSUS_MODELS)) expect(armOf(model), model).toBe(arm);
  });
  it('reads a missing model as none', () => {
    expect(armOf(null)).toBe('none');
    expect(armOf('')).toBe('none');
  });
  it('reads an unseen model as other, so the draw log shows it', () => {
    expect(armOf('mistral-large')).toBe('other');
  });
  it('samples machine arms only', () => {
    expect(MACHINE_ARMS).toContain('opus');
    expect(MACHINE_ARMS).toContain('agy-flash');
    expect(MACHINE_ARMS).not.toContain('reference');
    expect(MACHINE_ARMS).not.toContain('none');
  });
});

describe('familyOf', () => {
  it('splits Gemini and Claude arms for the self-preference check', () => {
    for (const a of ['lite', 'flash', 'agy-flash', 'argon', 'gemini-legacy']) expect(familyOf(a)).toBe('gemini');
    for (const a of ['opus', 'claude-other']) expect(familyOf(a)).toBe('claude');
    expect(familyOf('reference')).toBeNull();
  });
});

describe('period4', () => {
  it('buckets edition years', () => {
    expect(period4(1499)).toBe('pre-1500');
    expect(period4(1500)).toBe('1500-1700');
    expect(period4(1700)).toBe('1700-1900');
    expect(period4(1900)).toBe('1900+');
    expect(period4(NaN)).toBe('unknown');
  });
});
