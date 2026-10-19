// The two Dresden Codex astronomical tables, as the library's sources give them.
//
// Venus (Dresden 46-50): Bowditch, Numeration (1910), printed pp. 55-56. Each page carries four
// intervals, 236 + 90 + 250 + 8 = 584 days; one row runs across the five pages (2,920 days) and
// thirteen rows make 37,960 days, counted from 1 Ajaw, the day the whole table returns to.
//
// Eclipses (Dresden 51-58): Förstemann, Commentary (1906), printed pp. 202-204 (reader pp. 161-163).
// His table gives 69 groups with their running totals; he corrected 21 of the 138 numbers, and the
// values here are his corrected ones. Groups of 177 and 178 days are six lunar months, 148 is five.

import { DAY_NAMES } from './maya';

export const VENUS_STATIONS = [
  { days: 236, after: 'morning star last seen' },
  { days: 90, after: 'evening star first seen' },
  { days: 250, after: 'evening star last seen' },
  { days: 8, after: 'morning star first seen' },
] as const;
export const VENUS_ROWS = 13;
export const VENUS_PAGES = [46, 47, 48, 49, 50];

/** Days from the table's base (1 Ajaw) to station i, counting across the rows: i = row * 20 + column. */
export function venusDays(i: number): number {
  const cycle = Math.floor(i / 4);
  const within = VENUS_STATIONS.slice(0, (i % 4) + 1).reduce((a, s) => a + s.days, 0);
  return cycle * 584 + within;
}

/** The 260-day count's day, counted from 1 Ajaw. */
export function fromOneAjaw(days: number): { number: number; name: string } {
  return { number: ((days % 13) + 13) % 13 + 1, name: DAY_NAMES[(((19 + days) % 20) + 20) % 20] };
}

export const VENUS_SYNODIC = 583.92;

// The 69 groups of the eclipse table, in order, with the codex page each stands on.
const PAGES: [number, string][] = [
  [6, '53a'], [13, '54a'], [18, '55a'], [22, '56a'], [26, '57a'], [30, '58a'], [36, '51b'],
  [40, '52b'], [45, '53b'], [50, '54b'], [58, '55b'], [62, '56b'], [67, '57b'], [69, '58b'],
];
const FIVE = new Set([3, 13, 19, 26, 36, 42, 49, 59, 65]); // 148 days (Förstemann, reader p. 163)
const EXTRA = new Set([6, 14, 29, 37, 52, 60]); // 178 days

export const ECLIPSE_GROUPS = Array.from({ length: 69 }, (_, k) => {
  const n = k + 1;
  const days = FIVE.has(n) ? 148 : EXTRA.has(n) ? 178 : 177;
  const page = PAGES.find(([last]) => n <= last)![1];
  return { n, days, months: days === 148 ? 5 : 6, page };
});

// Running totals as Förstemann prints them (reader p. 162), for the test that pins the sequence.
export const FORSTEMANN_TOTALS = [
  177, 354, 502, 679, 856, 1034, 1211, 1388, 1565, 1742, 1919, 2096, 2244, 2422, 2599, 2776, 2953, 3130,
  3278, 3455, 3632, 3809, 3986, 4163, 4340, 4488, 4665, 4842, 5020, 5197, 5374, 5551, 5728, 5905, 6082,
  6230, 6408, 6585, 6762, 6939, 7116, 7264, 7441, 7618, 7795, 7972, 8149, 8326, 8474, 8651, 8828, 9006,
  9183, 9360, 9537, 9714, 9891, 10068, 10216, 10394, 10571, 10748, 10925, 11102, 11250, 11427, 11604,
  11781, 11958,
];

/** Modern values, for comparison only: the synodic month and half the eclipse year. */
export const LUNAR_MONTH = 29.530589;
export const ECLIPSE_HALF_YEAR = 173.31;
