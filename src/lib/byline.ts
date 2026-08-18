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
import { institutionalByline, type InstitutionalByline } from './corporate-bylines';

export interface BylineInput {
  author?: string | null;
  editor?: string | null;
}

export type BylineRole = 'author' | 'editor' | 'unknown';

export interface EffectiveByline {
  /** Display name to render. Empty string when both author and editor are missing. */
  displayName: string;
  /**
   * Which field supplied displayName. 'unknown' = no real attribution available.
   *
   * NOTE this stays a THREE-value union on purpose. Two surfaces in
   * `src/app/book/[id]/page.tsx` branch on `role === 'author' | 'editor'` and
   * render nothing otherwise, so widening it here would silently blank the
   * byline on the standard book page. The organisation's relation is carried
   * alongside, in `institutional`, which is additive and cannot break a
   * consumer that ignores it.
   */
  role: BylineRole;
  /**
   * Set when the byline names an ORGANISATION rather than a person, with the
   * relation it actually has to the book — author, issuer, holder, or a
   * collective work with no single author. Null for personal authors, which is
   * almost every book. See `corporate-bylines.ts` for why the edge needs typing
   * separately from the node.
   */
  institutional: InstitutionalByline | null;
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
      institutional: institutionalByline(rawAuthor),
      isEditor: false,
      editor: rawEditor,
      author: rawAuthor,
    };
  }
  if (rawEditor) {
    return {
      displayName: rawEditor,
      role: 'editor',
      institutional: institutionalByline(rawEditor),
      isEditor: true,
      editor: rawEditor,
      author: '',
    };
  }
  return {
    displayName: '',
    role: 'unknown',
    institutional: null,
    isEditor: false,
    editor: '',
    author: '',
  };
}
