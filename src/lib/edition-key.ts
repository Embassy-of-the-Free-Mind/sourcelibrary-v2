/**
 * Edition identity — `edition_key`.
 *
 * WHY THIS EXISTS
 * ---------------
 * The identity stack (#3258) has four layers keyed on `books`:
 *
 *   Person   author_id      the human
 *   Work     work_id        the abstract creation      (~98% of live books)
 *   Edition  edition_key    ONE PRINTING               <- this file
 *   Copy     duplicate_of   one digitization of it     (built + validated 2026-07-19)
 *
 * The edition layer was the only one never materialized. Without it, three
 * places each grew their OWN notion of "same edition" and they disagree:
 *
 *   - `src/lib/dedup.ts`                          title+author, year/volume as veto
 *   - `scripts/maintenance/duplicate-integrity-check.mjs`  title+surname+year+volume
 *   - `src/app/api/admin/duplicates/route.ts`     title+author, then a THIRD
 *                                                 private `extractVolume()`
 *
 * Three implementations of one concept is how a metric becomes unfalsifiable:
 * the same corpus reads as 456 or 296 same-edition clusters depending on which
 * copy you ask (the difference is volume-awareness alone). This module is the
 * single definition; the others consume the stored field.
 *
 * THE KEY
 * -------
 *   `<normalized title>|<author surname>|<year>|v<volume>`
 *
 * Deliberately the exact shape already used by `duplicate-integrity-check.mjs`,
 * so its published baseline (270 clusters/+460 copies on 2026-07-09; 296/+340 on
 * 2026-07-19) stays comparable across the migration. Human-readable on purpose —
 * a hashed key cannot be eyeballed in a queue, and this field's whole job is to
 * be adjudicated by a person.
 *
 * WHAT THE KEY IS NOT
 * -------------------
 * It is a HEURISTIC, not an authority. Two books sharing an `edition_key` are a
 * *claim* that they are the same printing, strong enough to enqueue for review
 * and not strong enough to publish unreviewed. `edition_key_quality` says how
 * much of the key is actually evidenced:
 *
 *   full        title + author + year all present   <- the only tier a reader-facing
 *                                                      surface may trust
 *   no-year     year unknown; the key merges every printing of that title
 *   no-author   anonymous/uncredited
 *   title-only  neither
 *
 * The `no-year` tier is the dangerous one and it is why quality is a stored
 * field rather than a comment: with the year slot empty, six printings of one
 * title across two centuries collapse into a single key. That is the right
 * behaviour for a *review queue* (they might well be copies) and the wrong
 * behaviour for an "other scans of this edition" rail. Gate on quality.
 *
 * True edition AUTHORITY, when we have it, rides alongside in
 * `edition_external_ids` — see `ustcEditionLink()` below.
 */

import { extractVolume, editionYear } from './dedup';

export type EditionKeyQuality = 'full' | 'no-year' | 'no-author' | 'title-only';

/** The fields an edition key is derived from. */
export interface EditionKeyInput {
  title?: string | null;
  display_title?: string | null;
  author?: string | null;
  year?: number | null;
  published?: string | null;
}

export interface EditionKeyParts {
  title: string;
  author: string;
  year: number | null;
  volume: number | null;
}

export interface EditionKeyResult {
  /** null when the book carries no usable title — never key on a stub. */
  key: string | null;
  quality: EditionKeyQuality | null;
  parts: EditionKeyParts;
  /** Set only when `key` is null: why the book is unkeyable. */
  reason?: 'no-title' | 'title-too-short' | 'title-uninformative';
}

/**
 * Titles that carry no identity. Keying on these merges unrelated books —
 * "untitled" is not a title, it is the absence of one.
 */
const UNINFORMATIVE_TITLES = new Set([
  'unknown',
  'untitled',
  'no title',
  'title unknown',
  'manuscript',
  'ms',
  'miscellany',
  'fragment',
  'fragments',
]);

