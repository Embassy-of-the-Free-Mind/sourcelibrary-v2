/**
 * Shared utilities for collections and homepage.
 * Extracted from duplicated code across page components.
 */

// ---------- Pinned collection ordering ----------

export const PINNED_COLLECTION_SLUGS = [
  'natural-philosophy',
  'classical-philosophy',
  'renaissance-philosophy',
  'sacred-texts',
];

/** Pin specific collections first, shuffle the rest. */
export function sortCollections<T extends { slug: string }>(collections: T[]): T[] {
  const pinned = PINNED_COLLECTION_SLUGS
    .map(s => collections.find(c => c.slug === s))
    .filter(Boolean) as T[];
  const rest = collections.filter(c => !PINNED_COLLECTION_SLUGS.includes(c.slug));
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  return [...pinned, ...rest];
}

// ---------- Thumbnail sanitization ----------

/**
 * Unwrap /api/image?url= proxy wrapper and validate URL schemes.
 * Returns undefined for invalid/empty URLs.
 */
export function sanitizeThumbnail(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  if (url.startsWith('/api/image')) {
    const match = url.match(/[?&]url=([^&]+)/);
    if (match) return decodeURIComponent(match[1]);
    return undefined;
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (url.startsWith('data:') || url.startsWith('/')) return url;
  return undefined;
}

// ---------- Book display title ----------

/** Returns display_title if valid, otherwise falls back to title. */
export function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

// ---------- Promise timeout ----------

/** Race a promise against a timeout — returns fallback on timeout or error. */
export function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch((err) => {
      console.error('[withTimeout] query failed:', err?.message || err);
      return fallback;
    }),
    new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms)),
  ]);
}
