/**
 * Prior human translation credit — reader gate + link labeling (issue #3026).
 *
 * When a book is NOT the first English translation, we credit the human
 * translation that came before and point the reader to where it can be read or
 * bought. This is the un-extractive move: name the (usually invisible, often
 * underpaid) translator and send serious readers to the scholar's edition.
 *
 * The hard rule — same bar as quotes — is VERIFIED, not trusted. The prose
 * these credits are parsed from was written by Gemini, and the entire
 * first-translation stack exists because AI fabricates priors. A credit only
 * renders once its named edition resolved to a real bibliographic record AND
 * carries a resolvable link. A name with no reachable source is just a name, so
 * a missing/empty `url` is disqualifying on its own.
 */

import type { Book, PriorTranslationCredit } from '@/lib/types/book';

/** Does this book carry a publishable prior-translation credit? */
export function hasPublishablePriorTranslation(
  book: Pick<Book, 'prior_translation'>,
): book is Pick<Book, 'prior_translation'> & { prior_translation: PriorTranslationCredit } {
  const p = book.prior_translation;
  return !!p && typeof p.url === 'string' && /^https?:\/\//.test(p.url) && !!p.work_title;
}

/** Human label for the outbound link, by how the edition was confirmed. */
export function priorLinkLabel(p: PriorTranslationCredit): string {
  switch (p.verification_method) {
    case 'worldcat':
      return 'Find it in a library';
    case 'publisher':
      return 'View at publisher';
    case 'google_books':
      return 'View on Google Books';
    case 'library_catalog':
      return 'Find it in a library';
    default:
      return 'Find it';
  }
}

/** One earlier English translation, ready to place on the book timeline. */
export interface PriorTimelineRow {
  /** Sort key: the publication year as ms, or +Infinity when undated. */
  ts: number;
  /** Year as shown, or null when we have none. */
  year: string | null;
  /** The curated, verified credit — renders with its "find it" link. */
  credit?: PriorTranslationCredit;
  /** A verification-array pick — renders as a plain summary line. */
  pick?: { english_title?: string | null; translator?: string | null; publisher?: string | null; pub_year?: string | number | null; url?: string | null };
}

const priorYearTs = (y?: string | number | null): number => {
  const m = String(y ?? '').match(/(\d{3,4})/);
  return m ? Date.UTC(Number(m[1]), 0, 1) : Number.POSITIVE_INFINITY;
};

/**
 * Every earlier English translation we hold, oldest first, deduped.
 *
 * Why this is a function and not an inline `[0]`: the verification array is
 * UNORDERED. Taking its first element hid 2,212 recorded translations across
 * 1,339 books, and in 35% of the books with two or more dated picks the one
 * shown was not the earliest — so a timeline entry headed "Earlier English
 * translation" credited a LATER translation and buried the earlier one, by up
 * to five centuries (Pico's Opera Omnia showed Copenhaver 2022 over Sir Thomas
 * More 1510). On a date axis, an arbitrary member of a set is not just
 * incomplete; it is false.
 *
 * The curated `prior_translation` credit is emitted first so it wins the dedupe
 * against any verification pick naming the same translator and year — it is the
 * verified one, and it carries the outbound link.
 */
export function collectPriorTranslations(
  credit: PriorTranslationCredit | null | undefined,
  picks: ReadonlyArray<NonNullable<PriorTimelineRow['pick']>> = [],
): PriorTimelineRow[] {
  const rows: PriorTimelineRow[] = [];
  const seen = new Set<string>();
  const take = (key: string, row: PriorTimelineRow) => {
    const k = key.trim().toLowerCase();
    // A row with no translator AND no year cannot be deduped meaningfully; keep it.
    if (k !== '|infinity' && seen.has(k)) return;
    seen.add(k);
    rows.push(row);
  };
  if (credit) {
    take(`${formatTranslators(credit.translators)}|${priorYearTs(credit.year)}`, {
      ts: priorYearTs(credit.year),
      year: credit.year ? String(credit.year) : null,
      credit,
    });
  }
  for (const p of picks) {
    take(`${p.translator ?? ''}|${priorYearTs(p.pub_year)}`, {
      ts: priorYearTs(p.pub_year),
      year: p.pub_year ? String(p.pub_year) : null,
      pick: p,
    });
  }
  // Oldest first; undated sort last among priors rather than drifting to the top
  // of the whole timeline on a sentinel year.
  return rows.sort((a, b) => a.ts - b.ts);
}

/** "trans. A, B and C" — Oxford-free join of translator names. */
export function formatTranslators(translators: string[]): string {
  const names = (translators || []).filter(Boolean);
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The one-line courtesy sentence, minus the link.
 * e.g. "A published English translation exists: De Subtilitate, trans. John M.
 * Forrester (ACMRS, 2013)."  Partial editions say so, honestly.
 */
export function priorTranslationSentence(p: PriorTranslationCredit): string {
  const lead =
    p.scope === 'partial'
      ? 'A partial published English translation exists:'
      : 'A published English translation exists:';
  const bits: string[] = [p.work_title];
  const translators = formatTranslators(p.translators);
  if (translators) bits.push(`trans. ${translators}`);
  const paren: string[] = [];
  if (p.publisher) paren.push(p.publisher);
  if (p.year) paren.push(String(p.year));
  const tail = paren.length ? ` (${paren.join(', ')})` : '';
  return `${lead} ${bits.join(', ')}${tail}.`;
}
