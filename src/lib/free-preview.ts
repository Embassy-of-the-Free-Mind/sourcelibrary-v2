/**
 * Metered reader — the free-preview policy (#4357, Phase 2).
 *
 * Anonymous readers get a free sample of every book; the rest of the TEXT
 * (transcription, translation, and derived text) asks for a sign-in. Page
 * IMAGES are never gated here: the reader's nav list already ships every
 * page's image URLs in ISR HTML and the files live on public R2/IIIF origins,
 * so an image gate would be theatre — and illustrations staying browsable is
 * deliberate (they are the free front door, indexed via /gallery and /artwork).
 *
 * The free set for a book is:
 *   - the first FREE_PAGE_PERCENT% of pages (same rule bots have always had —
 *     bot-gate.ts delegates its math here so the two can never drift), PLUS
 *   - every seo_indexable page. Reader pages are noindex by default (#2688);
 *     only seo_indexable pages are in Google, and keeping exactly those free
 *     means every indexed page stays fully accessible: no cloaking exposure,
 *     no paywall structured data needed, and buildPageJsonLd's
 *     `isAccessibleForFree: true` stays honest (it only emits on
 *     seo_indexable pages).
 *
 * MASTER SWITCH: the METERED_READER env var. Unset (the default) the gate is
 * inert everywhere. Flipping it on requires a deploy, and ISR reader pages
 * rendered before the flip keep serving full text until they revalidate
 * (up to 24h) — flip it before announcing, not after.
 *
 * Enforcement points (all of them check meteredReaderEnabled() first):
 *   - /api/pages/[id] + /api/pages/batch, and their /api/[tenant]/ twins —
 *     the routes the reader's client-side page turns actually fetch from
 *   - the ISR reader page itself (direct deep links to gated pages)
 * Tenant-context traffic is exempt: partner reading rooms (BPH etc.) were
 * promised as open reading surfaces and have their own agreements.
 */

export const FREE_PAGE_PERCENT = 20;

export function meteredReaderEnabled(): boolean {
  return process.env.METERED_READER === '1';
}

/**
 * Highest page_number in a book's free sample. 0 when pages_count is unknown
 * (deny by default — same contract botMaxPage always had).
 */
export function freeMaxPage(pagesCount: number): number {
  if (!pagesCount || pagesCount <= 0) return 0;
  return Math.max(1, Math.floor(pagesCount * FREE_PAGE_PERCENT / 100));
}

/**
 * Is this page in the book's free sample?
 *
 * Pages without a real page_number (null/negative — inserts, archived
 * spreads, unnumbered front matter) count as free: they are not the asset
 * being metered and a wall on an unnumbered flyleaf is just confusing.
 */
export function isPageFree(
  page: { page_number?: number | null; seo_indexable?: boolean },
  pagesCount: number | undefined,
): boolean {
  if (page.seo_indexable === true) return true;
  const n = page.page_number;
  if (n == null || n < 0) return true;
  return n <= freeMaxPage(pagesCount || 0);
}

/** Fields that carry the metered asset: page text and everything derived from it. */
const GATED_TEXT_FIELDS = [
  'ocr', 'translation', 'translation_es', 'translations', 'summary',
  'modernized', 'transliteration', 'translation_summary',
  'translation_keywords', 'word_alignment',
] as const;

export interface GateInfo {
  free_pages: number;
  pages_count: number;
  sign_in_url: string;
}

/**
 * Strip the gated text from a page document and mark it, leaving images and
 * layout metadata intact so the scan stays browsable. Returns a NEW object.
 */
export function stripGatedPage<T extends Record<string, unknown>>(
  page: T,
  pagesCount: number,
): T & { gated: true; gate: GateInfo } {
  const stripped: Record<string, unknown> = { ...page };
  for (const field of GATED_TEXT_FIELDS) delete stripped[field];
  return {
    ...(stripped as T),
    gated: true as const,
    gate: {
      free_pages: freeMaxPage(pagesCount),
      pages_count: pagesCount,
      sign_in_url: '/auth/signin',
    },
  };
}
