/**
 * Byline resolution — single source of truth for who gets credit on a book.
 *
 * Many BPH-imported records have `author: "Unknown"` because the catalogue
 * lists no single author for the publication (magazines, anthologies,
 * festschrifts, edited volumes). In those cases the editor is the
 * responsible party and should appear in the byline instead of "Unknown".
 *
 * This helper is UI-agnostic: it returns the effective display name and the
 * role that produced it (`author` or `editor`). Each surface formats the
 * prefix ("edited by", "ed.", JSON-LD `editor` vs `author`, etc.) itself.
 *
 * The literal string "Unknown" (case-insensitive) is the BPH import's
 * placeholder for missing authorship — treat it the same as null/empty.
 *
 * See PR #1684 (book detail hero) + follow-up #1682 (cards, citations, API).
 */
export interface BylineInput {
  author?: string | null;
  editor?: string | null;
}

export type BylineRole = 'author' | 'editor' | 'unknown';

export interface EffectiveByline {
  /** Display name to render. Empty string when both author and editor are missing. */
  displayName: string;
  /** Which field supplied displayName. 'unknown' = no real attribution available. */
  role: BylineRole;
  /** Convenience flag: true when the byline is sourced from the editor field. */
  isEditor: boolean;
  /** Raw editor value, trimmed — useful when both author and editor are present
   *  and a surface wants to render a secondary "edited by" credit. */
  editor: string;
  /** Raw author value, trimmed and stripped of the "Unknown" placeholder. */
  author: string;
}

const UNKNOWN_RE = /^unknown$/i;

function clean(value: string | null | undefined): string {
  if (!value) return '';
  return value.trim();
}

function isRealAuthor(value: string): boolean {
  if (!value) return false;
  return !UNKNOWN_RE.test(value);
}

/**
 * Resolve the byline for a book.
 *
 * Fallback order: author → editor → "" (caller decides the literal fallback,
 * e.g. "Unknown" for table cells or omit entirely for citations).
 */
export function getEffectiveByline(book: BylineInput): EffectiveByline {
  const rawAuthor = clean(book.author);
  const rawEditor = clean(book.editor);
  const realAuthor = isRealAuthor(rawAuthor);

  if (realAuthor) {
    return {
      displayName: rawAuthor,
      role: 'author',
      isEditor: false,
      editor: rawEditor,
      author: rawAuthor,
    };
  }
  if (rawEditor) {
    return {
      displayName: rawEditor,
      role: 'editor',
      isEditor: true,
      editor: rawEditor,
      author: '',
    };
  }
  return {
    displayName: '',
    role: 'unknown',
    isEditor: false,
    editor: '',
    author: '',
  };
}
