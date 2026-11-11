/**
 * What a 404 page can still do for the reader who followed a link to a book or
 * author we hold under another name.
 *
 * PRIOR ART: src/lib/embassy/citation-fixes.ts repairs links inside a Librarian
 * answer, and only reaches a reader whose stream delivered its `citation_fixes`
 * event. This works at the destination, so it also covers a missed event, an
 * unrepairable slug, a copied link and other clients (#8216).
 *
 * Client-safe: no server imports.
 */

import { PREFIXED_LOCALES } from '@/lib/locale-path';

export type DeadContentKind = 'book' | 'author' | 'artwork' | 'collection';

export interface DeadContentLink {
  kind: DeadContentKind;
  slug: string;
}

/** Slugs a resolver may be asked about: lowercase catalogue form, bounded length. */
export function isResolvableSlug(slug: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && slug.length >= 3 && slug.length <= 200;
}

const LOCALE_PREFIX = new RegExp(`^/(?:${PREFIXED_LOCALES.join('|')})(?=/)`);
const CONTENT_PATH = /^\/(book|author|artwork|collections?)\/([^/?#]+)/;

/** Reads the content link out of a 404's pathname; null for any other page. */
export function parseDeadContentLink(pathname: string): DeadContentLink | null {
  const match = pathname.replace(LOCALE_PREFIX, '').match(CONTENT_PATH);
  if (!match) return null;
  let slug = match[2];
  try { slug = decodeURIComponent(slug); } catch { /* keep raw */ }
  return { kind: (match[1].startsWith('collection') ? 'collection' : match[1]) as DeadContentKind, slug };
}

/**
 * Turns a slug into words for the search box. An id or other opaque token gives
 * an empty string: searching for it would only find nothing a second time.
 */
export function searchTermFromSlug(slug: string): string {
  if (!isResolvableSlug(slug) || /^[0-9a-f]{24}$/.test(slug)) return '';
  return slug
    .replace(/^art-/, '')
    .replace(/-\d+$/, '')
    .split('-')
    .join(' ');
}