/**
 * A normalized title shorter than this is too generic to assert an edition on.
 * Matches the `normTitle.length >= 5` guard tier 2 of `dedup.ts` already uses.
 */
const MIN_TITLE_LENGTH = 5;

/**
 * Scripts that write without spaces, where a title is meaningful at 2–3
 * characters (營造法式 is a complete, specific title in four). Applying the
 * Latin five-character floor to these throws away real titles.
 */
const DENSE_SCRIPT = /[　-鿿豈-﫿぀-ヿ가-힯]/;

/**
 * Title normalization for keying.
 *
 * NOT `dedup.ts`'s `normalizeTitle()`, and the difference is load-bearing: that
 * one strips `[^\w\s]`, and JS `\w` without the `u` flag is `[A-Za-z0-9_]`. So
 * every title written in a non-Latin script normalizes to the EMPTY STRING —
 * 營造法式, བཀའ་འགྱུར, كتاب الشفاء, Ἰλιάς and Тайная доктрина all become "". Measured
 * on this corpus 2026-08-07: 12,147 of 79,715 non-artwork books (15%) were
 * unkeyable for that reason alone, i.e. the Chinese, Tibetan, Arabic, Greek and
 * Cyrillic holdings would have had no edition layer at all.
 *
 * This version keeps any Unicode letter or number and is otherwise identical —
 * on Latin input it returns exactly what `normalizeTitle()` returns, which is
 * what keeps the cluster metric comparable to the pre-existing baseline.
 *
 * (`dedup.ts` itself has the same defect for the same reason. Fixing it there
 * would rewrite every stored `normalized_title` and change import-time dedup
 * behaviour corpus-wide — a separate, bigger change. Tracked, not smuggled in
 * here.)
 */
