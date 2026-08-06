import { describe, it, expect } from 'vitest';
import { buildSortStage } from '@/lib/book-sort';

// Guards the behaviour, not the shape: each assertion is about which key the
// sort leads with, and every one of them fails if the relevance branch is
// removed or reordered.
describe('buildSortStage — relevance when searching', () => {
  it('leads with the search score when a query was given and no sort chosen', () => {
    const keys = Object.keys(buildSortStage('recent-translation', undefined, true).$sort);
    expect(keys[0]).toBe('search_score');
    expect(buildSortStage('recent-translation', undefined, true).$sort.search_score).toBe(-1);
  });

  // The bug this fixes: relevance was discarded and every searched result set
  // was re-ordered by curation signals, so `search=Aristotle` led with "The
  // Alchemical Seven Stars" by Anonymous.
  it('does not lead with curation signals when a query was given', () => {
    const keys = Object.keys(buildSortStage('recent-translation', undefined, true).$sort);
    expect(keys[0]).not.toBe('is_bph_translated');
    expect(keys).not.toContain('quality_score');
    expect(keys).not.toContain('last_translation_at');
  });

  // Unsearched browsing is the curated shelf and must be untouched.
  it('keeps the curated order when there is no query', () => {
    const keys = Object.keys(buildSortStage('recent-translation', undefined, false).$sort);
    expect(keys[0]).toBe('is_bph_translated');
    expect(keys).not.toContain('search_score');
  });

  // Someone who asked for title-ascending wants title-ascending, query or not.
  it('honours an explicit sort over relevance', () => {
    expect(Object.keys(buildSortStage('title-asc', undefined, true).$sort)[0]).toBe('sort_title');
    expect(Object.keys(buildSortStage('date_desc', undefined, true).$sort)[0]).toBe('year');
    expect(Object.keys(buildSortStage('recent', undefined, true).$sort)[0]).toBe('last_processed');
  });

  // A collection page has its own relevance signal and keeps it.
  it('leaves collection ordering alone', () => {
    const keys = Object.keys(buildSortStage('recent-translation', 'alchemy', true).$sort);
    expect(keys[0]).toBe('_collection_relevance');
    expect(keys).not.toContain('search_score');
  });

  it('tie-breakers cannot outrank relevance', () => {
    const keys = Object.keys(buildSortStage('recent-translation', undefined, true).$sort);
    expect(keys.indexOf('search_score')).toBeLessThan(keys.indexOf('has_translations'));
    expect(keys.indexOf('search_score')).toBeLessThan(keys.indexOf('title'));
  });
});
