// Client-safe contributor types + role vocabulary. Kept separate from
// bph-catalog.ts (which imports mongodb/supabase) so 'use client' components
// can import these without dragging server-only modules into the browser
// bundle. bph-catalog.ts re-exports them for server-side use.

/**
 * Contributor roles for early-modern books, anticipating a book-historian's
 * needs (Paul Dijstelberge). The lead author still lives in the scalar `author`
 * field; this vocabulary covers the repeatable additional contributors.
 */
export const BPH_CONTRIBUTOR_ROLES = [
  'Author',
  'Editor',
  'Translator',
  'Commentator',
  'Compiler',
  'Engraver',
  'Illustrator',
  'Dedicatee',
  'Contributor',
  'Other',
] as const;

export type BphContributorRole = (typeof BPH_CONTRIBUTOR_ROLES)[number];

/** One entry in `bph_works.contributors` (JSONB array). */
export interface BphContributor {
  role: string;
  /** Name as catalogued (standard form). */
  name: string;
  /** Name as printed on the title page, if it differs. */
  variant_name?: string;
  /** Canonical `authors._id` (slug) when linked to our thesaurus. */
  author_id?: string | null;
  /** Denormalised canonical name for display without a join. */
  canonical_name?: string | null;
}
