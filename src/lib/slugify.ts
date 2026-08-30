/**
 * Slug generation for books.
 *
 * Format: {sanitized-display-title}-{author-last-name}
 * Example: "atalanta-fugiens-maier"
 *
 * Uses display_title (English) when available, falls back to title (original).
 * Author last name extracted from the author field.
 */

/**
 * Generate a URL-safe slug from a book's title and author.
 */
export function generateBookSlug(
  title: string,
  author: string,
  displayTitle?: string | null
): string {
  const titleSource = displayTitle || title;
  const slugTitle = slugifyText(titleSource, 60);
  const authorLast = extractLastName(author);
  const slugAuthor = slugifyText(authorLast, 20);

  if (!slugAuthor || slugAuthor === 'unknown') {
    return slugTitle || 'untitled';
  }

  // slugifyText keeps only [a-z0-9], so a title written entirely in Greek,
  // Hebrew, Japanese, Chinese, Tibetan or Sanskrit sanitizes to the empty
  // string. Interpolating that produced a leading-hyphen slug — a Greek work
  // edited by Markos Mousouros became "/book/-mousouros". Fall back to the
  // author alone (generateUniqueBookSlug then suffixes collisions), so a
  // non-Latin title degrades to a plain readable segment instead of a broken
  // one. Prefer giving these books an English `display_title`: the generator
  // reads it first, and it produces a genuinely descriptive slug.
  if (!slugTitle) {
    return slugAuthor;
  }

  return `${slugTitle}-${slugAuthor}`;
}

/**
 * Is this slug a placeholder or a malformed leftover rather than a real,
 * readable URL segment?
 *
 * Catches: missing/empty, the literal string "undefined", the "untitled"
 * family, and anything with no Latin letter at all — the class that produced
 * ~85 visible books sitting at URLs like /book/-10 and /book/-13, written by
 * an import that bypassed generateBookSlug entirely.
 *
 * Used by the repair sweep and by the enrichment path that regenerates a slug
 * once a book finally has a display_title.
 */
export function isPlaceholderSlug(slug: string | null | undefined): boolean {
  if (!slug) return true;
  if (slug === 'undefined' || slug === 'null') return true;
  if (/^untitled(-|$)/.test(slug)) return true;
  return !/[a-z]/.test(slug);
}

/**
 * Latin letters that are NOT a base letter plus a combining mark, so NFD cannot
 * decompose them and the `[^a-z0-9]` strip below DELETES them outright.
 *
 * That silent deletion lands hardest on exactly this library's corpus:
 * `Ægyptiaca` slugged to `gyptiaca`, `iustitiæ christianæ quæ` to
 * `iustiti christian qu`, `Œuvres` to `uvres`, and `Straßburg` to `stra-burg` —
 * where the deletion also SPLIT the word, because a run of non-matching characters
 * collapses to a single hyphen.
 *
 * `ſ` (long s) is here deliberately: early-modern printing uses it throughout, and
 * `ſuper` losing its first letter is worse than a diacritic dropping an accent.
 *
 * Keyed on the LOWERCASE form — `.toLowerCase()` runs before this map and folds
 * Æ→æ, Œ→œ, ẞ→ß, so uppercase inputs are already covered.
 */
const LATIN_TRANSLITERATIONS: Record<string, string> = {
  'æ': 'ae', 'œ': 'oe', 'ß': 'ss',
  'ø': 'o', 'þ': 'th', 'ð': 'd', 'ł': 'l', 'đ': 'd',
  'ħ': 'h', 'ı': 'i', 'ĸ': 'k', 'ŋ': 'n', 'ſ': 's',
};
const TRANSLITERATION_RE = new RegExp(`[${Object.keys(LATIN_TRANSLITERATIONS).join('')}]`, 'g');

/**
 * Sanitize text into a URL-safe slug segment.
 * - Lowercases
 * - Strips diacritics (ü → u, é → e)
 * - Transliterates non-decomposable Latin letters (æ → ae, ß → ss)
 * - Replaces non-alphanumeric with hyphens
 * - Collapses multiple hyphens
 * - Trims to maxLength at a word boundary
 *
 * Non-Latin scripts (Greek, Hebrew, CJK, Tibetan…) still sanitize to nothing — that is
 * the deliberate behaviour `generateBookSlug` handles by falling back to the author
 * segment. This map only rescues Latin letters a reader expects to survive.
 */
function slugifyText(text: string, maxLength: number): string {
  let slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    // Must run BEFORE the [^a-z0-9] strip, or these letters are already gone.
    .replace(TRANSLITERATION_RE, (ch) => LATIN_TRANSLITERATIONS[ch])
    .replace(/[^a-z0-9]+/g, '-')    // non-alphanum → hyphen
    .replace(/^-+|-+$/g, '')         // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-');         // collapse double hyphens

  // Trim at word boundary
  if (slug.length > maxLength) {
    slug = slug.substring(0, maxLength);
    const lastHyphen = slug.lastIndexOf('-');
    if (lastHyphen > maxLength * 0.5) {
      slug = slug.substring(0, lastHyphen);
    }
  }

  return slug;
}

/**
 * Extract the last name from an author string.
 * Handles: "Michael Maier", "Maier, Michael", "Johann Daniel Mylius"
 */
