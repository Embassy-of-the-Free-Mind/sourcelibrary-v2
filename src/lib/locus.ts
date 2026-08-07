/**
 * Canonical loci on the request path.
 *
 * TWIN: `scripts/lib/locus-parse.mjs` holds the full parser, including the
 * extraction side (`parseLocusRefs`) that reads printed page numbers during the
 * corpus sweep. Only the QUERY side is needed here — turning what a user typed
 * into a lookup key — so only that is duplicated, and
 * `tests/unit/locus-parse.test.ts` pins the two against each other.
 *
 * See the .mjs for why the system is declared rather than sniffed from the
 * number, and why line numbers are dropped rather than resolved.
 */

export type LocusSystem = 'bekker' | 'stephanus';

/** Bekker pages run 184a1–1462b18. Stephanus runs 1a–1379e. */
const RANGE: Record<LocusSystem, [number, number]> = {
  bekker: [184, 1462],
  stephanus: [1, 1400],
};

/** Bekker has two columns; Stephanus has five sections. */
const SECTIONS: Record<LocusSystem, string> = {
  bekker: 'ab',
  stephanus: 'abcde',
};

export const LOCUS_SYSTEMS = Object.keys(RANGE) as LocusSystem[];

export function isLocusSystem(v: unknown): v is LocusSystem {
  return typeof v === 'string' && v in RANGE;
}

export interface ParsedLocus {
  page: number;
  section: string | null;
}

/**
 * Parse a citation as a classicist would type it: "1103b24", "Bekker 1103b",
 * "Pol. 1287a28", "Republic 509 d".
 *
 * The work name and the line number are DISCARDED. Line numbers because anchors
 * are page-and-column, and answering `1103b24` differently from `1103b` would
 * claim a precision the data does not carry. Work names because canonical
 * numbers are globally unique within their system — Bekker 1103 is in the
 * Nicomachean Ethics whichever volume holds it — which is exactly what makes
 * locus lookup independent of the unresolved work-identity problem in #3653.
 */
export function parseLocusQuery(input: string | null | undefined, system: LocusSystem): ParsedLocus | null {
  if (!input || !RANGE[system]) return null;

  const text = String(input)
    .replace(/[ªº]/g, 'a')
    .replace(/\^/g, '')
    .replace(/–|—/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\d]*/, '') // strip a leading system name or work abbreviation
    .trim();

  const m = /^(\d{1,4})\s*([a-e])?\s*\d*$/i.exec(text);
  if (!m) return null;

  const page = Number(m[1]);
  const [lo, hi] = RANGE[system];
  if (page < lo || page > hi) return null;

  const section = m[2] ? m[2].toLowerCase() : null;
  if (section && !SECTIONS[system].includes(section)) return null;

  return { page, section };
}

/** "1103b" / "1103" — the canonical string form. */
export function formatLocus(page: number, section: string | null): string {
  return section ? `${page}${section}` : String(page);
}

/**
 * Which system does an author cite in?
 *
 * Deliberately narrow. Bekker and Stephanus are the two systems we hold anchors
 * for; Diels-Kranz, Migne and the rest are real and not yet extracted, so this
 * returns null rather than guessing at a frame we cannot resolve.
 */
export function systemForAuthor(author: string | null | undefined): LocusSystem | null {
  if (!author) return null;
  if (/aristotle|aristotel/i.test(author)) return 'bekker';
  if (/plato(?!n?ist)|platon(?!ist)/i.test(author)) return 'stephanus';
  return null;
}
