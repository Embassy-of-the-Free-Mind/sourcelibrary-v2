/**
 * Artist-slug matching — shared by `/artwork/artist/[slug]` and the
 * `artist=` filter on `/api/artwork/search` (#4509).
 *
 * Extracted so the page and the API cannot drift: an API filter that resolved
 * a different set than the page it mirrors would be worse than no filter,
 * because both look authoritative.
 */

/** Names that are cataloguing placeholders, not people. */
const NON_ARTIST_NAMES = ['Various', 'Unknown', 'Anonymous', 'Splendor Solis'];

export function isNonArtist(name: string): boolean {
  return NON_ARTIST_NAMES.some(n => name.toLowerCase().startsWith(n.toLowerCase()));
}

/**
 * Build the `books.author` match for an artist slug.
 *
 * Link builders write `author.replace(/\s+/g, '-')`, which makes a slug dash
 * AMBIGUOUS: it may stand for a space or for a real hyphen in the name
 * ("Abbas Al-Musavi" → "Abbas-Al-Musavi"). Turning every dash into a literal
 * space could never resolve hyphenated names — a real 404 class, logged
 * 2026-08. So each dash-or-space position matches either character.
 *
 * Returns null for a slug that resolves to nothing worth a page (empty, or a
 * placeholder like "Various").
 */
export function artistAuthorRegex(slug: string): { $regex: string; $options: string } | null {
  const decoded = decodeURIComponent(slug);
  if (isNonArtist(decoded.replace(/-/g, ' '))) return null;
  const tokens = artistTokens(slug);
  if (tokens.length === 0) return null;
  return { $regex: `^${tokens.join('[-\\s]+')}$`, $options: 'i' };
}

/**
 * The regex-escaped name tokens behind `artistAuthorRegex`. Exported because
 * `/artwork/artist/[slug]` also builds a REVERSED-name pattern from them
 * ("Albrecht Dürer" → "Dürer, Albrecht") when the forward form finds no books;
 * both callers must split identically or the two lookups disagree.
 */
export function artistTokens(slug: string): string[] {
  return decodeURIComponent(slug)
    .split(/[-\s]+/)
    .filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}
