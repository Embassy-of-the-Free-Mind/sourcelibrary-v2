/**
 * When a WORK was written, as a reader browses it: centuries, the year-range
 * filter, and what a work date rests on (#6873).
 *
 * PRIOR ART: src/components/book/BookBiblioPanel.tsx — renders one book's work
 * and edition layers with the same basis wording, per book, with no century
 * maths; src/app/timeline/page.tsx — buckets the numeric EDITION `year` by
 * decade, never the work date; src/lib/format-year.ts — prints a year, used
 * here; src/lib/types/book.ts — the `SourceWorkDate`
 * shape (#6721) this reads and never rewrites.
 *
 * The date read is `source_work_dates_meta.work.year`: one point per book,
 * the midpoint of the window the dating run wrote (#6721). A century is where
 * that point falls, so every work sits in exactly one century; the window
 * (`display`) is shown beside it so a wide estimate reads as one.
 */

import type { SourceWorkDate } from '@/lib/types/book';
import { formatYear } from '@/lib/format-year';

/** The indexed Mongo path the work-date filter and the timeline read. */
export const WORK_YEAR_FIELD = 'source_work_dates_meta.work.year';

/** Query-string names of the work-date range, on /search and the books APIs. */
export const WORK_FROM_PARAM = 'work_from';
export const WORK_TO_PARAM = 'work_to';

/**
 * Century of a year: positive = CE (1–100 is the 1st century), negative = BCE
 * (-100…-1 is the 1st century BCE). A stored year 0 (no such year; a model's
 * "around the turn of the era") counts as the 1st century BCE.
 */
export function centuryOf(year: number): number {
  if (year >= 1) return Math.ceil(year / 100);
  return -Math.max(1, Math.ceil(-year / 100));
}

/** Inclusive year range of a century, in the same numbering as {@link centuryOf}. */
export function centuryRange(century: number): { from: number; to: number } {
  if (century >= 1) return { from: (century - 1) * 100 + 1, to: century * 100 };
  const n = -century;
  return { from: -n * 100, to: n === 1 ? 0 : -(n - 1) * 100 - 1 };
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function roman(n: number): string {
  const table: Array<[number, string]> = [[40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, r] of table) while (n >= v) { out += r; n -= v; }
  return out;
}

/** Labels the filter shows; Spanish centuries are written "siglo III", as Spanish readers write them. */
export type WorkDateLang = 'en' | 'es';

/** "3rd century", "5th century BCE"; es: "siglo III", "siglo V a. C.". */
export function centuryLabel(century: number, lang: WorkDateLang = 'en'): string {
  if (lang === 'es') return century >= 1 ? `siglo ${roman(century)}` : `siglo ${roman(-century)} a. C.`;
  return century >= 1 ? `${ordinal(century)} century` : `${ordinal(-century)} century BCE`;
}

/** "3rd-century", "5th-century-bce": the timeline's URL segment. */
export function centurySlug(century: number): string {
  return centuryLabel(century).toLowerCase().replace(/\s+/g, '-');
}

/** Inverse of {@link centurySlug}; null for anything else. */
export function parseCenturySlug(slug: string): number | null {
  const m = /^(\d{1,2})(?:st|nd|rd|th)-century(-bce)?$/.exec(slug);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > 40) return null;
  const century = m[2] ? -n : n;
  return centurySlug(century) === slug ? century : null;
}

/**
 * A typed work-year bound from the query string. Negative years are BCE.
 * A whole number is taken as given, however far out: a range with no works in
 * it must answer 0, never quietly drop the filter and answer everything
 * (search-filters-and-lanes.md). Anything else is not a bound and is ignored,
 * as `year_from` is.
 */
export function parseWorkYear(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  return /^-?\d{1,6}$/.test(s) ? parseInt(s, 10) : null;
}

/** Mongo predicate for a work-year range, or null when neither bound is set. */
export function workYearMatch(from: number | null, to: number | null): Record<string, unknown> | null {
  if (from === null && to === null) return null;
  return {
    [WORK_YEAR_FIELD]: {
      $type: 'number',
      ...(from !== null ? { $gte: from } : {}),
      ...(to !== null ? { $lte: to } : {}),
    },
  };
}

