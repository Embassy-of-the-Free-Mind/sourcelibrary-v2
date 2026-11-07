/**
 * Facing-page editions: the original on the left leaf, the PUBLISHED English
 * on the right (#8321). The Loeb Classical Library is the case this was built
 * for.
 *
 * PRIOR ART: src/lib/english-original-text.ts — the #7100 rule that stops an
 * English leaf's stored rewording from standing in for the printed words. It
 * fired only on English-catalogued books, so a Loeb catalogued Greek (L118,
 * Herodotus III–IV) served Gemini's rewording of Godley as "the translation":
 * "the Thracians were a meanly-living and simple-witted folk" came out as "a
 * people who lived quite simply and were somewhat naive". That rule now also
 * fires on a book carrying `facing_translation` (see
 * `servesTranscriptionInsteadOfTranslation`); this module holds the flag and
 * the pairing. src/components/reader-v2/PairedEdition.tsx is a different thing
 * (a one-manuscript overlay for the Marcianus), not a facing-page pairing.
 *
 * The flag is a BOOK-level field written by
 * scripts/maintenance/loeb-facing-census.mjs. It is never inferred per page:
 * on most non-English books the English leaves are library stamps and scanner
 * notes (#2784 comment 2026-11-07), and an "English leaf → its own text is the
 * translation" rule would publish those as translations.
 *
 * Scripts-side twin: scripts/lib/facing-translation.mjs (the census uses it).
 * `tests/unit/facing-translation.test.ts` pins the two — change both at once.
 */
import { stripEditorialWrappers } from '@/lib/strip-editorial-wrappers';
import { isEnglishOriginalPage, BOILERPLATE_RE } from '@/lib/english-page-language';

/** `books.facing_translation`, as the census writes it. */
export interface FacingTranslation {
  source: 'published';
  series?: string;
  translator?: string;
  year?: number;
  pairing: string;
  detected_at?: string | Date;
  detector?: string;
  pairs?: number;
}

/** The rule name stored in `books.facing_translation.pairing`. */
export const FACING_PAIRING_RULE = 'next-leaf-consecutive-printed';

/** A leaf with less body text than this is a blank, a plate or a half-title. */
export const MIN_LEAF_BODY_CHARS = 200;

/** The book field the serving rule and the reader read. */
export const FACING_TRANSLATION_BOOK_PROJECTION = { facing_translation: 1 } as const;

type BookLike = object | null | undefined;

/** The flag, when the book carries a published facing translation. */
export function facingTranslationOf(book: BookLike): FacingTranslation | null {
  const f = (book as { facing_translation?: unknown } | null | undefined)?.facing_translation;
  if (!f || typeof f !== 'object') return null;
  return (f as FacingTranslation).source === 'published' ? (f as FacingTranslation) : null;
}

export function hasPublishedFacingTranslation(book: BookLike): boolean {
  return facingTranslationOf(book) !== null;
}

function leafBody(ocrData: string | null | undefined): string {
  // The quotable text: envelope and wrapper blocks gone, page marks kept (a few characters).
  return stripEditorialWrappers(String(ocrData || '')).replace(/\s+/g, ' ').trim();
}

export type LeafRole = 'original' | 'translation';

/**
 * What a leaf of a facing-page edition is: `translation` (the printed English),
 * `original` (Greek or Latin text), or null (blank, boilerplate, too short).
 */
export function leafRole(ocrData: string | null | undefined): LeafRole | null {
  const body = leafBody(ocrData);
  if (body.length < MIN_LEAF_BODY_CHARS) return null;
  if (isEnglishOriginalPage(ocrData)) return 'translation';
  if (BOILERPLATE_RE.test(body)) return null;
  return 'original';
}

interface LeafLike {
  page_number?: number;
  ocr?: { data?: unknown } | null;
  printed_page?: { label?: unknown } | null;
}

/**
 * The arabic page number printed on the leaf: the fitted `printed_page.label`
 * (#4291) when present, else the OCR's own `<page-num>`. Null for roman
 * numerals, folio labels and unnumbered leaves.
 */
export function printedNumber(page: LeafLike | null | undefined): number | null {
  const label = page?.printed_page?.label;
  if (typeof label === 'string' && /^\d+$/.test(label.trim())) return Number(label.trim());
  if (page?.printed_page) return null; // the fitter spoke, and it is not arabic
  const m = String(page?.ocr?.data ?? '').match(/<page-num>\s*(\d+)\s*<\/page-num>/i);
  return m ? Number(m[1]) : null;
}

/**
 * Does `original` face `next`? FACING_PAIRING_RULE: the next leaf in scan
 * order is an English leaf and its printed number is one more.
 */
