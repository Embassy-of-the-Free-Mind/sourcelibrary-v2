/**
 * Citation link repair — shared between the Librarian server (which computes
 * fixes after verifying citations) and the chat clients (which apply the same
 * fixes to already-streamed text).
 *
 * A "fix" rewrites every https://sourcelibrary.org/book/<fromSlug> link in a
 * response to point at <toSlug> — the edition we actually hold. Any page
 * suffix (?page=N, /page-number/N, /page/<id>) is deliberately DROPPED in the
 * rewrite: the page number was cited against a book that doesn't exist (or
 * isn't public), so carrying it onto a different edition would deep-link to
 * the wrong page. Landing on the book page is honest; page 427 of the wrong
 * edition is a misquote.
 *
 * Client-safe: no server imports.
 */

export interface CitationFix {
  fromSlug: string;
  toSlug: string;
  /** Display title of the replacement book (for logging/debugging). */
  toTitle?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Apply citation fixes to a response text. Matches the base book URL plus any
 * page suffix, bounded so a slug that prefixes another slug can't match it
 * (e.g. a fix for `corpus-hermeticum` must not touch
 * `corpus-hermeticum-with-pneumatica-...`).
 */
export function applyCitationFixes(text: string, fixes: CitationFix[]): string {
  let out = text;
  for (const fix of fixes) {
    if (!fix?.fromSlug || !fix?.toSlug || fix.fromSlug === fix.toSlug) continue;
    const pattern = new RegExp(
      `https://sourcelibrary\\.org/book/${escapeRegex(fix.fromSlug)}(?![a-z0-9-])` +
      `(?:\\?page=\\d+|/page-number/\\d+|/page/[A-Za-z0-9-]+)?`,
      'g',
    );
    out = out.replace(pattern, `https://sourcelibrary.org/book/${fix.toSlug}`);
  }
  return out;
}
