/* eslint-disable @typescript-eslint/no-explicit-any -- the plain-JS modules under test are untyped */
/**
 * #4291: the printed page a reader holds, fitted per book (fitPrintedPages) and the backfill's
 * write plan. The Fludd fixture copies the first lines of real pages of 6952dac977f38f6761bc6cb0
 * (OCR before the <page-num> tag, running head on line one): scan 219 is printed 217.
 * Negative controls: a misread is never labelled, a short run is never labelled, section numbers
 * are not a pagination, and a tagged page's first line is never read as a head.
 */
import { describe, it, expect } from 'vitest';
import {
  fitPrintedPages, runningHeadNumber,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/lib/page-integrity.mjs';
import {
  planBook, FITTER,
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore — plain-JS module, no declarations
} from '../../scripts/maintenance/backfill-printed-page-4291.mjs';

const page = (p: number, num: string | null, type = 'text') =>
  ({ p, type, ocr: `${num == null ? '' : `<page-num>${num}</page-num>\n`}Lorem ipsum dolor sit amet page ${p}.` });
const run = (from: number, nums: (string | null)[]) => nums.map((n, i) => page(from + i, n));
const labels = (pages: any[], opts?: any) => Object.fromEntries([...fitPrintedPages(pages, opts).labels].map(([p, l]: any) => [p, l.label]));

describe('runningHeadNumber', () => {
  it('reads the number first or last on the head line (Fludd)', () => {
    expect(runningHeadNumber('DE TRIPL. ANIM. IN CORP. VISION. 217\n\n[Top Diagram]')).toBe('217');
    expect(runningHeadNumber('210 TRACT. I. SECT. I. LIB. X.\nvera hominum')).toBe('210');
    expect(runningHeadNumber('218 &nbsp;&nbsp;&nbsp;TRACT. I.\nbody')).toBe('218');
    expect(runningHeadNumber('\n    214 TRACT. I. SECT. I. LIB. X.\nmnes')).toBe('214');
  });
  it('does not read roman numerals or tagged OCR', () => {
    expect(runningHeadNumber('TRACT. I. SECT. I. LIB. X.\nbody')).toBeNull();
    expect(runningHeadNumber('<language>Latin</language>\n12 something')).toBeNull();
    expect(runningHeadNumber('')).toBeNull();
  });
});

describe('fitPrintedPages (#4291)', () => {
  it('Fludd: running heads two ahead of the scan give scan 219 = printed 217', () => {
    const heads: Record<number, string> = {
      214: '212\tT R A C T. I. S E C T. I. L I B. X.', 215: 'DE TRIPL. ANIM. IN CORP. VISION. 213',
      216: '\n    214 TRACT. I. SECT. I. LIB. X.', 217: 'DE TRIPL. ANIM. IN CORP. VISION. 215',
      218: '216          T R A C T. I. S E C T. I. L I B. X.', 219: 'DE TRIPL. ANIM. IN CORP. VISION. 217',
      220: '218 &nbsp;&nbsp;&nbsp;&nbsp;', 221: 'DE TRIPL. ANIM. IN CORP. VISION. 219',
      222: ' acquisitæ corpori suo, per omne',
      223: 'DE TRIPL. ANIM. IN CORP. VISION. 221',
    };
    const pages = Object.entries(heads).map(([p, h]) => ({ p: Number(p), type: undefined, ocr: `${h}\nbody text` }));
    const f = fitPrintedPages(pages, { head: true });
    expect(f.labels.get(219)).toMatchObject({ label: '217', numbering: 'arabic', rate: 1, method: 'read', source: 'head' });
    expect(f.labels.get(222)).toMatchObject({ label: '220', method: 'interpolated' });
    // without head reading, untagged OCR gives nothing
    expect(fitPrintedPages(pages).labels.size).toBe(0);
  });

  it('labels a clean run and interpolates an unnumbered chapter opening inside it', () => {
    expect(labels(run(5, ['3', '4', null, '6', '7', '8']))).toEqual({ 5: '3', 6: '4', 7: '5', 8: '6', 9: '7', 10: '8' });
  });

  it('never labels a misread, and never extrapolates past a run', () => {
    const l = labels([page(1, null), ...run(2, ['10', '11', '12', '13', '41', '15', '16', '17', '18', '19', '20', '21']), page(14, null)]);
    expect(l[6]).toBeUndefined();          // 41 where 14 belongs: skipped, not "corrected"
    expect(l[5]).toBe('13');
    expect(l[1]).toBeUndefined();          // before the first number
    expect(l[13]).toBe('21');
    expect(l[14]).toBeUndefined();         // after the last
  });

  it('keeps both sides of a missing leaf at their own offsets', () => {
    expect(labels(run(1, ['1', '2', '3', '4', '7', '8', '9', '10']))).toMatchObject({ 4: '4', 5: '7', 8: '10' });
  });

  it('does not label a run shorter than three', () => {
    const l = labels(run(1, ['1', '2', '3', '4', '5', '6', '40', '41', '20', '21', '22', '23']));
    expect(l[7]).toBeUndefined();
    expect(l[8]).toBeUndefined();
  });

  it('section numbers are not a pagination', () => {
    expect(fitPrintedPages(run(1, ['10', '10', '10', '11', '11', '12', '12', '12', '13', '13'])).labels.size).toBe(0);
  });

  it('formats romans, leaves and spreads as strings', () => {
    expect(labels(run(1, ['v', 'vi', 'vii', 'viii']))[2]).toBe('vi');
    // rectos numbered only: the verso between two rectos is the leaf's v side
    expect(labels(run(1, ['5', null, '6', null, '7', null, '8']))).toMatchObject({ 1: '5r', 2: '5v', 3: '6r' });
    expect(labels(run(1, ['12v', '13r', '13v', '14r']))[2]).toBe('13r');
  });

  it('ignores a number read off a plate but interpolates the plate inside the pagination', () => {
    const pages = [...run(1, ['1', '2', '3']), page(4, '99', 'illustration'), ...run(5, ['5', '6', '7'])];
    expect(labels(pages)[4]).toBe('4');
  });
});

describe('planBook (backfill write plan)', () => {
  const at = new Date('2026-10-03T00:00:00Z');
  const rows = run(1, ['1', '2', '3', '4']).map((r, i) => ({ ...r, _id: `id${i + 1}`, prior: undefined as any }));
  it('sets absent fields, owned and filtered on write', () => {
    const fit = fitPrintedPages(rows);
    const { ops } = planBook(rows, fit, { run: 'r1', at });
    expect(ops).toHaveLength(4);
    expect(ops[0].updateOne.update.$set.printed_page).toMatchObject({ label: '1', fitter: FITTER, run: 'r1' });
    expect(ops[0].updateOne.filter.$or).toBeDefined();
  });
  it('never touches a value another writer set, and unsets its own stale label', () => {
    const prior = [{ label: '1', fitter: 'human-edit' }, { label: '9', method: 'read', fitter: FITTER }];
    const r2 = rows.map((r, i) => ({ ...r, prior: prior[i] }));
    const fit = fitPrintedPages(r2.slice(0, 4));
    const { ops, foreign } = planBook(r2, fit, { run: 'r2', at });
    expect(foreign).toBe(1);
    expect(ops.map((o: any) => o.updateOne.filter._id)).toEqual(['id2', 'id3', 'id4']);
    const stale = fitPrintedPages([]);
    const un = planBook([{ ...rows[0], prior: { label: '1', fitter: FITTER } }], stale, { run: 'r3', at });
    expect(un.ops[0].updateOne.update).toEqual({ $unset: { printed_page: '' } });
  });
  it('skips duplicate page_number rows', () => {
    const fit = fitPrintedPages(rows);
    const { ops } = planBook(rows.map((r, i) => ({ ...r, dup: i === 0 })), fit, { run: 'r', at });
    expect(ops).toHaveLength(3);
  });
});
