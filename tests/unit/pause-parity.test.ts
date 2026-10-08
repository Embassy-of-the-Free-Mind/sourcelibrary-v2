import { describe, it, expect } from 'vitest';
import * as ts from '@/lib/pause';
// @ts-expect-error — plain .mjs helper, no types
import * as mjs from '../../scripts/lib/pause.mjs';

/**
 * The workers read `paused_phases` through scripts/lib/pause.mjs; emergency-stop validates
 * what it writes through src/lib/pause.ts. If the two drift, the route can accept a key no
 * worker reads — the exact failure #5492 closed. Change both or neither.
 */
const PROBES: unknown[] = [
  ...mjs.PAUSE_KEYS, ...Object.keys(mjs.PAUSE_ALIASES), ...mjs.PHASE_ONLY_ENTRIES,
  1.5, 2, 4, 5, 6, 7, 8, '1.97', '9',
  'image', 'OCR', 'all', '', 10, 2.5, null, undefined, {}, true,
];

describe('pause vocabulary parity (mjs ↔ ts)', () => {
  it('declares the same keys, aliases and phase-only entries', () => {
    expect([...ts.PAUSE_KEYS]).toEqual([...mjs.PAUSE_KEYS]);
    expect({ ...ts.PAUSE_ALIASES }).toEqual({ ...mjs.PAUSE_ALIASES });
    expect([...ts.PHASE_ONLY_ENTRIES]).toEqual([...mjs.PHASE_ONLY_ENTRIES]);
  });

  it.each(PROBES.map((p) => [p]))('classifies %j the same way', (p) => {
    expect(ts.classifyPauseEntry(p)).toEqual(mjs.classifyPauseEntry(p));
  });

  it('validates and resolves lists the same way', () => {
    const lists: unknown[] = [['ocr'], ['translation', 8], ['image', 'ocr'], [1.97, 'embeddings'], 'ocr', []];
    for (const l of lists) {
      expect(ts.validatePauseKeys(l)).toEqual(mjs.validatePauseKeys(l));
      if (Array.isArray(l)) expect([...ts.pausedKeys({ paused_phases: l })]).toEqual([...mjs.pausedKeys({ paused_phases: l })]);
    }
  });
});
