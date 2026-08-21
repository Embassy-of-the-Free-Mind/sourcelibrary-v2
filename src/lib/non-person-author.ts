/**
 * Non-person author rendering (#3483).
 *
 * `scripts/maintenance/quarantine-non-person-authors.mjs` (#2179) flags entries
 * in the `authors` thesaurus that are not people — institutions, publisher
 * series, legal corpora, and cataloguer placeholders — with `is_person: false`.
 * The flag was written and applied but NOTHING in `src/` ever read it, so every
 * one of those pages rendered with full person framing: a portrait slot, life
 * dates, "Also known as", an "Artist page" link, and a schema.org `Person` node
 * telling search engines that "British Museum" and "Anonymous" are human beings.
 *
 * This module turns the flag into a rendering decision. It is deliberately a
 * pure function of the thesaurus doc so it can be tested without a database or
 * a rendered page.
 *
 * WHAT IT DOES NOT DO. It never hides the books. A quarantined doc is not a
 * mistake to be erased — a museum catalogue really is authored by the museum,
 * and 74 anonymous works are a listing a reader wants. What is wrong is only
 * the claim that the name belongs to a person. So the books stay, and the
 * person costume comes off.
 *
 * The separate case — a *work title* sitting in `books.author` because an
 * importer stamped its search query there — is a data defect, not a rendering
 * one, and is repaired at the source by
 * `scripts/maintenance/repair-work-title-authors-3483.mjs`. Once a book's bogus
 * author is cleared the page stops existing on its own, because these pages
 * only exist while books point at them.
 */

/** Kinds we distinguish, driven by `authors.quarantine_reason`. */
export type NonPersonKind =
  | 'institution'
  | 'work'
  | 'corpus'
  | 'series'
  | 'placeholder'
  | 'other';

/** How the schema.org graph should describe this heading. */
export type AuthorSchemaEntityType = 'Person' | 'Organization' | 'none';

export interface NonPersonAuthor {
  kind: NonPersonKind;
  /** Short badge under the heading, e.g. "Institution". */
  label: string;
  /**
   * Replaces the implicit "these are works by a person" framing. Written to be
   * true of every doc in the kind, since one string serves the whole class.
   */
  note: string;
  /** What the JSON-LD should emit instead of a `Person` node. */
  schemaEntityType: AuthorSchemaEntityType;
}

/** Minimal shape this module needs — a subset of `AuthorThesaurusDoc`. */
export interface NonPersonAuthorInput {
  is_person?: boolean;
  quarantine_reason?: string;
  merged_into?: string;
}

const BY_REASON: Record<string, NonPersonAuthor> = {
  institution: {
    kind: 'institution',
    label: 'Institution',
    note: 'An organisation credited as the author of these records.',
    schemaEntityType: 'Organization',
  },
  'title-not-author': {
    kind: 'work',
    label: 'Work title',
    note: 'A work title recorded in the author field. These records are associated with the work, not written by it.',
    schemaEntityType: 'none',
  },
  reference: {
    kind: 'work',
    label: 'Work title',
    note: 'A work title recorded in the author field. These records are associated with the work, not written by it.',
    schemaEntityType: 'none',
  },
  corpus: {
    kind: 'corpus',
    label: 'Collected work',
    note: 'A body of texts gathered under one title rather than a single author.',
    schemaEntityType: 'none',
  },
  'press-series': {
    kind: 'series',
    label: "Publisher's series",
    note: 'A series issued by one press. Each volume has its own author.',
    schemaEntityType: 'none',
  },
  placeholder: {
    kind: 'placeholder',
    label: 'No named author',
    note: 'These records carry no attribution. The heading is a cataloguing placeholder, not a name.',
    schemaEntityType: 'none',
  },
};

/**
 * A quarantined doc with no `quarantine_reason` — 5 of 59 today. Says the one
 * thing we actually know rather than guessing a kind from the name, which is
 * how a search term became an author in the first place (#3434).
 */
const UNCLASSIFIED: NonPersonAuthor = {
  kind: 'other',
  label: 'Not a personal name',
  note: 'A corporate or unattributed heading rather than an individual author.',
  schemaEntityType: 'none',
};

/**
 * Classify a resolved thesaurus doc, or return `null` when the page should keep
 * its normal person framing.
 *
 * Returns `null` for:
 *   - a person (`is_person` absent or true — absent is the overwhelming default,
 *     so the check must be `=== false`, never falsy);
 *   - a `merged_into` dedup tombstone, which the read path follows to its
 *     primary before rendering, so the doc reaching the page is the primary and
 *     the tombstone's own flag is irrelevant.
 */
export function classifyNonPersonAuthor(
  doc: NonPersonAuthorInput | null | undefined,
): NonPersonAuthor | null {
  if (!doc) return null;
  if (doc.is_person !== false) return null;
  if (doc.merged_into) return null;
  const reason = (doc.quarantine_reason || '').trim();
  return BY_REASON[reason] ?? UNCLASSIFIED;
}
