/**
 * PRIOR ART: src/lib/book-checks.ts reads book_checks for the editor API (latest row per method, stale pages) and
 * src/lib/text-provenance.ts decides the "AI translation, not yet reviewed" line from the page itself. Neither turns a
 * stored check into something a reader is told. This does (#6199): a quality finding becomes a warning that links to
 * its evidence; nothing here hides a book or a page.
 *
 * Three levels, all derived from book_checks rows and nothing else:
 *   page, review    the newest reviewer check that read this page has a serious finding on it
 *   page, detector  only an automated detector flagged the page; no reviewer has read its current text
 *   book            the newest check with serious findings: N of the M pages it read
 * A finding describes the text the check read. Once a page's text has been rewritten it is dropped from every count
 * and no warning is shown for it (stalePages), so a warning never outlives the error it describes.
 */
import type { Db } from 'mongodb';
import { stalePages, type BookCheck, type PageFinding, type PageTextStamp } from './book-checks';
import { CHECK_METHODS } from './check-methods';

/** What is wrong, in the order a reader should hear it (most consequential first). */
export const WARNING_KINDS = [
  'wrong_page', 'english_other_page', 'invented_transcription', 'model_notes', 'garble_translated', 'meaning_reversed',
  'misread_meaning', 'unsupported_notes', 'missing_transcription', 'missing_english', 'number_misread', 'repeated_text',
  'serious_transcription', 'serious_english', 'serious_other',
] as const;
export type WarningKind = (typeof WARNING_KINDS)[number];

/** Defect class (.claude/docs/page-error-taxonomy.md) → what a reader is told. Unlisted classes fall back to the stage. */
const KIND_OF_CLASS: Record<string, WarningKind> = {
  I1: 'wrong_page',
  T4: 'english_other_page', T5: 'english_other_page',
  O1: 'invented_transcription', O2: 'invented_transcription', O3: 'invented_transcription',
  O15: 'model_notes', T17: 'model_notes',
  T7: 'garble_translated',
  T8: 'meaning_reversed',
  O6: 'misread_meaning',
  T10: 'unsupported_notes',
  O5: 'missing_transcription',
  T1: 'missing_english', T9: 'missing_english',
  O7: 'number_misread',
  O4: 'repeated_text',
};
const KIND_OF_STAGE = { ocr: 'serious_transcription', translation: 'serious_english', other: 'serious_other' } as const;

/** The kinds on one page, deduplicated, most consequential first. */
export function kindsOfFinding(f: PageFinding): WarningKind[] {
  const found = new Set<WarningKind>();
  if (f.wrong_page) found.add('wrong_page');
  for (const e of f.errors) {
    const cls = e.class?.match(/^[OTI]\d+/)?.[0];
    found.add((cls && KIND_OF_CLASS[cls]) || KIND_OF_STAGE[e.stage] || 'serious_other');
  }
  return WARNING_KINDS.filter((k) => found.has(k));
}

interface WarningSource {
  /** ISO date of the check. */
  date: string;
  reader: 'model' | 'human' | 'detector';
  /** True only when the row records that the page image was opened. */
  imageOpened: boolean;
  methodId: string;
  runId: string;
  /** Fragment on /book/<id>/checks that shows this record. */
  anchor: string;
}

export interface PageWarning extends WarningSource {
  level: 'review' | 'detector';
  page: number;
  /** Empty for a detector flag. */
  kinds: WarningKind[];
  /** Detector only: the issue that defines the detector. */
  issue?: number;
}

export interface BookWarning extends WarningSource {
  /** Pages the check read whose text is still the text it read. */
  pagesRead: number;
  /** Of those, pages with a serious finding. Null when the check kept no per-page record. */
  pagesSerious: number | null;
}

export interface QualityWarnings {
  book: BookWarning | null;
  /** Keyed by page_number. */
  pages: Record<number, PageWarning>;
}

export const NO_WARNINGS: QualityWarnings = { book: null, pages: {} };

