import { describe, it, expect } from 'vitest';
// @ts-expect-error — .mjs module without types
import { cleanKraken, garbleVerdict, fillFilter, inScope, engineBlock, setFields, LANE } from '../../scripts/maintenance/kraken-refused-lane.mjs';
// @ts-expect-error — .mjs module without types
import { missingProvenance } from '../../scripts/lib/write-provenance.mjs';

/**
 * The Kraken lane for Gemini RECITATION refusals (#4686) fills empty pages only. These pin the parts
 * that make it safe: the update filter (never a filled page, never a person's edit), the measured
 * scope (English print 1600–1799), a provenance block the standing checker accepts, and the guards.
 */
const model = { key: 'catmus-print-fondue-large', label: 'CATMuS-Print', author: 'S. Gabay', licence: 'CC-BY-4.0', sha256: 'x'.repeat(64), source: 'htrmopo' };
const run = { id: `${LANE}/2026-10-06T00:00:00/test`, code_version: 'abc1234', host: 'test', started_at: new Date('2026-10-06') };

describe('kraken-refused-lane', () => {
  it('fills only refused, empty pages that no person edited', () => {
    const f = fillFilter('p1');
    expect(f.id).toBe('p1');
    expect(f['ocr.recitation_blocked']).toBe(true);
    expect(f.$or).toEqual([{ 'ocr.data': { $exists: false } }, { 'ocr.data': '' }, { 'ocr.data': null }]);
    expect(f['ocr.edited_by']).toEqual({ $exists: false });
    expect(f['ocr.source']).toEqual({ $ne: 'manual' });
  });

  it('refuses books outside the measured scope', () => {
    expect(inScope({ language: 'English', year: 1669 })).toBe(true);
    expect(inScope({ language: 'English', year: 1756 })).toBe(true);
    expect(inScope({ language: 'English', year: 1880 })).toBe(false);
    expect(inScope({ language: 'Latin', year: 1669 })).toBe(false);
    expect(inScope({ language: 'English', year: null })).toBe(false);
  });

  it('writes a provenance block the standing checker accepts, keeping the refusal history', () => {
    const engine = engineBlock({ model, krakenVersion: '7.1', run, imageUrl: 'https://images.example/p.jpg', priorOcr: { recitation_blocked: true, recitation_count: 3 }, secs: 120, bookLanguage: 'English' });
    const set = setFields('Some text', { engine, language: 'English', now: new Date() });
    expect(set['ocr.source']).toBe('kraken');
    expect(set['ocr.pipeline']).toBe(LANE);
    expect(set['ocr.model']).toBe('kraken/catmus-print-fondue-large');
    expect(engine.ladder).toEqual({ recitation_blocked: true, recitation_count: 3 });
    const sub = { data: set['ocr.data'], content_hash: set['ocr.content_hash'], updated_at: set['ocr.updated_at'], source: 'kraken', engine };
    expect(missingProvenance('ocr', sub).missing).toEqual([]);
    expect(Object.keys(set).some(k => k.startsWith('translation'))).toBe(false);
  });

  it('cleans Kraken output without changing the words', () => {
    expect(cleanKraken('\n  \nThe firſt line  \nſecond\n\n\n')).toBe('The firſt line\nſecond');
  });

  it('passes printed prose and refuses Kraken-style garble', () => {
    const prose = 'Neither had I here mention\'d theſe, but to give this Advertiſement; That ſometimes one of theſe Inſtruments may open a fair Portal for more Volumes of the moſt obliging Philoſophy, than can be abſolv\'d by many hands in ſome Ages.';
    expect(garbleVerdict(prose).refuse).toBe(false);
    const garble = 'at pir ¡aaquamvopadar iaa ſſt rrnm tlk ¡¡ qzx bnd ſmrt pqr ¢ tthh wxv nrrt ſpl grt mmn ¡ kkl bbr rrst nnd ſſk tpl';
    expect(garbleVerdict(garble).refuse).toBe(true);
  });
});
