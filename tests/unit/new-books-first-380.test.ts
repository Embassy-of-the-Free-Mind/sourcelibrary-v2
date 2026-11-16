// #380 (Derek 2026-11-15 "new books first"): re-reads only of flagged pages; held first-read books get translated.
import { describe, it, expect } from 'vitest';
import { latinFirstSteps, flaggedLive, LATIN_FIRST_QUALITY } from '../../scripts/batch/cli-ocr-lane.mjs';
import { gateSplit, FINISH_FRAMES, FIRST_READ_TRANSLATE_BOOKS } from '../../scripts/batch/cli-translate-lane.mjs';

const base = { home: '/root/.agy-milo', root: '/r', date: '2026-11-15', maxPages: 3000, concurrency: 6, apply: true };

describe('latin-first --quality', () => {
  it('all (the default) is the blanket re-read, unchanged: no step carries --flagged', () => {
    for (const s of latinFirstSteps(base)) expect(s.args).not.toContain('--flagged');
  });
  it('flagged keeps the finish steps whole and puts --flagged on every re-read step', () => {
    const steps = latinFirstSteps({ ...base, quality: 'flagged' });
    expect(steps.map((s) => s.step)).toEqual(latinFirstSteps(base).map((s) => s.step));
    for (const s of steps) {
      if (s.step.startsWith('finish-')) { expect(s.args).not.toContain('--flagged'); expect(s.args).toContain('--finish-first'); }
      else { expect(s.args).toContain('--flagged'); expect(s.args).toContain('--yield-to-finish'); }
    }
  });
  it('refuses an unknown quality', () => {
    expect(LATIN_FIRST_QUALITY).toEqual(['all', 'flagged']);
    expect(() => latinFirstSteps({ ...base, quality: 'some' })).toThrow();
  });
});

describe('flaggedLive', () => {
  const at = Date.parse('2026-11-10T00:00:00Z');
  const flags = new Map([['b1', new Map([[12, at]])]]);
  it('a page a check flagged, OCR older than the check: flagged', () => {
    expect(flaggedLive(flags, 'b1', { page_number: 12, ocr_at: '2026-11-01T00:00:00Z' })).toBe(true);
  });
  it('a page re-OCRed after its check is no longer flagged (read once)', () => {
    expect(flaggedLive(flags, 'b1', { page_number: 12, ocr_at: '2026-11-12T00:00:00Z' })).toBe(false);
  });
  it('takes a Date from Mongo as well as an ISO string', () => {
    expect(flaggedLive(flags, 'b1', { page_number: 12, ocr_at: new Date('2026-11-12T00:00:00Z') })).toBe(false);
    expect(flaggedLive(flags, 'b1', { page_number: 12, ocr_at: new Date('2026-11-01T00:00:00Z') })).toBe(true);
  });
  it('another page or book: not flagged; no OCR time: flagged', () => {
    expect(flaggedLive(flags, 'b1', { page_number: 13, ocr_at: null })).toBe(false);
    expect(flaggedLive(flags, 'b2', { page_number: 12, ocr_at: null })).toBe(false);
    expect(flaggedLive(flags, 'b1', { page_number: 12 })).toBe(true);
  });
});

describe('finish --frame=first-read', () => {
  it('reads the first-read holds and never a containment hold', () => {
    expect(FINISH_FRAMES).toEqual(['finish', 'first-read']);
    const reasons = FIRST_READ_TRANSLATE_BOOKS['pipeline_auto.hold.reason'].$in;
    expect(reasons).toContain('scans-only-publish-7270');
    expect(reasons).toContain('acquisition-wave-2026-10-images-only');
    for (const r of reasons) expect(r).not.toMatch(/wrong-leaf|invent|recit|contain/);
    expect(FIRST_READ_TRANSLATE_BOOKS['pipeline_auto.held']).toEqual({ $ne: true });
  });
  it('with releaseHours Infinity an unchecked Flash-Lite page is never translated, however long it waits', () => {
    const take = [{ id: 'a' }, { id: 'b' }];
    const s = gateSplit(take, new Set(['b']), Date.now() - 365 * 86400e3, { releaseHours: Infinity });
    expect(s.now).toEqual(['a']); expect(s.released).toEqual([]); expect(s.wait).toEqual(['b']);
  });
});