// No runtime ships Latin month names; `la` takes the en-GB form ("7 Oct 2026"), whose
// abbreviations a Latin reader also reads as Latin.
const DATE_LOCALE = { en: 'en-GB', es: 'es-ES', la: 'en-GB' } as const;
/** "7 Oct 2026". UTC and a fixed locale, so a server render and the browser agree. */
export function qualityDate(iso: string, locale: keyof typeof DATE_LOCALE): string {
  return new Date(iso).toLocaleDateString(DATE_LOCALE[locale], { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
export const checkAnchor = (row: Pick<BookCheck, 'method_id' | 'run_id'>) => `check-${slug(row.method_id)}-${slug(row.run_id)}`;
export const pageAnchor = (row: Pick<BookCheck, 'method_id' | 'run_id'>, page: number) => `${checkAnchor(row)}-p${page}`;

const sourceOf = (row: BookCheck): WarningSource => ({
  date: new Date(row.checked_at).toISOString(),
  reader: row.reader.kind,
  imageOpened: row.reader.image_opened === true,
  methodId: row.method_id,
  runId: row.run_id,
  anchor: checkAnchor(row),
});

/**
 * Pages of a check that a reader can meet and whose text is still what the check read. A page_number ≤ 0 is
 * soft-hidden, so it is neither warned about nor counted.
 */
export function livePages(row: BookCheck, stamps: Map<number, PageTextStamp>): number[] {
  const stale = new Set(stalePages(row, stamps));
  return row.pages_read.filter((n) => n > 0 && !stale.has(n));
}

/**
 * A row that only restates another row of the same book (a hide grounded on a review, frame.source_run_id) adds no
 * second reading, so it never produces a second warning.
 */
export function ownChecks(rows: BookCheck[]): BookCheck[] {
  const runs = new Set(rows.map((r) => r.run_id));
  return rows.filter((r) => {
    const src = (r.frame as { source_run_id?: unknown } | undefined)?.source_run_id;
    return !(typeof src === 'string' && src !== r.run_id && runs.has(src));
  });
}

export function deriveWarnings(rows: BookCheck[], stamps: Map<number, PageTextStamp>): QualityWarnings {
  const checks = ownChecks(rows).sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime());
  const live = new Map(checks.map((r) => [r, livePages(r, stamps)]));
  const reviews = checks.filter((r) => r.reader.kind !== 'detector');

  // Page level. The newest review that read a page, and kept a per-page record, decides it: a later clean read
  // clears an earlier finding. null = read and found free of serious errors.
  const decided = new Map<number, PageWarning | null>();
  for (const r of reviews) {
    if (!r.page_findings) continue;
    for (const n of live.get(r)!) {
      if (decided.has(n)) continue;
      const f = r.page_findings.find((x) => x.page_number === n);
      decided.set(n, f ? { ...sourceOf(r), anchor: pageAnchor(r, n), level: 'review', page: n, kinds: kindsOfFinding(f) } : null);
    }
  }
  // A detector flag stands only where no review has read the page's current text.
  const flagged = new Map<number, PageWarning>();
  for (const r of checks) {
    if (r.reader.kind !== 'detector') continue;
    for (const n of live.get(r)!) {
      if (decided.has(n) || flagged.has(n)) continue;
      flagged.set(n, { ...sourceOf(r), level: 'detector', page: n, kinds: [], issue: CHECK_METHODS[r.method_id]?.issue });
    }
  }

  // Book level. The newest review that still has a serious finding standing. Counts stay inside that one check:
  // rates are never pooled across methods (scripts/eval/methods/README.md).
  let book: BookWarning | null = null;
  for (const r of reviews) {
    const pages = live.get(r)!;
    if (!pages.length) continue;
    if (r.page_findings) {
      const serious = pages.filter((n) => r.page_findings!.some((f) => f.page_number === n) && decided.get(n)).length;
      if (serious > 0) { book = { ...sourceOf(r), pagesRead: pages.length, pagesSerious: serious }; break; }
    } else if (r.verdict === 'fix') {
      book = { ...sourceOf(r), pagesRead: pages.length, pagesSerious: null };
      break;
    }
  }

  const pages: Record<number, PageWarning> = {};
  for (const [n, w] of flagged) pages[n] = w;
  for (const [n, w] of decided) if (w) pages[n] = w;
  return { book, pages };
}

const CHECK_LIMIT = 200;

/**
 * A book's check rows, newest first, and the current text stamps of every page they read. Two indexed queries:
 * book_checks on {book_id, checked_at} and pages on {book_id, page_number}. `bookIds` is the book's `id` and, when it
 * differs, its `_id` as a string (book-deletion-and-identity.md).
 */
export async function loadBookChecks(db: Db, bookIds: string[]): Promise<{ rows: BookCheck[]; stamps: Map<number, PageTextStamp> }> {
  const rows = (await db.collection('book_checks')
    .find({ book_id: { $in: bookIds } }, { projection: { _id: 0, recorded_at: 0, recorded_by: 0 } })
    .sort({ checked_at: -1 })
    .limit(CHECK_LIMIT)
    .maxTimeMS(5000)
    .toArray()) as unknown as BookCheck[];
  const stamps = new Map<number, PageTextStamp>();
  const nums = [...new Set(rows.flatMap((r) => r.pages_read))];
  if (nums.length) {
    const found = await db.collection('pages')
      .find({ book_id: { $in: bookIds }, page_number: { $in: nums } }, { projection: { _id: 0, page_number: 1, 'ocr.updated_at': 1, 'translation.updated_at': 1 } })
      .maxTimeMS(5000)
      .toArray();
    for (const p of found) stamps.set(p.page_number as number, p as unknown as PageTextStamp);
  }
  return { rows, stamps };
}

/**
 * The warnings a reader of this book is shown. Never throws: a failed read shows no warning rather than breaking the
 * page it sits on (the reader and the book page are ISR, so the next revalidation retries).
 */
export async function getQualityWarnings(db: Db, bookIds: string[]): Promise<QualityWarnings> {
  try {
    const { rows, stamps } = await loadBookChecks(db, bookIds);
    return rows.length ? deriveWarnings(rows, stamps) : NO_WARNINGS;
  } catch (err) {
    console.error(`[quality-warnings] could not read book_checks for ${bookIds[0]}:`, (err as Error).message);
    return NO_WARNINGS;
  }
}
