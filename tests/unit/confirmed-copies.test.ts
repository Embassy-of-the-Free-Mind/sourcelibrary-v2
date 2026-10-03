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

describe('by-eye recheck (#5689)', () => {
  const recheck = (copy: string, keeper: string, v: string) => ({ copy_id: copy, keeper_id: keeper, verdict: v, supersedes: 'spot_check' });
  const rows = [
    verdict('R1', 'K1', { spot_check: { finding: 'consistent with same edition' } }),
    verdict('R2', 'K2', { spot_check: { finding: 'consistent with same edition' } }),
    verdict('R3', 'K3', { status: 'reversed', spot_check: { finding: 'page numbers inconsistent' } }),
    verdict('R4', 'K4', { spot_check: { finding: 'consistent with same edition' } }),
  ];
  const scores = [score('R1', 'K1', 'different'), score('R2', 'K2', 'insufficient'), score('R3', 'K3', 'same_printing'), score('R4', 'K4', 'insufficient')];

  it('a recheck same_printing confirms over a comparator `different`, and keeps the score', () => {
    const c = buildConfirmedCopies(rows, scores, null, [recheck('R1', 'K1', 'same_printing')]);
    expect(c.pairs.find((p: any) => p.copy_id === 'R1')).toEqual(expect.objectContaining({
      confirmed: true, basis: 'by-eye-recheck', comparator_verdict: 'different', recheck_verdict: 'same_printing', comparator_score: 0,
    }));
  });
  it('a recheck different_part rejects an earlier by-eye "consistent"', () => {
    const c = buildConfirmedCopies(rows, scores, null, [recheck('R2', 'K2', 'different_part')]);
    expect(c.pairs.find((p: any) => p.copy_id === 'R2')).toBeUndefined();
    expect(c.rejected.find((p: any) => p.copy_id === 'R2')).toEqual(expect.objectContaining({ reason: 'recheck different_part', comparator_verdict: 'insufficient' }));
  });
  it('different_edition, fragment and cannot_tell all reject', () => {
    for (const v of ['different_edition', 'fragment', 'cannot_tell']) {
      expect(confirmPair(rows[3], scores[3], recheck('R4', 'K4', v))).toEqual(expect.objectContaining({ confirmed: false, reason: `recheck ${v}` }));
    }
  });
  it('a recheck same_printing overrides an earlier reversal', () => {
    expect(confirmPair(rows[2], scores[2], recheck('R3', 'K3', 'same_printing'))).toEqual(expect.objectContaining({ confirmed: true, basis: 'by-eye-recheck' }));
  });
  it('with no recheck row the old rule is unchanged', () => {
    const without = buildConfirmedCopies(rows, scores);
    const withOther = buildConfirmedCopies(rows, scores, null, [recheck('ZZ', 'K9', 'same_printing')]);
    const strip = (xs: any[]) => xs.map(({ copy_id, confirmed, basis, reason }) => ({ copy_id, confirmed, basis, reason }));
    expect(strip(withOther.pairs)).toEqual(strip(without.pairs));
    expect(strip(withOther.rejected)).toEqual(strip(without.rejected));
    expect(without.pairs.map((p: any) => [p.copy_id, p.basis])).toEqual([['R2', 'by-eye'], ['R4', 'by-eye']]);
    expect(without.rejected.map((p: any) => p.copy_id)).toEqual(['R1', 'R3']);
  });
  it('the committed recheck file loads: every unsettled pair now has a recheck basis or a recheck rejection', () => {
    const c = loadConfirmedCopies();
    expect(c.pairs.some((p: any) => p.basis === 'by-eye-recheck')).toBe(true);
    expect(c.pairs.some((p: any) => p.basis === 'by-eye')).toBe(false);
    expect(c.rejected.every((p: any) => String(p.reason).startsWith('recheck '))).toBe(true);
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
