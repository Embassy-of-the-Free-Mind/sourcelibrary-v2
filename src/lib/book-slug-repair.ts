/**
 * book-slug-repair — can this book's placeholder URL actually be repaired today?
 *
 * WHY THIS IS ONE MODULE AND NOT TWO COPIES
 * `isPlaceholderSlug` answers "is this URL broken?", and the answer for 39
 * visible books is yes. But "broken" and "fixable" are different questions, and
 * conflating them made the detector useless: it fired on all 39, the repair
 * sweep could fix 0 of them, and because the workflow keeps one open issue at a
 * time (corpus-integrity-watch.yml), a permanently-red finding meant the NEXT
 * importer to bypass generateBookSlug would file nothing at all. The alarm the
 * detector exists for was masked by its own backlog (#4521).
 *
 * So the triage lives here, imported by both the sweep
 * (scripts/maintenance/repair-book-slugs.ts) and the detector
 * (scripts/audit/book-slug-placeholders.ts), rather than being implemented once
 * in each. Two copies of a rule this fiddly drift, and the drift is invisible:
 * a detector that disagrees with its own repair tool reports work that cannot
 * be done, which is exactly the failure being fixed. Same reasoning as
 * scripts/lib/gutter-clip.mjs being shared by its audit and its sweep.
 *
 * WHAT MAKES A PLACEHOLDER REPAIRABLE
 * Only that generateBookSlug can build a readable segment from what the record
 * already holds. That is a question about the DATA, not about the slug: a
 * Japanese print signed "Katsushika Hokusai" is repairable (the author is
 * Latin-script), while 大乘百法明門論疏 by 義忠 is not — there is nothing on the
 * record to put in a URL, and no slug logic can invent it. Those need an
 * English display_title first (#4390), which then yields a slug describing the
 * work rather than naming its maker.
 */
import { generateBookSlug, isGenericAuthor, isPlaceholderSlug } from './slugify';

/**
 * Books held back on editorial grounds: the author fallback would publish a
 * WRONG name, so no slug beats the one the sweep would mint.
 *
 * extractLastName takes the final word of an unpunctuated author, which is the
 * surname in Western order and the GIVEN name in Chinese order. Right for
 * "Katsushika Hokusai" (an art name), wrong for "Qiu Ying" (family name Qiu).
 * Corpus-wide name-order handling is its own change; until then these belong
 * with the #4390 tail, which will give them a slug describing the work.
 *
 * Recorded here rather than in the sweep so the detector agrees: a book the
 * sweep refuses to touch must not be reported as repairable work.
 */
export const SLUG_REPAIR_HOLDBACK = new Set<string>([
  // 漢宮春曉 handscroll, Qiu Ying — the author fallback gives /book/ying.
  '69e53627ce6791c1bca7d814',
]);

export type SlugRepairBlocker =
  /** Editorial holdback — see SLUG_REPAIR_HOLDBACK. */
  | 'held-back'
  /** Nothing Latin-script in title OR author. Needs an English title (#4390). */
  | 'needs-english-title'
  /** The slug already says everything the record says. Needs real metadata. */
  | 'no-gain';

export interface SlugRepairVerdict {
  /** `true` when the sweep can write a readable slug from today's data. */
  repairable: boolean;
  /** The slug to write, before uniqueness reservation. Null when blocked. */
  slug: string | null;
  /** Why not, when blocked. Null when repairable. */
  blockedBy: SlugRepairBlocker | null;
  /** One line naming the reason, for a report or a skip log. */
  reason: string;
}

export interface SlugRepairInput {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  display_title?: string | null;
  author?: string | null;
}

/**
 * Triage one book whose slug `isPlaceholderSlug` has already flagged.
 *
 * Callers pass any book; a book with a perfectly good slug comes back
 * `repairable: false, blockedBy: null` — nothing to do is not a blocker.
 */
export function classifySlugRepair(book: SlugRepairInput): SlugRepairVerdict {
  const title = book.display_title || book.title || '';

  if (!isPlaceholderSlug(book.slug)) {
    return { repairable: false, slug: null, blockedBy: null, reason: 'slug is already readable' };
  }

  const id = book.id || '';
  if (id && SLUG_REPAIR_HOLDBACK.has(id)) {
    return {
      repairable: false,
      slug: null,
      blockedBy: 'held-back',
      reason: 'held back deliberately — the author fallback would publish a wrong name',
    };
  }

  const base = generateBookSlug(book.title || '', book.author || '', book.display_title);

  // generateBookSlug falls back to the author, then to "untitled". Landing on a
  // placeholder anyway means there is no Latin-script text ANYWHERE on the
  // record — moving the book from one meaningless URL to another is not a
  // repair.
  if (isPlaceholderSlug(base)) {
    return {
      repairable: false,
      slug: null,
      blockedBy: 'needs-english-title',
      reason: 'no Latin-script title or author to build from — needs an English display_title (#4390)',
    };
  }

  // A book that ALREADY has a URL only earns a rename if the new slug says
  // something the old one didn't. Title "216" sanitizes to itself, so
  // /book/216 would become /book/216-anonymous: a changed public URL, no new
  // information, and a redirect to maintain forever. The author half of this
  // test is load-bearing — dropping it is what stranded seven books whose
  // artist was sitting one field over (#4521).
  const titleHasLetters = /[a-z]/i.test(title.normalize('NFD').replace(/[̀-ͯ]/g, ''));
  if (book.slug && !titleHasLetters && isGenericAuthor(book.author)) {
    return {
      repairable: false,
      slug: null,
      blockedBy: 'no-gain',
      reason: 'slug already says what the record says — needs real metadata, not a new slug (#4390)',
    };
  }

  return { repairable: true, slug: base, blockedBy: null, reason: '' };
}