/**
 * The choices of the "Written in" filter. `value` is what the select holds
 * and goes on the URL as `work_from` / `work_to`.
 */
export interface WorkPeriodOption { value: string; label: string; from: number | null; to: number | null }

const FIRST_CENTURY_BCE_LISTED = -10; // 10th century BCE; earlier ones fold into "before"
const LAST_CENTURY_LISTED = 20;

export function workPeriodOptions(lang: WorkDateLang = 'en'): WorkPeriodOption[] {
  const opts: WorkPeriodOption[] = [];
  const earliest = centuryRange(FIRST_CENTURY_BCE_LISTED);
  const first = centuryLabel(FIRST_CENTURY_BCE_LISTED, lang);
  opts.push({ value: `..${earliest.from - 1}`, label: lang === 'es' ? `Antes del ${first}` : `Before the ${first}`, from: null, to: earliest.from - 1 });
  for (let c = FIRST_CENTURY_BCE_LISTED; c <= LAST_CENTURY_LISTED; c++) {
    if (c === 0) continue;
    const { from, to } = centuryRange(c);
    const label = centuryLabel(c, lang);
    opts.push({ value: `${from}..${to}`, label: label[0].toUpperCase() + label.slice(1), from, to });
  }
  // The question readers ask in words ("before 500 CE"); listed after the centuries.
  opts.push({ value: '..499', label: lang === 'es' ? 'Antes del año 500 d. C.' : 'Before 500 CE', from: null, to: 499 });
  return opts;
}

/** The select value for a URL's range, or '' when the range is not one of the options. */
export function workPeriodValue(from: number | null, to: number | null): string {
  if (from === null && to === null) return '';
  return `${from ?? ''}..${to ?? ''}`;
}

/** Inverse of {@link workPeriodValue}. */
export function parseWorkPeriodValue(value: string): { from: number | null; to: number | null } {
  const m = /^(-?\d+)?\.\.(-?\d+)?$/.exec(value);
  if (!m) return { from: null, to: null };
  return { from: parseWorkYear(m[1] ?? null), to: parseWorkYear(m[2] ?? null) };
}

/** Plain words for a range that is not one of the options (a hand-typed URL). */
export function workPeriodLabel(from: number | null, to: number | null, lang: WorkDateLang = 'en'): string {
  const match = workPeriodOptions(lang).find((o) => o.from === from && o.to === to);
  if (match) return match.label;
  const y = (n: number) => (lang === 'es' ? (n >= 1 ? String(n) : `${Math.max(1, -n)} a. C.`) : formatYear(n));
  if (from !== null && to !== null) return lang === 'es' ? `${y(from)} a ${y(to)}` : `${y(from)} to ${y(to)}`;
  if (to !== null) return lang === 'es' ? `antes de ${y(to + 1)}` : `before ${y(to + 1)}`;
  if (from !== null) return lang === 'es' ? `desde ${y(from)}` : `from ${y(from)}`;
  return '';
}

/** What a work date rests on, for a reader: sourced from a record, or estimated. */
export interface WorkDateBasis {
  sourced: boolean;
  /** "Sourced" / "Estimated" — the short tag. */
  tag: string;
  /** One line on what the date rests on; null when there is nothing to add. */
  note: string | null;
}

export function workDateBasis(
  work: Pick<SourceWorkDate, 'basis' | 'why'> | null | undefined,
  checks?: string[] | null,
): WorkDateBasis {
  switch (work?.basis) {
    case 'wikidata': return { sourced: true, tag: 'Sourced', note: 'From Wikidata' };
    case 'author_lifespan': return { sourced: true, tag: 'Sourced', note: 'From the author’s recorded dates' };
    case 'colophon': return { sourced: true, tag: 'Sourced', note: 'Stated in the colophon' };
    case 'title_page': return { sourced: true, tag: 'Sourced', note: 'Printed on the opening leaves' };
    case 'catalogue': return { sourced: true, tag: 'Sourced', note: 'From the catalogue record' };
    default: {
      // Same rule as the book page: a reason that itself argues for another
      // date (why_disagrees) is not shown beside the date it disputes.
      const why = work?.why && !checks?.includes('why_disagrees') ? work.why : null;
      return { sourced: false, tag: 'Estimated', note: why ? `Why this date: ${why}` : null };
    }
  }
}