export function isFacingPair(original: LeafLike | null | undefined, next: LeafLike | null | undefined): boolean {
  if (!original || !next) return false;
  if (typeof original.page_number !== 'number' || next.page_number !== original.page_number + 1) return false;
  const o = typeof original.ocr?.data === 'string' ? original.ocr.data : '';
  const n = typeof next.ocr?.data === 'string' ? next.ocr.data : '';
  if (leafRole(o) !== 'original' || leafRole(n) !== 'translation') return false;
  const a = printedNumber(original);
  const b = printedNumber(next);
  return a !== null && b !== null && b === a + 1;
}

/** "Loeb translation · A. D. Godley, 1921" — the reader's pane label. */
export function facingTranslationLabel(book: BookLike, seriesLabel = 'Loeb translation'): string {
  const f = facingTranslationOf(book);
  if (!f) return seriesLabel;
  const who = [f.translator, f.year].filter((v) => v != null && v !== '').join(', ');
  return who ? `${seriesLabel} · ${who}` : seriesLabel;
}

/**
 * What a caller citing a flagged book's English leaf has to be told: these are
 * the published translator's words, printed facing the original — not ours,
 * and not the author's.
 */
export function facingTranslationNote(book: BookLike): string {
  const f = facingTranslationOf(book);
  const who = f?.translator ? `${f.translator}'s` : 'the published';
  const when = f?.year ? ` (${f.year})` : '';
  return `This leaf is ${who} English translation${when}, printed in this ${f?.series === 'loeb' ? 'Loeb ' : ''}edition `
    + 'facing the original text. The quotable text is the transcription of the printed English, served as `original` '
    + '(text_source: "ocr_original"): an AI transcription of the scan, uncorrected. Attribute the wording to the '
    + 'translator, never to the ancient author and never to Source Library. `facing.page` is the original-language '
    + 'leaf it translates.';
}

/** Minimal Mongo surface, so this module needs no driver import. */
interface PagesReader {
  collection(name: string): {
    find(filter: Record<string, unknown>, options?: Record<string, unknown>): { toArray(): Promise<unknown[]> };
  };
}

export interface FacingPartner<P = LeafLike & { id?: string }> {
  /** What the CURRENT leaf is in the pair. */
  role: LeafRole;
  /** The other leaf. */
  page: P;
}

/**
 * The leaf facing `page` on a flagged book, or null. An original leaf looks at
 * the next leaf; an English leaf at the previous one. Costs no query on an
 * unflagged book. `projection` must include page_number, ocr.data and
 * printed_page.
 */
export async function findFacingPartner<P extends LeafLike & { id?: string }>(
  db: PagesReader,
  book: BookLike,
  page: LeafLike & { book_id?: unknown },
  projection: Record<string, unknown> = { _id: 0, id: 1, page_number: 1, 'ocr.data': 1, printed_page: 1 },
): Promise<FacingPartner<P> | null> {
  if (!hasPublishedFacingTranslation(book) || typeof page.page_number !== 'number') return null;
  const role = leafRole(typeof page.ocr?.data === 'string' ? page.ocr.data : '');
  if (!role) return null;
  try {
    const [other] = await db.collection('pages').find(
      { book_id: page.book_id, page_number: page.page_number + (role === 'original' ? 1 : -1) },
      { projection, limit: 1, maxTimeMS: 3000 },
    ).toArray() as P[];
    if (!other) return null;
    const ok = role === 'original' ? isFacingPair(page, other) : isFacingPair(other, page);
    return ok ? { role, page: other } : null;
  } catch (err) {
    console.error('[facing-translation] partner lookup failed:', (err as Error).message);
    return null;
  }
}

/**
 * Where a page turn lands in a facing-page edition: it steps by OPENING, as a
 * printed book does. An opening is an original leaf and the English leaf
 * facing it; every other leaf (introduction, index, plates) is an opening of
 * one and turns as it always did. Returns the index to land on, or null at
 * either end of the book.
 *
 * `at(i)` is the leaf at index i when its text is loaded, undefined when it is
 * not. An unloaded neighbour reads as unpaired, so the turn falls back to one
 * leaf, never past a page: at worst it lands on the English half of the next
 * opening, which the reader shows as that same opening.
 */
export function facingStepIndex(
  index: number,
  dir: 1 | -1,
  length: number,
  at: (i: number) => LeafLike | null | undefined,
): number | null {
  if (index < 0 || index >= length) return null;
  const pairsAt = (i: number) => i >= 0 && i + 1 < length && isFacingPair(at(i), at(i + 1));
  const start = pairsAt(index - 1) ? index - 1 : index;
  const end = pairsAt(start) ? start + 1 : start;
  if (dir > 0) return end + 1 < length ? end + 1 : null;
  const prev = start - 1;
  if (prev < 0) return null;
  return pairsAt(prev - 1) ? prev - 1 : prev;
}
