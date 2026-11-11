/**
 * PRIOR ART: `pages.printed_page` (#4291, src/lib/citation.ts) is the citation's locator, fitted from the OCR's
 * `<page-num>`, which was invented on the very books this concerns (#8041), so it cannot decide what the page box does.
 * src/lib/scan-gaps.ts is the same shape for another fact (one indexed read per book, never throws) and is what this
 * follows. romanToInt in src/lib/dedup.ts and src/lib/volume-set.ts is private and reads titles, not page labels.
 *
 * The page numbers printed on the leaves, where a run of them was confirmed on the images (#8041). One
 * `page_printed_numbers` row per page, keyed by page id so a page-order renumber (#5699) does not disturb it; written by
 * scripts/maintenance/printed-numbers-8041.mjs. Where a book has no rows the reader is exactly as it was. Frame URLs,
 * `?page=N` and citations never read this.
 */
import type { Db } from 'mongodb';

export interface PrintedNumber {
  /** As printed: ٦٧, xii, 二七三, 12v. */
  label: string;
  value: number;
  numbering: 'arabic' | 'arabic-indic' | 'persian' | 'hebrew' | 'chinese' | 'roman' | 'folio';
  side?: 'r' | 'v';
}

/** page id → the number printed on it. */
export type PrintedNumbers = Record<string, PrintedNumber>;

export const NO_PRINTED_NUMBERS: PrintedNumbers = {};

/** One indexed read per book; never throws. Most books have no rows. */
export async function getPrintedNumbers(db: Db, bookId: string): Promise<PrintedNumbers> {
  try {
    const rows = await db.collection('page_printed_numbers')
      .find({ book_id: bookId }, { projection: { _id: 0, page_id: 1, label: 1, value: 1, numbering: 1, side: 1 } })
      .maxTimeMS(3000)
      .toArray();
    if (!rows.length) return NO_PRINTED_NUMBERS;
    const out: PrintedNumbers = {};
    for (const { page_id, ...n } of rows as unknown as (PrintedNumber & { page_id: string })[]) out[page_id] = n;
    return out;
  } catch (err) {
    console.error(`[printed-numbers] could not read page_printed_numbers for ${bookId}:`, (err as Error).message);
    return NO_PRINTED_NUMBERS;
  }
}

/**
 * The number as the toolbar shows it. A reader holding a citation has Western digits, so Arabic-Indic and Persian show
 * those (the printed form is the tooltip); letter and Chinese numerals show both.
 */
export function printedDisplay(n: PrintedNumber): { text: string; title?: string } {
  switch (n.numbering) {
    case 'arabic-indic':
    case 'persian': return { text: String(n.value), title: n.label };
    case 'hebrew':
    case 'chinese': return { text: `${n.label} (${n.value})` };
    default: return { text: n.label };
  }
}

/** A number pad is enough only when every number in the book can be typed in digits and nothing else is printed. */
export function printedInputMode(printed: PrintedNumbers): 'numeric' | 'text' {
  const digitsOnly = new Set<PrintedNumber['numbering']>(['arabic', 'arabic-indic', 'persian']);
  return Object.values(printed).every((n) => digitsOnly.has(n.numbering)) ? 'numeric' : 'text';
}

const toWesternDigits = (s: string) => s
  .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
  .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0));

/** Letters and digits of every script (non-latin-text-operations.md); the Hebrew geresh and gershayim go, and case. */
const foldLabel = (s: string) => toWesternDigits(s.normalize('NFC')).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** A strict reading of a page label; early printing's final j counts (xij). null when it is not one. */
export function romanValue(s: string): number | null {
  if (!/^m*(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})j?$/.test(s) || !s) return null;
  const v: Record<string, number> = { i: 1, j: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  let total = 0;
  for (let i = 0; i < s.length; i++) total += v[s[i]] < (v[s[i + 1]] ?? 0) ? -v[s[i]] : v[s[i]];
  return total;
}

export interface PageBoxMatch {
  pageId: string;
  pageNumber: number;
  /** What the typed text matched: the printed number, or the frame position. */
  via: 'printed' | 'scan';
  printed?: PrintedNumber;
}

/**
 * Every page the page box could mean. One match: go there. More than one: the reader chooses; this never guesses, because
 * a printed number can stand twice in a book (front matter and body) and a typed 67 can be both a printed page and a frame.
 *
 * Digits match the frame and any printed value except roman (a citation's "12" is not xii). A roman numeral matches roman
 * pages by value. Anything else must be the printed label: 12v, צט, 二七三. A bare 12 matches both 12r and 12v.
 */
export function resolvePageBox(input: string, pages: { id: string; page_number: number }[], printed: PrintedNumbers): PageBoxMatch[] {
  const key = foldLabel(input);
  if (!key) return [];
  const number = /^\d+$/.test(key) ? parseInt(key, 10) : null;
  const roman = romanValue(key);
  const byPrinted: PageBoxMatch[] = [];
  const byScan: PageBoxMatch[] = [];
  for (const page of pages) {
    const n = printed[page.id];
    const printedHit = !!n && (
      foldLabel(n.label) === key
      || (number !== null && n.numbering !== 'roman' && n.value === number)
      || (roman !== null && n.numbering === 'roman' && n.value === roman)
    );
    if (printedHit) byPrinted.push({ pageId: page.id, pageNumber: page.page_number, via: 'printed', printed: n });
    else if (number !== null && page.page_number === number) byScan.push({ pageId: page.id, pageNumber: page.page_number, via: 'scan', printed: n });
  }
  return [...byPrinted, ...byScan];
}
