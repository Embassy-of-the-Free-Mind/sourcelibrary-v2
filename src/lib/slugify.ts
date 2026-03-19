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

  return `${slugTitle}-${slugAuthor}`;
}

/**
 * Sanitize text into a URL-safe slug segment.
 * - Lowercases
 * - Strips diacritics (ü → u, é → e)
 * - Replaces non-alphanumeric with hyphens
 * - Collapses multiple hyphens
 * - Trims to maxLength at a word boundary
 */
function slugifyText(text: string, maxLength: number): string {
  let slug = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
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
  if (!author || author === 'Unknown' || author === 'Anonymous') {
    return author?.toLowerCase() || 'unknown';
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
 * Centralized book URL construction. Use this everywhere instead of
 * manually building `/book/${book.id}`.
 */
export function bookUrl(book: { slug?: string; id: string }): string {
  return `/book/${book.slug || book.id}`;
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

export function authorUrl(author: string): string | null {
  if (!author || author === 'Unknown' || author === 'Anonymous') return null;
  return `/author/${authorSlug(author)}`;
}
