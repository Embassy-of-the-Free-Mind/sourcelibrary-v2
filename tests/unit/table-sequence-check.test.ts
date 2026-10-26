import { describe, it, expect } from 'vitest';
import {
  findPlanets,
  sequenceFindings,
  repeatedRowFindings,
  orderedColumnCount,
} from '../../scripts/lib/table-sequence-check.mjs';

/**
 * Fixtures are the stored Book of Wonders text (6953b56577f38f6761bd979d), cut to the
 * planet columns, as read from the corpus mirror on 2026-10-26 (#7274). The broken
 * columns were checked against the page images by eye.
 */

// p.140 as stored: Thursday (right) is correct; Friday (left) has 10 of 12 planets wrong.
const P140 = [
  '| نهار يوم الجمعة | الكواكب | الساعات | نهار يوم الخميس | الكواكب | الساعات |',
  '| :--- | :--- | :--- | :--- | :--- | :--- |',
  ...[
    ['الزهرة', 'المشتري'], ['المشتري', 'المريخ'], ['زحل', 'الشمس'], ['الشمس', 'الزهرة'],
    ['عطارد', 'عطارد'], ['القمر', 'القمر'], ['زحل', 'زحل'], ['المشتري', 'المشتري'],
    ['المريخ', 'المريخ'], ['الشمس', 'الشمس'], ['الزهرة', 'الزهرة'], ['عطارد', 'عطارد'],
  ].map(([fri, thu]) => `| تحمد | ${fri} | ساعة | تحمد | ${thu} | ساعة |`),
].join('\n');

// The same table with the Friday column as the page has it.
const P140_FIXED = P140.split('\n').map((line, i) => {
  if (i < 2) return line;
  const fri = ['الزهرة', 'عطارد', 'القمر', 'زحل', 'المشتري', 'المريخ', 'الشمس', 'الزهرة', 'عطارد', 'القمر', 'زحل', 'المشتري'][i - 2];
  const cells = line.split('|');
  cells[2] = ` ${fri} `;
  return cells.join('|');
}).join('\n');

// The English as stored, two days per line.
const P140_EN = [
  'Hours  Planets  Thursday Daytime  Hours  Planets  Friday Daytime',
  'First  Jupiter  Praiseworthy  First  Venus  Praised',
  'Second  Mars  Blameworthy  Second  Jupiter  Praised',
  'Third  The Sun  Blameworthy  Third  Saturn  Blameworthy',
  'Fourth  Venus  Fortunate  Fourth  The Sun  Blamed',
  'Fifth  Mercury  Praised  Fifth  Mercury  Fortunate',
  'Sixth  The Moon  Fortunate  Sixth  The Moon  Praised',
  'Seventh  Saturn  Praiseworthy  Seventh  Saturn  Fortunate',
  'Eighth  Jupiter  Praised  Eighth  Jupiter  Praised',
  'Ninth  Mars  Praised  Ninth  Mars  Blameworthy',
  'Tenth  The Sun  Praised  Tenth  The Sun  Poor',
  'Eleventh  Venus  Highly praised  Eleventh  Venus  Praiseworthy',
  'Twelfth  Mercury  Praiseworthy  Twelfth  Mercury  Praiseworthy',
].join('\n');

describe('findPlanets', () => {
  it('reads Arabic, English, Latin and symbols, and not words that contain a name', () => {
    expect(findPlanets('زحل المشترى العطارد')).toEqual([0, 1, 5]);
    expect(findPlanets('The Sun and Saturni, ♀')).toEqual([3, 0, 4]);
    expect(findPlanets('Sunday Marshal Solitude Moonlight')).toEqual([]);
  });
});

describe('sequenceFindings', () => {
  it('flags the Friday column of p.140 and points at where it leaves the order', () => {
    const [f, ...rest] = sequenceFindings(P140);
    expect(rest).toEqual([]);
    expect(f.step).toBe(1);
    expect(f.breaks[0]).toMatchObject({ after: 'Venus', expected: 'Mercury', found: 'Jupiter' });
    expect(f.breaks).toHaveLength(4);
  });

  it('passes the same table once the column is right', () => {
    expect(sequenceFindings(P140_FIXED)).toEqual([]);
    expect(orderedColumnCount(P140_FIXED)).toBe(2);
  });

  it('splits a two-day English table into its two columns', () => {
    const found = sequenceFindings(P140_EN);
    expect(found).toHaveLength(1);
    expect(found[0].column).toBe(1);
  });

  it('ignores prose that names planets in no order', () => {
    const prose = 'Venus and Mars, then Saturn, the Moon, the Sun, Jupiter, Mercury, Mars, Venus.';
    expect(sequenceFindings(prose.split(', ').join('\n'))).toEqual([]);
  });

  it('accepts a day-ruler list, which steps +3 through the order', () => {
    const days = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Sun'].join('\n');
    expect(sequenceFindings(days)).toEqual([]);
    expect(orderedColumnCount(days)).toBe(1);
  });
});

describe('repeatedRowFindings', () => {
  it('flags a digit row copied from the row above (p.64)', () => {
    const p64 = '٤٧٤٧٤٧٤٧٤٧٤٧٤٧٤\n٤٧٤٧٤٧٤٧٤٧٤٧٤٧٤';
    expect(repeatedRowFindings(p64)).toHaveLength(1);
  });

  it('passes adjacent digit rows that differ', () => {
    expect(repeatedRowFindings('| 8 | 1 | 6 | 3 | 5 | 7 | 4 | 9 | 2 |\n| 3 | 5 | 7 | 4 | 9 | 2 | 8 | 1 | 6 |')).toEqual([]);
  });
});
