/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS module under test is untyped */
/**
 * #5689: the collection tagger's copy guard. Phase 7.6 of the enrich worker adds each scan
 * to collections on its own merits, so every digitization of one edition used to land on the
 * same grid. The guard skips a collection that already holds the keeper of a CONFIRMED copy
 * pair. Pins: confirmed pair → skip; reversed pair → no skip; gray pair → no skip; a comparator
 * `different` vetoes a by-eye check; the worker actually calls the guard; the committed
 * evidence loads.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — plain-JS module, no declarations
import * as cc from '../../scripts/lib/confirmed-copies.mjs';

const { buildConfirmedCopies, copyGuard, confirmPair, loadConfirmedCopies } = cc as any;

const verdict = (copy: string, keeper: string, extra: Record<string, unknown> = {}) => ({
  row: 'pair', copy_id: copy, keeper_id: keeper, status: 'applied',
  reviewer: { verdict: 'copies' }, spot_check: null, ...extra,
});
const score = (copy: string, keeper: string, v: string) => ({ copy_id: copy, keeper_id: keeper, verdict: v, score: 0 });
const keeperCols = new Map([['K1', ['alchemy', 'medicine']], ['K2', ['alchemy']], ['K3', ['alchemy']], ['K4', ['alchemy']]]);

describe('copy guard', () => {
  const confirmed = buildConfirmedCopies(
    [
      verdict('X1', 'K1'),
      verdict('X2', 'K2', { status: 'reversed', spot_check: { finding: 'different parts' } }),
      verdict('X3', 'K3'),
      verdict('X4', 'K4', { spot_check: { finding: 'consistent with same edition' } }),
    ],
    [score('X1', 'K1', 'same_printing'), score('X2', 'K2', 'same_printing'), score('X3', 'K3', 'gray'), score('X4', 'K4', 'different')],
  );

  it('skips a collection already holding the keeper of a confirmed pair', () => {
    const g = copyGuard('X1', ['alchemy', 'astrology'], confirmed, keeperCols);
    expect(g.keep).toEqual(['astrology']);
    expect(g.skipped).toEqual([expect.objectContaining({ slug: 'alchemy', keeper_id: 'K1', basis: 'comparator' })]);
  });
  it('does not skip for a reversed pair, even with a same_printing score', () => {
    expect(copyGuard('X2', ['alchemy'], confirmed, keeperCols)).toEqual({ keep: ['alchemy'], skipped: [] });
  });
  it('does not skip for a gray pair without a by-eye check', () => {
    expect(copyGuard('X3', ['alchemy'], confirmed, keeperCols)).toEqual({ keep: ['alchemy'], skipped: [] });
  });
  it('a comparator `different` vetoes a by-eye check', () => {
    expect(copyGuard('X4', ['alchemy'], confirmed, keeperCols).skipped).toEqual([]);
  });
  it('a by-eye check confirms when the comparator has no evidence', () => {
    expect(confirmPair(verdict('A', 'B', { spot_check: { finding: 'consistent' } }), score('A', 'B', 'insufficient')))
      .toEqual(expect.objectContaining({ confirmed: true, basis: 'by-eye' }));
  });
  it('a hidden or absent keeper (not in keeperCollections) does not block its copy', () => {
    expect(copyGuard('X1', ['alchemy'], confirmed, new Map()).keep).toEqual(['alchemy']);
  });
});

describe('wiring', () => {
  it('enrich-worker Phase 7.6 filters its assignments through copyGuard and logs skips', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/workers/enrich-worker.mjs'), 'utf8');
    expect(src).toMatch(/copyGuard\(book\.id, ranked\.map/);
    expect(src).toMatch(/recordSweepActions\(db, skipRows\)/);
  });
  it('the committed evidence loads and yields confirmed pairs', () => {
    const c = loadConfirmedCopies();
    expect(c.files.length).toBeGreaterThan(0);
    expect(c.pairs.length).toBeGreaterThan(0);
  });
});