function extractLastName(author: string): string {
  // "Unknown" in any of its forms is the absence of an author, not a surname.
  // The old exact match let "Unknown artist" through, and the last-word rule
  // then suffixed those books with "-artist" (/book/…-osu-kannon-artist).
  // "Anonymous" is deliberately NOT folded in here — it is kept in the slug,
  // pinned by tests/unit/slugify.test.ts.
  if (!author || /^unknown\b/i.test(author.trim())) {
    return 'unknown';
  }
  if (author === 'Anonymous') {
    return 'anonymous';
  }

  // "Last, First" format
  if (author.includes(',')) {
    return author.split(',')[0].trim();
  }

  // "First Last" format — take last word
  const parts = author.trim().split(/\s+/);
  return parts[parts.length - 1];
}

/**
 * Append a numeric suffix to make a slug unique.
 * "atalanta-fugiens-maier" → "atalanta-fugiens-maier-2"
 */
export function appendSlugSuffix(slug: string, n: number): string {
  return `${slug}-${n}`;
}

/**
 * Generate a unique slug for a book, checking the database for collisions.
 * Appends -2, -3, etc. if the base slug already exists.
 */
export async function generateUniqueBookSlug(
  db: { collection: (name: string) => { findOne: (filter: Record<string, unknown>, options?: Record<string, unknown>) => Promise<unknown> } },
  title: string,
  author: string,
  displayTitle?: string | null
): Promise<string> {
  const baseSlug = generateBookSlug(title, author, displayTitle);

  // Check if base slug is available
  const existing = await db.collection('books').findOne(
    { slug: baseSlug },
    { projection: { _id: 1 } }
  );
  if (!existing) return baseSlug;

  // Find next available suffix
  let suffix = 2;
  while (suffix < 100) {
    const candidate = appendSlugSuffix(baseSlug, suffix);
    const conflict = await db.collection('books').findOne(
      { slug: candidate },
      { projection: { _id: 1 } }
    );
    if (!conflict) return candidate;
    suffix++;
  }

  // Extremely unlikely fallback
  return `${baseSlug}-${Date.now()}`;
}

/**
 * Centralized book URL construction. Always returns /book/{slug-or-id}.
 *
 * Book URLs are tenant-agnostic: the tenant slug never appears in the address
 * bar. The proxy resolves the tenant internally from the book itself and
 * rewrites the request to the [tenant]/book/[id] route. Tenant fields on the
 * input are accepted (and ignored) for call-site compatibility.
 */
export function bookUrl(book: { slug?: string; id: string; tenantSlug?: string | null; tenant_slug?: string | null }): string {
  return `/book/${book.slug || book.id}`;
}

/**
 * Alias of bookUrl() that accepts a tenantSlug for call-site compatibility.
 * The tenantSlug argument is intentionally ignored — see bookUrl().
 */
export function tenantBookUrl(
  book: { slug?: string; id: string },
  _tenantSlug?: string | null
): string {
  return `/book/${book.slug || book.id}`;
}

/**
 * Reader URL for one page of a book: /book/<slug>/page/<pageId>.
 *
 * Use this wherever a book document (or anything carrying its slug) is in
 * scope, rather than interpolating a bare id. The proxy 301s the id form to
 * this one, so an id-built link still lands correctly — it just publishes an
 * unreadable URL into citations and chat until the redirect runs, and costs an
 * extra hop. Call sites that only ever hold a page's `book_id` (the gallery
 * image API, exhibition layouts) legitimately fall back to the redirect.
 *
 * The page segment stays a page *id*, not a printed page number: numbers go
 * missing, repeat, turn roman and shift on split scans, so the id is the
 * durable citation anchor. /book/<slug>/page/<number> is a supported input
 * alias that 301s here.
 */
export function readerPageUrl(book: { slug?: string | null; id: string }, pageId: string): string {
  return `/book/${book.slug || book.id}/page/${pageId}`;
}

export function collectionUrl(collection: { slug: string }): string {
  return `/collections/${collection.slug}`;
}

export function galleryImageUrl(image: { id: string; tenantSlug?: string | null; tenant_slug?: string | null }): string {
  const path = `/gallery/image/${image.id}`;
  const tenantSlug = image.tenantSlug || image.tenant_slug || null;
  return tenantSlug ? `/${tenantSlug}${path}` : path;
}

/**
 * Generate a URL for an author page.
 * Returns null for unknown/anonymous authors.
 */
export function authorSlug(author: string): string {
  return author
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/**
 * URL for a book's author page.
 *
 * Prefer `authorId` (`books.author_id`, the canonical FK) over the byline
 * string whenever it is present. The byline is what a CATALOGUE said; the
 * canonical link is who we decided that means, and the two diverge exactly
 * where it matters. Slugifying the byline sends every book bylined "Thomas" to
 * `/author/thomas` — Aquinas and Thomas à Kempis alike — so the reader is told
 * a work is by whoever that bare form happens to resolve to (#4318).
 *
 * It also makes the link independent of the thesaurus's MATCH surface. Bare
 * forenames had to be withdrawn from `variants[]` because they claimed every
 * namesake; a byline-derived URL would then dead-end, while `author_id` keeps
 * pointing at the right person.
 */
export function authorUrl(author: string, authorId?: string | null): string | null {
  if (authorId) return `/author/${authorId}`;
  if (!author || author === 'Unknown' || author === 'Anonymous') return null;
  return `/author/${authorSlug(author)}`;
}

/** Artist page URL — same slug logic as authors */
export function artistUrl(artist: string): string | null {
  if (!artist || artist === 'Unknown' || artist === 'Anonymous') return null;
  return `/artist/${authorSlug(artist)}`;
}