export function normalizeEditionTitle(title?: string | null): string {
  return String(title || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(the|a|an|der|die|das|de|le|la|les|il|lo|gli|i|el|los|las)\s+/i, '')
    .replace(/\s*[([:]?\s*(vol\.?\s*\d+|tomus?\s*\d+|part\.?\s*\d+|band\s*\d+|tome?\s*\d+)[)\]]?\s*$/i, '')
    .replace(/[^\p{L}\p{N}\s_]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Author surname, for keying.
 *
 * Surname-only rather than `normalizeAuthor()` (which sorts every token) because
 * catalogue records disagree wildly on the given-name tail — "Lobel, Matthias
 * de" / "Matthias de Lobel" / "Lobel, M." are one printer's one author, and a
 * whole-name key splits them into three editions. The cost is that two distinct
 * Smiths of the same title and year collide; the year and title carry enough
 * discrimination that this is rare, and the queue is human-reviewed.
 */
export function editionSurname(author?: string | null): string {
  const cleaned = String(author || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // life dates in parens: "Author (1500-1560)"
    .replace(/\s*\([\d\s\-–,?.]+\)\s*/g, '')
    .replace(/[^\w\s,]/g, '')
    .trim();
  if (!cleaned) return '';
  // "Surname, Forename" is the catalogue norm; otherwise take the last token.
  return cleaned.includes(',') ? cleaned.split(',')[0].trim() : cleaned.split(/\s+/).pop() || '';
}

/**
 * Build the edition key for a book. Pure — no I/O, safe to call at import time
 * and in a backfill sweep over 100k documents.
 */
export function buildEditionKey(book: EditionKeyInput): EditionKeyResult {
  const rawTitle = book.title || book.display_title || '';
  const title = normalizeEditionTitle(rawTitle);
  const author = editionSurname(book.author);
  const year = editionYear(book);
  // normalizeTitle() STRIPS volume markers, so read the volume off the raw
  // title — otherwise every volume of a set keys as the same edition, which is
  // exactly the 456-vs-296 discrepancy this layer exists to settle.
  const volume = extractVolume(book.display_title) ?? extractVolume(book.title) ?? null;
  const parts: EditionKeyParts = { title, author, year, volume };

  if (!title) return { key: null, quality: null, parts, reason: 'no-title' };
  const minLength = DENSE_SCRIPT.test(title) ? 2 : MIN_TITLE_LENGTH;
  if (title.length < minLength) return { key: null, quality: null, parts, reason: 'title-too-short' };
  if (UNINFORMATIVE_TITLES.has(title)) return { key: null, quality: null, parts, reason: 'title-uninformative' };

  const quality: EditionKeyQuality =
    author && year != null ? 'full' : author ? 'no-year' : year != null ? 'no-author' : 'title-only';

  return {
    key: `${title}|${author}|${year ?? ''}|v${volume ?? ''}`,
    quality,
    parts,
  };
}

/**
 * True when a stored key is safe for a reader-facing surface ("other scans of
 * this edition"). Anything below `full` is a review-queue signal only.
 */
export function isTrustedEditionKey(quality?: string | null): boolean {
  return quality === 'full';
}

// ---------------------------------------------------------------------------
// External edition authorities
// ---------------------------------------------------------------------------

/**
 * `edition` — the external record is verified to describe THIS printing, so it
 *   is an authority: two books sharing it are the same edition by fiat, no
 *   heuristic involved.
 * `unverified` — we hold the identifier but cannot show it is edition-level
 *   rather than work-level. Preserved (it is real provenance and a re-check
 *   target) but never trusted as identity.
 */
export type UstcScope = 'edition' | 'unverified';

export interface UstcLink {
  ustc: string;
  scope: UstcScope;
  reason: string;
}

interface UstcMatchRecord {
  ustc_year?: number | string | null;
  confidence?: string | null;
}

export interface UstcInput extends EditionKeyInput {
  ustc_id?: number | string | null;
  ustc_match?: UstcMatchRecord | null;
}

/**
 * Resolve a book's USTC identifier into an edition-level link, or an explicitly
 * untrusted one.
 *
 * #3260 assumed "where USTC coverage applies the USTC number IS the edition
 * authority." True of USTC itself, NOT true of what we stored: the AI matcher
 * (`ustc_match.match_method: 'ai_tool_calling'`) was willing to match a book to
 * a *different printing of the same work* and say so in its own reasoning —
 * e.g. Hellwig's `Curiosa physica`, our copy dated 1714, matched to USTC 2814137
 * dated 1700 with the note "the library book is a later edition of the same
 * work." Treating that id as an edition authority would assert that a 1714
 * printing and a 1700 printing are one edition.
 *
 * So an id is promoted to `edition` scope only on positive proof: the match
 * record carries the USTC record's own year and it agrees with ours. Measured
 * 2026-08-07 that is a small minority (36 of 4,300 rows even carry
 * `ustc_year`), which is the honest state of the data — the remaining ~4,264
 * need their years re-fetched from USTC before they can carry authority.
 */
export function ustcEditionLink(book: UstcInput): UstcLink | null {
  const raw = book.ustc_id;
  if (raw == null || raw === '') return null;
  const ustc = String(raw).trim();
  if (!ustc) return null;

  const match = book.ustc_match;
  const confidence = String(match?.confidence || '').toLowerCase();
  if (confidence === 'low') {
    return { ustc, scope: 'unverified', reason: 'matcher self-reported low confidence' };
  }

  const ustcYear = match?.ustc_year == null ? null : parseInt(String(match.ustc_year), 10);
  if (ustcYear == null || Number.isNaN(ustcYear)) {
    return { ustc, scope: 'unverified', reason: 'match record carries no USTC year to compare' };
  }

  const bookYear = editionYear(book);
  if (bookYear == null) {
    return { ustc, scope: 'unverified', reason: 'book has no year to compare' };
  }
  if (bookYear !== ustcYear) {
    return {
      ustc,
      scope: 'unverified',
      reason: `year disagreement (book ${bookYear} vs USTC ${ustcYear}) — work-level match, not edition-level`,
    };
  }

  return { ustc, scope: 'edition', reason: `year verified (${bookYear})` };
}
