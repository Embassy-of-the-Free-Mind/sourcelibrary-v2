/**
 * Behaviour of the publication rules (#5340), pure functions only; the DB
 * writer is exercised against a real Mongo in tests/integration/publication-writer.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  mapLegacyReason, legacyPublication, derivedLegacyFields, checkTransition,
  publicationFilter, initialPublication, PUBLICATION_VIEWS,
} from '@/lib/publication';

describe('derivedLegacyFields — the doc\'s compatibility table', () => {
  it('public sets visible and UNSETS hidden_reason (the opposites corollary, #3334)', () => {
    expect(derivedLegacyFields('public', null)).toEqual({ set: { visible: true, hidden: false }, unset: ['hidden_reason'] });
  });
  it('unpublished unsets visible so the reader gate is unchanged', () => {
    expect(derivedLegacyFields('unpublished', 'unprocessed').unset).toEqual(['visible', 'hidden', 'hidden_reason']);
  });
  it('hidden writes the enum reason, which book-access.ts reads for the duplicate redirect', () => {
    expect(derivedLegacyFields('hidden', 'duplicate').set).toEqual({ visible: false, hidden: true, hidden_reason: 'duplicate' });
  });
  it('takedown prefixes the reason so every rights screen matches it', () => {
    const r = derivedLegacyFields('takedown', 'rights').set.hidden_reason as string;
    expect(r).toBe('takedown:rights');
    expect(/copyright|takedown|dmca|rights/i.test(r)).toBe(true);
    expect(mapLegacyReason(r).state).toBe('takedown');
  });
});

describe('checkTransition — the refusals', () => {
  it('refuses a takedown without an issue', () => {
    expect(() => checkTransition('public', { state: 'takedown', by: 'x' })).toThrow(/issue/);
    expect(() => checkTransition('public', { state: 'takedown', by: 'x', issue: 1 })).not.toThrow();
  });
  it('refuses to leave takedown without the override AND an issue', () => {
    expect(() => checkTransition('takedown', { state: 'public', by: 'x' })).toThrow(/rights-cleared/);
    expect(() => checkTransition('takedown', { state: 'hidden', reason: 'curation', by: 'x' })).toThrow(/rights-cleared/);
    expect(() => checkTransition('takedown', { state: 'public', by: 'x', override: 'rights-cleared' })).toThrow(/rights-cleared/);
    expect(() => checkTransition('takedown', { state: 'public', by: 'x', override: 'rights-cleared', issue: 7 })).not.toThrow();
  });
  it('negative control: the same request from a non-takedown state is allowed', () => {
    expect(() => checkTransition('hidden', { state: 'public', by: 'x' })).not.toThrow();
  });
  it('refuses free text as a reason, a hide without reason, and a missing `by`', () => {
    expect(() => checkTransition('public', { state: 'hidden', reason: 'duplicate of x' as never, by: 'x' })).toThrow(/note/);
    expect(() => checkTransition('public', { state: 'hidden', by: 'x' })).toThrow(/reason/);
    expect(() => checkTransition('public', { state: 'public', by: ' ' })).toThrow(/by/);
  });
});

describe('legacyPublication — the backfill rule', () => {
  it('visible decides the state; hidden alone does not (16,942 absent+hidden books serve by URL)', () => {
    expect(legacyPublication({ visible: true }).state).toBe('public');
    expect(legacyPublication({ hidden: true, hidden_reason: 'launch_curation' })).toMatchObject({ state: 'unpublished', reason: 'launch_curation' });
    expect(legacyPublication({ visible: false, hidden: true, hidden_reason: 'low_resolution' })).toMatchObject({ state: 'hidden', reason: 'quality' });
  });
  it('rights class is takedown only when already withdrawn; otherwise a reported conflict', () => {
    expect(legacyPublication({ visible: false, hidden_reason: 'kloss_manuscripts_removed_2026-07-08' }).state).toBe('takedown');
    expect(legacyPublication({ hidden: true, hidden_reason: 'copyright-review: x' }))
      .toMatchObject({ state: 'unpublished', conflict: 'unpublished_with_rights_reason' });
  });
  it('flags a public book still carrying a hidden_reason (audit rule R2)', () => {
    expect(legacyPublication({ visible: true, hidden_reason: 'unprocessed' }).conflict).toBe('public_with_hidden_reason');
  });
  it('an existing publication field wins over the legacy fields', () => {
    expect(legacyPublication({ visible: false, publication: { state: 'public' } }).state).toBe('public');
  });
});

describe('mapLegacyReason', () => {
  it('keeps the original text in note unless it is the enum value itself', () => {
    expect(mapLegacyReason('duplicate of foo')).toEqual({ state: null, reason: 'duplicate', note: 'duplicate of foo', mapped: true });
    expect(mapLegacyReason('duplicate')).toEqual({ state: null, reason: 'duplicate', note: null, mapped: true });
  });
  it('an unmapped string falls to curation and says so', () => {
    expect(mapLegacyReason('something new')).toEqual({ state: null, reason: 'curation', note: 'something new', mapped: false });
  });
});

describe('publicationFilter — legacy expansion until the backfill', () => {
  it('matches the doc table', () => {
    expect(publicationFilter('public')).toEqual({ visible: true });
    expect(publicationFilter('live')).toEqual({ visible: true, pages_count: { $gt: 0 } });
    expect(publicationFilter('reachable')).toEqual({ visible: { $ne: false } });
    expect(publicationFilter('not_public')).toEqual({ visible: { $ne: true } });
    expect(publicationFilter('withdrawn')).toEqual({ visible: false });
  });
  it('every view has an expansion; an unknown view throws', () => {
    for (const v of PUBLICATION_VIEWS) expect(() => publicationFilter(v)).not.toThrow();
    expect(() => publicationFilter('visible' as never)).toThrow(/unknown view/);
  });
});

describe('initialPublication', () => {
  it('defaults to unpublished and leaves visible absent, like today\'s importers', () => {
    const f = initialPublication({ by: 'route:/api/import/ia' });
    expect(f).not.toHaveProperty('visible');
    expect((f.publication as { state: string }).state).toBe('unpublished');
  });
  it('a hidden import carries the derived legacy fields', () => {
    const f = initialPublication({ state: 'hidden', reason: 'unprocessed', by: 'x' });
    expect(f).toMatchObject({ visible: false, hidden: true, hidden_reason: 'unprocessed' });
  });
});
