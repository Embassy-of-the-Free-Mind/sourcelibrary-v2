/**
 * Hard author / work constraints on a passage list (#3895).
 *
 * PRIOR ART: src/lib/search/diversity.ts — `diversify()` RE-ORDERS a list so
 * each screen of ten spreads across authors and works, and never drops a row.
 * A cross-author survey ("25 quotes from 25 authors") needs the opposite: a
 * filter that names authors in or out, and a cap that DROPS the eighth
 * Agrippa printing. This file is that filter; it reuses diversity.ts's
 * `BookFacets` and keys an author the same way (author_id, else the folded
 * name). src/lib/dedup.ts `normalizeAuthor` strips Latin diacritics only via a
 * U+0300 range and is tuned for dedup, not for matching a caller's term.
 *
 * Pure: no database client. The MCP route loads the facets
 * (src/lib/search/diversity-facets.ts) and passes them in.
 */
import type { BookFacets } from '@/lib/search/diversity';

export interface AuthorConstraints {
  /** Keep only passages whose author matches one of these names. */
  author?: string[];
  /** Drop passages whose author matches any of these names. */
  exclude_authors?: string[];
  /** At most this many passages per author (author_id, else the folded name). */
  max_per_author?: number;
  /** At most this many passages per work (work_id, else the book itself). */
  max_per_work?: number;
}

export interface AuthorConstraintReport {
  /** Rows dropped because their author matched none of `author`. */
  not_matching_author: number;
  /** Rows dropped by `exclude_authors`. */
  excluded: number;
  /** Rows dropped by `max_per_author`. */
  capped_by_author: number;
  /** Rows dropped by `max_per_work`. */
  capped_by_work: number;
  /** Rows kept with no usable author: `max_per_author` cannot judge them, so it never caps them. */
  rows_without_author: number;
  /** Caller terms that fold to nothing comparable; ignored, never read as "matches nothing". */
  unusable_terms: string[];
}

/**
 * Fold a name for matching: every script's letters and digits survive (NFKC,
 * `\p{L}\p{N}`); combining marks are stripped; marks INSIDE a word (ʿayn,
 * hamza, apostrophes) are elided rather than split on or kept, so `Saʻdī` stays `sadi`.
 */
export function foldName(s: string): string[] {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .normalize('NFKC')
    .toLowerCase()
    // ʻ ʼ ʿ ʾ are modifier LETTERS (\p{Lm}), so they must go wherever they sit,
    // word-initial too: al-ʿArabī and al-Arabi are one name.
    .replace(/['’‘ʻʼʿʾ`]/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * Does `author` match the caller's `term`? Every token of the term must be the
 * start of some token of the author string, so "Agrippa" matches
 * "Agrippa von Nettesheim, Heinrich Cornelius" and "della porta" matches
 * "Porta, Giambattista della", but "de" does not match "Andreae".
 */
export function authorMatches(author: string | null | undefined, termTokens: string[]): boolean {
  if (!author || termTokens.length === 0) return false;
  const tokens = foldName(author);
  return termTokens.every((t) => tokens.some((a) => a.startsWith(t)));
}

const UNKNOWN = new Set(['unknown', 'anonymous', 'anon', 'anonymus', 'various']);

/** The key `max_per_author` counts on, or null when the row has no usable author. */
function authorKey(author: string | null | undefined, facets: BookFacets | undefined): string | null {
  if (facets?.author_id) return `id:${facets.author_id}`;
  const name = facets?.author || author;
  if (!name) return null;
  const folded = foldName(name).join(' ');
  return folded && !UNKNOWN.has(folded) ? `name:${folded}` : null;
}

export function hasAuthorConstraints(c: AuthorConstraints): boolean {
  return !!(c.author?.length || c.exclude_authors?.length || c.max_per_author || c.max_per_work);
}

/** Parse the tool arguments: a string or an array for names, a positive integer for caps. */
export function parseAuthorConstraints(args: Record<string, unknown>): AuthorConstraints {
  const names = (v: unknown): string[] | undefined => {
    const list = (Array.isArray(v) ? v : typeof v === 'string' ? [v] : [])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean);
    return list.length ? list : undefined;
  };
  const cap = (v: unknown): number | undefined => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n >= 1 ? n : undefined;
  };
  return {
    author: names(args.author),
    exclude_authors: names(args.exclude_authors),
    max_per_author: cap(args.max_per_author),
    max_per_work: cap(args.max_per_work),
  };
}

/**
 * Apply the constraints to `rows` (best first). Order is kept; rows are
 * dropped. Caps keep the first (best) rows of each author / work.
 */
export function applyAuthorConstraints<T>(
  rows: readonly T[],
  c: AuthorConstraints,
  opts: {
    bookId: (row: T) => string;
    author: (row: T) => string | null | undefined;
    facets?: ReadonlyMap<string, BookFacets>;
  },
): { rows: T[]; report: AuthorConstraintReport } {
  const report: AuthorConstraintReport = {
    not_matching_author: 0, excluded: 0, capped_by_author: 0, capped_by_work: 0, rows_without_author: 0, unusable_terms: [],
  };
  const tokenise = (terms: string[] | undefined) => (terms ?? []).flatMap((t) => {
    const tokens = foldName(t);
    if (tokens.length === 0) { report.unusable_terms.push(t); return []; }
    return [tokens];
  });
  const include = tokenise(c.author);
  const exclude = tokenise(c.exclude_authors);
  const perAuthor = new Map<string, number>();
  const perWork = new Map<string, number>();
  const out: T[] = [];

  for (const row of rows) {
    const id = opts.bookId(row);
    const f = opts.facets?.get(id);
    const name = opts.author(row) || f?.author || null;
    if (include.length && !include.some((t) => authorMatches(name, t))) { report.not_matching_author++; continue; }
    if (exclude.length && exclude.some((t) => authorMatches(name, t))) { report.excluded++; continue; }
    const aKey = c.max_per_author ? authorKey(name, f) : null;
    if (aKey !== null && (perAuthor.get(aKey) ?? 0) >= c.max_per_author!) { report.capped_by_author++; continue; }
    const wKey = c.max_per_work ? f?.work_id || `book:${id}` : null;
    if (wKey !== null && (perWork.get(wKey) ?? 0) >= c.max_per_work!) { report.capped_by_work++; continue; }
    // Count only rows that are kept, so a row one cap drops does not use up the other's quota.
    if (aKey !== null) perAuthor.set(aKey, (perAuthor.get(aKey) ?? 0) + 1);
    else if (c.max_per_author) report.rows_without_author++;
    if (wKey !== null) perWork.set(wKey, (perWork.get(wKey) ?? 0) + 1);
    out.push(row);
  }
  return { rows: out, report };
}
