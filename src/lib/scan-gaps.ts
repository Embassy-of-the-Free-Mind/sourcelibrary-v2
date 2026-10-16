/**
 * PRIOR ART: src/lib/book-warnings.ts tells a reader about a stored quality finding on a page's TEXT (book_checks,
 * #6199); a gap in the scan is not a text finding, has no reviewer or check method, and needs no link to evidence.
 * src/lib/reader-strings.ts holds the sentence. None stores "printed pages N–M are not in this scan".
 *
 * Printed pages missing between two scans (#6675). The leaf-order read (#5059, PR #6674) found 2,271 places where the
 * printed numbers jump and the text breaks across the jump. Each becomes one `scan_gaps` row (a row, not a field on
 * `books` or `pages`: .claude/docs/invariants/field-sprawl.md), written by scripts/maintenance/write-scan-gaps-6675.mjs.
 * The reader shows one line on the scan before the gap and on the scan after it: "Pages 41–44 are missing from this
 * scan." Nothing is hidden.
 */
import type { Db } from 'mongodb';

export interface ScanGap {
  /** page_number of the scan before the gap, and of the scan after it. */
  after_page: number;
  before_page: number;
  /** The missing printed page labels, as printed (arabic numerals or lower-case roman). `last` null = one page. */
  first: string;
  last: string | null;
}

/** page_number → the gaps that touch that scan. */
export type ScanGaps = Record<number, ScanGap[]>;

export const NO_SCAN_GAPS: ScanGaps = {};

const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];

export function toRoman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
  return out;
}

/** The label pair for the printed pages strictly between `fromValue` and `toValue`; null when nothing is between. */
export function missingLabels(fromValue: number, toValue: number, numbering: 'arabic' | 'roman'): { first: string; last: string | null } | null {
  const first = fromValue + 1, last = toValue - 1;
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) return null;
  const label = numbering === 'roman' ? toRoman : String;
  return { first: label(first), last: last > first ? label(last) : null };
}

/** One indexed read per book; never throws. Most books have no rows. */
export async function getScanGaps(db: Db, bookId: string): Promise<ScanGaps> {
  try {
    const rows = await db.collection('scan_gaps')
      .find({ book_id: bookId }, { projection: { _id: 0, after_page: 1, before_page: 1, first: 1, last: 1 } })
      .maxTimeMS(3000)
      .toArray();
    if (!rows.length) return NO_SCAN_GAPS;
    const out: ScanGaps = {};
    for (const r of rows as unknown as ScanGap[]) {
      for (const n of [r.after_page, r.before_page]) (out[n] ||= []).push(r);
    }
    return out;
  } catch (err) {
    console.error(`[scan-gaps] could not read scan_gaps for ${bookId}:`, (err as Error).message);
    return NO_SCAN_GAPS;
  }
}
