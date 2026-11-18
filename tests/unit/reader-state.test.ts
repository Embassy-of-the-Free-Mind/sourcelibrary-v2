import { describe, it, expect } from 'vitest';
// @ts-expect-error untyped .mjs
import { readerState, READER_STATES } from '../../scripts/lib/reader-state.mjs';

const book = (rung: string | null, extra: Record<string, unknown> = {}) => ({
  id: 'b', translation_state: rung ? { rung, ...(extra.ts as object) } : undefined,
  summary: 'A summary.', chapters: [{ title: 'I' }], ...extra,
});

describe('readerState (v3#461)', () => {
  it('orders the states from nothing to complete', () => {
    expect(READER_STATES).toEqual(['no_pages', 'scans', 'original', 'readable', 'complete']);
  });
  it('maps the page ladder below readable', () => {
    expect(readerState(book(null)).state).toBe('no_pages');
    expect(readerState(book('no_pages')).state).toBe('no_pages');
    expect(readerState(book('no_text')).state).toBe('scans');
    for (const r of ['transcribing', 'transcribed', 'translating']) expect(readerState(book(r)).state).toBe('original');
  });
  it('complete needs every page, a summary, chapters and no fix verdict', () => {
    expect(readerState(book('complete'))).toEqual({ state: 'complete', held: false, missing: [] });
    expect(readerState(book('readable')).missing).toEqual(['pages']);
    expect(readerState(book('complete', { summary: '' })).missing).toEqual(['summary']);
    expect(readerState(book('complete', { chapters: [] })).missing).toEqual(['chapters']);
    expect(readerState(book('complete'), { verdict: 'fix' }).missing).toEqual(['check']);
    expect(readerState(book('complete'), { verdict: 'caveat' }).state).toBe('complete');
  });
  it('an English original is readable once transcribed, complete with summary and chapters', () => {
    expect(readerState(book('transcribed', { ts: { english_original: true } })).state).toBe('complete');
    expect(readerState(book('transcribing', { ts: { english_original: true } })).state).toBe('original');
  });
  it('a hold does not change the state', () => {
    const r = readerState(book('complete', { pipeline_auto: { status: 'held' } }));
    expect(r).toEqual({ state: 'complete', held: true, missing: [] });
  });
});
