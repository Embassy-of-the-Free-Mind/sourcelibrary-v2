/**
 * Read-side resolver for the imprint-place family (#4043).
 *
 * One fact — where a book was printed — lives in four columns, written by four
 * different passes:
 *
 *   publication_place     enrich-from-catalogs.mjs (BPH + USTC)   catalogue tier
 *   place_of_publication  extract-publisher-from-ocr.mjs, EFM     ocr/mixed tier
 *   place_published       older imports                           import tier
 *   place                 stray (1 document)
 *
 * Until this resolver, every citation surface read ONLY `place_published`:
 * 3,300 visible books held a place in a sibling field and cited none.
 *
 * WHY THIS IS NOT A TIER-PRECEDENCE FALLBACK. Catalogue-beats-import is
 * falsified in the destructive direction (measured on 53 books, see
 * .claude/docs/invariants/field-sprawl.md): the catalogue field holds
 * `s.l. (Germany)` — a true statement that the title page names no place —
 * while the import field holds the actual city (Danzig, Prague, Frankfurt…).
 * A value's ROLE lives in its own shape, never in the column it sits in. So
 * the resolver classifies each value's shape first and only breaks ties
 * within a shape by tier:
 *
 *   asserted       a bare place-name — someone is asserting where this was printed
 *   conjectural    bracketed or hedged apparatus: `[Frankfurt]`, `[Halle? Helmstedt?]`,
 *                  `"Amsterdam" [= Hannover]` — a source hedging or correcting
 *   stated-absent  `s.l.`, `n.p.`, `z.p.`, `o.O.`, `sine loco`… — a statement
 *                  that the book itself names none. Not a value; never allowed
 *                  to beat one.
 *
 * READ-SIDE ONLY. Nothing here writes to `books`, and the winning value is
 * returned VERBATIM (display only tidies `|` separators) — normalisation for
 * comparison must never be written back, because `"Amsterdam" [= Hannover]`
 * is a catalogue's statement that the imprint lies, not noise. The canonical
 * stated/established/conjectural storage shape is later work in #4043; this
 * resolver is the reversible first step.
 */

/** Trust order for tie-breaks WITHIN a shape class — never across shapes. */
export const IMPRINT_PLACE_FIELDS = [
  'publication_place',
  'place_of_publication',
  'place_published',
  'place',
] as const;

export type ImprintPlaceField = (typeof IMPRINT_PLACE_FIELDS)[number];

export type ImprintPlaceFields = Partial<
  Record<ImprintPlaceField, string | null | undefined>
>;

export type ImprintValueShape = 'asserted' | 'conjectural' | 'stated-absent';

export interface ResolvedImprintPlace {
  /** Winning value, verbatim from the field (trimmed only). */
  value: string;
  /** `value` with multi-place `|` separators made readable ("Frankfurt and Leipzig"). */
  display: string;
  /** Which column the value came from — keep it; it is the only provenance we have. */
  field: ImprintPlaceField;
  shape: ImprintValueShape;
}

/**
 * Mongo projection fragment: spread into any `findOne`/`find` projection that
 * previously carried `place_published: 1`, so the resolver sees the whole family.
 */
export const IMPRINT_PLACE_PROJECTION: Record<ImprintPlaceField, 1> =
  Object.fromEntries(IMPRINT_PLACE_FIELDS.map((f) => [f, 1])) as Record<
    ImprintPlaceField,
    1
  >;

/**
 * Bibliographic markers for "the book itself states none": `s.l.` (sine loco),
 * `n.p.` (no place), `z.p.` (zonder plaats), `o.O.` (ohne Ort), `s.n.` (sine
 * nomine), `s.d.` — plus their spelled-out forms and the catalogue habit of
 * qualifying them (`s.l. (Germany)`). Anchored at the start and requiring a
 * word boundary so real places never match (Sneek, Slaný, Olomouc, S. Gallen
 * all tested clean).
 */
const NO_VALUE_STATED =
  /^(n\.?\s*p\.?|s\.?\s*l\.?|z\.?\s*p\.?|s\.?\s*n\.?|s\.?\s*d\.?|o\.?\s*o\.?|sine\s+loco|sine\s+nomine|zonder\s+plaats|ohne\s+ort|no\s+place|unknown)(\b|$)/i;

/** Apparatus that marks a value as hedged/corrected rather than asserted. */
const CONJECTURAL_MARKS = /[[\]?]|^["'“”‘’]|["'“”‘’]$/;

/**
 * Classify one raw field value. Returns null for empty/absent — a value that
 * cannot participate at all.
 */
export function classifyImprintValue(raw: unknown): ImprintValueShape | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Test the stated-absent markers with apparatus stripped, so `[n.p.]` and
  // `"s.l."` still rank as stated-absent rather than merely conjectural.
  const bare = trimmed.replace(/[[\]"'“”‘’]/g, '').trim();
  if (!bare || NO_VALUE_STATED.test(bare)) return 'stated-absent';

  if (CONJECTURAL_MARKS.test(trimmed)) return 'conjectural';
  return 'asserted';
}

const SHAPE_RANK: Record<ImprintValueShape, number> = {
  asserted: 0,
  conjectural: 1,
  'stated-absent': 2,
};

/** Multi-place strings use `|` (`Frankfurt|Leipzig`); make that readable, and
 *  drop dangling separators (`[Lyon?]|`). Display only — never written back. */
function displayForm(value: string): string {
  return value
    .replace(/^\s*\|+/, '')
    .replace(/\|+\s*$/, '')
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean)
    .join(' and ');
}

/**
 * Pick the most citable place value a book holds.
 *
 * Best shape wins (asserted > conjectural > stated-absent); ties within a
 * shape go to the more trusted column (catalogue > ocr > import > stray).
 * Returns null when the book holds nothing — callers keep their existing
 * "no place" behaviour.
 */
export function resolveImprintPlace(
  // Loose on purpose: raw Mongo docs (`WithId<Document>`) flow in from route
  // handlers; classifyImprintValue type-guards every value anyway.
  book: ImprintPlaceFields | Record<string, unknown> | null | undefined,
): ResolvedImprintPlace | null {
  if (!book) return null;

  let best: ResolvedImprintPlace | null = null;
  let bestRank = Infinity;

  for (const field of IMPRINT_PLACE_FIELDS) {
    const raw = (book as Record<string, unknown>)[field];
    const shape = classifyImprintValue(raw);
    if (!shape) continue;
    const rank = SHAPE_RANK[shape];
    // Strict `<` keeps the first (most trusted) field at equal shape rank.
    if (rank < bestRank) {
      const value = (raw as string).trim();
      best = { value, display: displayForm(value), field, shape };
      bestRank = rank;
    }
  }
  return best;
}
