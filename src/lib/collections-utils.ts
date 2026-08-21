/**
 * Shared utilities for collections and homepage.
 * Extracted from duplicated code across page components.
 */

// ---------- Art collection filtering ----------
// Resource types excluded from art collection queries.
// These are documentary/photographic records, not artworks.
export const ART_EXCLUDED_RESOURCE_TYPES = [
  'photograph', 'object', 'sculpture', 'architectural', 'decorative', 'ritual-object',
];

// ---------- Pinned collection ordering ----------

export const PINNED_COLLECTION_SLUGS = [
  // Row 1 — the ancient roots
  'sacred-texts',
  'classical-philosophy',
  'hermetica',
  'mysticism',
  // Row 2 — the esoteric arts
  'alchemy',
  'magic',
  'kabbalah',
  'astrology',
  // Row 3 — knowledge & world
  'natural-philosophy',
  'renaissance-philosophy',
  'medicine',
  'secret-societies',
  // Row 4 — culture & thought
  'theology',
  'literature',
  'art-illustrated',
  'demonology',
  // Row 5 — remaining
  'psychology',
  'history-political-thought',
  // Row 6 — regional wings (major domains, promoted out of the misc top-level bucket)
  'east-asia',
  'south-asia',
];

/** Pin specific collections first, shuffle the rest. */
export function sortCollections<T extends { slug: string; children_count?: number }>(collections: T[]): T[] {
  const pinned = PINNED_COLLECTION_SLUGS
    .map(s => collections.find(c => c.slug === s))
    .filter(Boolean) as T[];
  const rest = collections.filter(c => !PINNED_COLLECTION_SLUGS.includes(c.slug));
  const shuffle = (arr: T[]) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  // Collections with sub-collections are richer entry points — lift them ahead of
  // the thin single-topic collections in the (otherwise randomised) tail. Pinned
  // curation still leads. When children_count is absent (e.g. homepage grid) this
  // is a no-op and the tail is simply shuffled.
  const withSubs = shuffle(rest.filter(c => (c.children_count ?? 0) > 0));
  const withoutSubs = shuffle(rest.filter(c => !(c.children_count ?? 0)));
  return [...pinned, ...withSubs, ...withoutSubs];
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

// ---------- Editorial cover overrides ----------

/**
 * Pin a specific representative image for a collection by slug, independent of
 * its stored `featured_images`. Used when a collection has no usable cover, or
 * when a stronger image exists than the auto-picked first featured image.
 * These are hand-curated and take precedence over `featured_images`.
 * (Curation lives in code so it ships/previews with the branch rather than
 * mutating the shared production DB.)
 */
export const COLLECTION_COVER_OVERRIDES: Record<string, string> = {
  // A princely-patron portrait — fits "rulers who collected alchemists".
  'courts-of-wonder':
    'https://images.sourcelibrary.org/gallery/695201adab34727b1f0419c7/695201adab34727b1f0419cc-0.jpg',
  // "An Account of the Plant" had no cover at all; a botanical scene from its books.
  'cannabis-western-record':
    'https://images.sourcelibrary.org/gallery/69e9618b2beefe2f6f72bcd1/69e9618b2beefe2f6f72bd7d-0.jpg',
};

/** The override URL for a collection slug, if one is curated. */
export function coverOverride(slug: string | undefined | null): string | undefined {
  return slug ? COLLECTION_COVER_OVERRIDES[slug] : undefined;
}

// ---------- Book display title ----------

/** Returns display_title if valid, otherwise falls back to title. */
export function bookTitle(book: { display_title?: string; title: string }): string {
  const dt = book.display_title;
  return (dt && dt !== 'None') ? dt : book.title;
}

// ---------- Collection count label ----------

/**
 * Format a human-readable count label for a collection.
 * Shows "X texts · Y artworks", "X texts", "Y artworks", or empty string.
 *
 * `collectionType` matters: a `visual_art` collection's page renders artworks and
 * nothing else, so its book counters describe texts the reader can never reach from
 * it. Advertising them is a promise the page does not keep — `school-of-athens`
 * claimed 518 texts over a page showing 30 works. Pass the type and the text half
 * is dropped.
 */
export function collectionCountLabel(bookCount?: number, artworkCount?: number, collectionType?: string): string {
  const b = collectionType === 'visual_art' ? 0 : (bookCount || 0);
  const a = artworkCount || 0;
  if (b > 0 && a > 0) {
    return `${b.toLocaleString()} texts · ${a.toLocaleString()} artworks`;
  }
  if (b > 0) return `${b.toLocaleString()} texts`;
  if (a > 0) return `${a.toLocaleString()} artworks`;
  return '';
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
