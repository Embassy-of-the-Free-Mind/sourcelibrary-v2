/**
 * The Translation Card — the work-grain read model (#3881, the card method).
 *
 * One doc per work in `work_translation_history`: the list of known English
 * translations, cited; possibly empty with a note saying where we looked.
 * A book's first-translation label is a JOIN against its work's card — no
 * derivation, no valve, no stored verdict:
 *
 *   card empty (status no_prior_known) + we hold an English rendering
 *     → "No earlier English translation is known to us — here's where we looked."
 *
 * THIS MODULE IS THE ACTUATION SURFACE. The moment a page renders cardLabel(),
 * the registry stops being a notebook and becomes the site's word — which is
 * why wiring it is its own reviewed PR and why the render rule fails toward
 * silence: any state that is not a clean, reviewed answer renders NOTHING new
 * (the legacy badge continues to say whatever it said).
 *
 * Method doc: .claude/docs/translation-card-method.md
 */

import type { Db } from 'mongodb';

export const CARD_COLLECTION = 'work_translation_history';

/** One known English translation, as written on the card. */
export interface CardEntry {
  kind?: string;
  year?: string | null;
  translator?: string | null;
  title?: string | null;
  publisher?: string | null;
  /** Plain words: 'complete', 'partial (Book I of IV)', 'excerpts', … */
  completeness?: string | null;
  citation_url?: string | null;
  verified?: boolean;
}

export interface TranslationCard {
  _id: string;
  work_id: string;
  work_title?: string;
  author?: string | null;
  /**
   * no_prior_known | prior_exists | not_a_single_work | under_review
   * (original_language_is_english and text_unidentified pending — both render
   * as silence, like under_review, so adding them later cannot widen output.)
   */
  status: string;
  entries: CardEntry[];
  search?: { summary?: string; sources?: string[]; attempt_count?: number; last_searched?: string | null };
  review?: { verified_by?: string; verified_at?: string | null };
}

/** Reader display names for the source ids the ledger records. */
const SOURCE_NAMES: Record<string, string> = {
  loc: 'Library of Congress',
  estc: 'ESTC',
  wikidata: 'Wikidata',
  translation_catalogs: 'translation catalogues',
  translation_classification: 'internal classification',
  open_library: 'Open Library',
  'archive.org': 'Internet Archive',
  'wikipedia.org': 'Wikipedia',
  'en.wikipedia.org': 'Wikipedia',
  'google.com': 'Google Search',
  'books.google.com': 'Google Books',
  'catalog.hathitrust.org': 'HathiTrust',
  'babel.hathitrust.org': 'HathiTrust',
  'openlibrary.org': 'Open Library',
  'worldcat.org': 'WorldCat',
  'search.worldcat.org': 'WorldCat',
  'brill.com': 'Brill',
  'wellcomecollection.org': 'Wellcome Collection',
};

/**
 * One factual line about the search behind a card — for the expanded view of
 * the panel, never as a disclaimer beside the label. Returns null when the
 * card records no search (nothing to show is better than an empty boast).
 */
export function searchRecordLine(card: TranslationCard | null | undefined): string | null {
  const s = card?.search;
  if (!s || !(s.attempt_count && s.attempt_count > 0)) return null;
  // Ledger sources mix catalogue ids with raw grounding URLs; collapse URLs
  // to their hostname so the line reads like a source list, not a link dump.
  const toName = (x: string): string => {
    if (SOURCE_NAMES[x]) return SOURCE_NAMES[x];
    try {
      const host = new URL(x).hostname.replace(/^www\./, '');
      return SOURCE_NAMES[host] ?? host;
    } catch {
      return x;
    }
  };
  const named = (s.sources ?? [])
    .map(toName)
    .filter((x, i, arr) => arr.indexOf(x) === i)
    .slice(0, 6);
  const when = s.last_searched
    ? new Date(s.last_searched).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    : null;
  const bits = [
    `${s.attempt_count} recorded ${s.attempt_count === 1 ? 'search' : 'searches'}`,
    named.length ? `sources include ${named.join(', ')}` : null,
    when ? `most recent ${when}` : null,
  ].filter(Boolean);
  return `Search record: ${bits.join(' · ')}.`;
}

export interface CardLabel {
  /** The one sentence. */
  sentence: string;
  /** 'first' renders the assertive register; 'priors' lists the history. */
  register: 'first' | 'priors';
  /** Entries to show under the sentence (priors register only). */
  entries: CardEntry[];
}

/**
 * The one-sentence rule. Returns null — render NOTHING new — unless the card
 * is a clean, reviewed answer:
 *  - under_review / not_a_single_work / unknown states → null.
 *  - no_prior_known but the book has no English rendering to point at → null.
 *  - prior_exists with zero surviving entries (contradiction) → null.
 * Silence is the fail direction; the legacy badge stays untouched either way.
 */
export function cardLabel(
  card: TranslationCard | null | undefined,
  book: { pages_translated?: number | null; language?: string | null },
): CardLabel | null {
  if (!card) return null;

  if (card.status === 'no_prior_known') {
    if (!((book.pages_translated ?? 0) > 0)) return null;
    // Plain catalog voice (2026-08-11): state the fact like a catalog states
    // "first edition". The search record backs it, one click away — not as a
    // disclaimer in the reader's face.
    return {
      sentence: 'The first English translation of this work.',
      register: 'first',
      entries: [],
    };
  }

  if (card.status === 'prior_exists') {
    const entries = (card.entries ?? []).filter((e) => e.title || e.translator);
    if (entries.length === 0) return null;
    const named = entries
      .map((e) => ({ e, y: parseInt(String(e.year ?? '').match(/\d{4}/)?.[0] ?? '', 10) }))
      .filter((x) => Number.isFinite(x.y))
      .sort((a, b) => a.y - b.y)
      .slice(0, 3)
      .map((x) => `${x.e.translator ?? x.e.title} (${x.y})`);
    const lead = named.length
      ? `Earlier English translations: ${named.join('; ')}.`
      : 'Earlier English translations exist.';
    return { sentence: lead, register: 'priors', entries };
  }

  return null;
}

/** Thin fetch. Read-only; returns null when the work has no card. */
export async function loadCard(db: Db, workId: string | null | undefined): Promise<TranslationCard | null> {
  if (!workId) return null;
  return db.collection<TranslationCard>(CARD_COLLECTION).findOne({ _id: workId });
}
