/**
 * R2 key validation — TS twin of `scripts/lib/r2-key.mjs`.
 *
 * Guards the "shared undefined key" class of bug (#3362): a missing
 * interpolation turns a book-scoped page key into ONE object shared by every
 * book, which OCR then transcribes into the wrong books. Nothing fails loudly —
 * R2 serves a real 200-OK JPEG — so this must be caught at write time.
 *
 * Keep in lockstep with the .mjs twin; `tests/unit/r2-key.test.ts` pins parity.
 */

/** Segments that mean "an interpolation went wrong", not a real path component. */
const BAD_SEGMENT = /(?:^|\/)(undefined|null|NaN|)(?=\/|$)/;

/** Throw if an R2 key contains an undefined/null/NaN/empty path segment. */
export function validateR2Key(key: string, context = ''): void {
  const where = context ? ` (${context})` : '';
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error(`R2 key is not a non-empty string${where}: ${JSON.stringify(key)}`);
  }
  if (BAD_SEGMENT.test(key)) {
    throw new Error(
      `R2 key contains an invalid segment${where}: "${key}" — ` +
      `a missing interpolation would write to a key shared across books (see #3362)`
    );
  }
}

/** Throw unless the key is scoped to the given book id. */
export function assertBookScopedKey(key: string, bookId: string, context = ''): void {
  validateR2Key(key, context);
  const where = context ? ` (${context})` : '';
  if (!bookId || typeof bookId !== 'string') {
    throw new Error(`bookId is missing${where}: ${JSON.stringify(bookId)} for key "${key}"`);
  }
  // Delimiter-aware, NOT a bare segment match — the corpus carries several
  // book-scoped conventions and `key.split('/').includes(bookId)` rejected two
  // of them: `archived/<bookId>-<NNNN>.jpg` (documented as valid in
  // isBookScopedUrl below) and `book-thumbnails/<bookId>.jpg` (~4,634 objects
  // written by migrate-book-thumbnails-to-r2.mjs). This is the same test the
  // read-side twin applies, so a key that passes the write guard is one the
  // audit will also call book-scoped.
  if (!new RegExp(`(?:^|/)${escapeRegExp(bookId)}(?=[/._-]|$)`).test(key)) {
    throw new Error(
      `R2 key is not scoped to its book${where}: "${key}" does not contain bookId "${bookId}" — ` +
      `book-independent page keys are shared between books (see #3362)`
    );
  }
}

/** Read-side twin, for audits over existing stored URLs. */
export function isBookScopedUrl(url: string | null | undefined, bookId: string): boolean {
  if (typeof url !== 'string' || !url.startsWith('http')) return true;
  // A shared-key segment is always wrong, under any prefix.
  if (/\/(undefined|null|NaN)\//.test(url)) return false;
  // Only judge our own page-image prefixes; other assets (gallery/, artwork/,
  // manuscripts/) are not book-scoped and must not be flagged.
  //
  // `cropped/` and `uploads/` were added for #4376 — leaving them out let a
  // `cropped/<another book's id>/<page>.jpg` cover pass as fine. Both measured
  // corpus-wide first (2026-09-02): `uploads/` zero mismatches, `cropped/` one
  // book. Keep in lockstep with the .mjs twin.
  if (!/\/(archived|pages|thumbnails|cropped|uploads)\//.test(url)) return true;
  if (!bookId) return false;
  // Both `archived/<bookId>/<N>.jpg` and `archived/<bookId>-<NNNN>.jpg` are real,
  // book-scoped conventions here. Require the id to sit between delimiters rather
  // than splitting on them — book ids are sometimes UUIDs, which contain hyphens.
  return new RegExp(`/${escapeRegExp(bookId)}(?=[/._-]|$)`).test(url);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
