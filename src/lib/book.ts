import type { Book } from './types/book';

/**
 * True when a book makes the "first translation" bibliographic claim AND has at
 * least one translated page rendered. `is_first_translation` is set by batch
 * scripts before translation lands, so render gates must also check
 * `pages_translated > 0` to avoid badging unreadable books.
 *
 * See `.claude/docs/embeddings.md` and the "Visibility & Stats Invariants" in
 * CLAUDE.md (lesson `lesson_is_first_translation_gate`).
 */
export const isPublishedFirstTranslation = (
  b: Pick<Book, 'is_first_translation' | 'pages_translated'>,
): boolean => !!b.is_first_translation && (b.pages_translated ?? 0) > 0;
