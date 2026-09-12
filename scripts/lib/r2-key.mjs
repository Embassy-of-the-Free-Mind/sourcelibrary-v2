/**
 * R2 key validation — the guard for the "shared undefined key" class of bug (#3362).
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-03-31 `archive-bulk.mjs` built its page list with a projection that
 * omitted `book_id`, then interpolated `page.book_id` (undefined) into the R2
 * key. Every archived page went to `archived/undefined/<page_number>.jpg` and
 * `pages/undefined/<NNNN>.jpg` — a SINGLE, BOOK-INDEPENDENT object per page
 * number that every concurrently-archiving book overwrote. The page docs'
 * `archived_photo` pointed at that shared key.
 *
 * The damage was not the broken images (those were noticed and fixed on
 * 2026-04-04, da1c221c / b2786b10). The damage was that OCR ran against those
 * URLs first and faithfully transcribed *other books' pages* into hundreds of
 * books, which then propagated into translations. Nothing failed loudly: R2
 * returned a real, complete, 200-OK JPEG, so every "fail closed if the fetch
 * fails" check passed. See `archived/undefined/31.jpg` — still 200 today.
 *
 * THE INVARIANT
 * -------------
 * A page-image key must be *book-scoped*: it must contain the owning book's id.
 * A key that does not is, by construction, shared between books — which is
 * always a bug, whether the cause is `undefined`, an empty string, or a
 * hand-built path that forgot the id.
 *
 * Validate at the moment of upload, not at the call site. There are 40+ scripts
 * with their own `uploadToR2`, and guarding them one at a time is how the same
 * bug shipped twice (archive-bulk.mjs, then archive-ia-bulk.mjs two days later).
 */

/** Segments that mean "an interpolation went wrong", not a real path component. */
const BAD_SEGMENT = /(?:^|\/)(undefined|null|NaN|)(?=\/|$)/;

/**
 * Throw if an R2 key contains an undefined/null/NaN/empty path segment.
 *
 * @param {string} key - The R2 object key (e.g. `archived/<bookId>/12.jpg`)
 * @param {string} [context] - Optional caller label for the error message
 */
export function validateR2Key(key, context = '') {
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

/**
 * Throw unless the key is scoped to the given book id.
 *
 * Stronger than validateR2Key: catches the case where the id is present but
 * belongs to a *different* book (a projection that carried the wrong doc), and
 * the case where a key is well-formed but book-independent.
 *
 * @param {string} key - The R2 object key
 * @param {string} bookId - The id of the book the key must belong to
 * @param {string} [context] - Optional caller label for the error message
 */
export function assertBookScopedKey(key, bookId, context = '') {
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

/**
 * True when a stored image URL is book-scoped for the given book.
 * Read-side twin of assertBookScopedKey, for audits over existing data.
 *
 * @param {string|null|undefined} url - A stored image URL
 * @param {string} bookId - The owning book's id
 */
export function isBookScopedUrl(url, bookId) {
  if (typeof url !== 'string' || !url.startsWith('http')) return true; // not our concern
  // A shared-key segment is always wrong, under any prefix.
  if (/\/(undefined|null|NaN)\//.test(url)) return false;
  // Only judge our own page-image prefixes; other assets (gallery/, artwork/,
  // manuscripts/) are not book-scoped and must not be flagged.
  //
  // `cropped/` and `uploads/` were added for #4376. Leaving them out is what let
  // a mis-keyed cover — `cropped/<another book's id>/<page>.jpg` — sit in front
  // of a visible book while this helper called it fine. Both were measured over
  // the whole corpus first (2026-09-02): `uploads/` had zero mismatches, and
  // `cropped/` had exactly one book (69a02781bd4078a454714f6d, 372 pages, the
  // subject of #4376), so judging them costs no false positives.
  if (!/\/(archived|pages|thumbnails|cropped|uploads)\//.test(url)) return true;
  if (!bookId) return false;
  // The corpus carries several key conventions across eras (see src/lib/storage.ts):
  // `archived/<bookId>/<N>.jpg` and `archived/<bookId>-<NNNN>.jpg` are both real and
  // both book-scoped. Require the id to sit between delimiters rather than splitting
  // on them — book ids are sometimes UUIDs, which contain hyphens themselves.
  return new RegExp(`/${escapeRegExp(bookId)}(?=[/._-]|$)`).test(url);
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
