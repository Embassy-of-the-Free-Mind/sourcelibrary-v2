/**
 * Public-facing corpus statistics — the single source for counts quoted in
 * copy (developer docs, MCP tool descriptions, marketing surfaces).
 *
 * Before this file, five surfaces quoted five different image counts
 * (110k / 150k / 200k / 215k / 222k — issue #4290), and /llms.txt (read by
 * AI licensing partners) understated the artwork count by 10k. Import these
 * constants instead of hand-writing a number; static files that cannot
 * import (public/llms.txt) must be re-synced by hand when these change.
 *
 * Measured 2026-11-18 (re-measure before updating — they drift). Both floors count
 * what a reader can open, so hidden records stay out:
 *   gallery_images, all rows:                      237,349
 *     in visible books (joined to books by id):    219,215
 *     with the stored book_visible flag true:      209,695  (4,729 rows lack the flag)
 *   books with resource_type, visible (artworks):   18,614
 *     all rows, hidden included:                    27,689  (what the old floor counted)
 * One-liner to re-measure:
 *   node --env-file=.env.production.local -e "import('mongodb').then(async({MongoClient})=>{const c=new MongoClient(process.env.MONGODB_URI);await c.connect();const db=c.db('bookstore');console.log(await db.collection('gallery_images').countDocuments({book_visible:true}),await db.collection('books').countDocuments({resource_type:{\$exists:true},visible:true}));await c.close()})"
 *
 * Keep these as conservative rounded floors ("N+"), never live counts — copy
 * that overstates is worse than copy that lags.
 */
export const IMAGE_CORPUS_STATS = {
  /** Illustrations extracted from book pages (gallery_images rows in visible books). */
  illustrations: '200,000+',
  /** Standalone museum artworks (visible books rows with resource_type). */
  artworks: '18,000+',
} as const;

/**
 * Book counts for copy that is fixed when the module loads (page metadata,
 * FAQ text). Pages that render on the server should prefer the live
 * getLibraryStats() in src/lib/library-stats.ts; these are the floors for
 * everything else.
 *
 * Measured 2026-11-18 from system_config.homepage_stats:
 *   totalBooks (visible, pages_count > 0):  71,337
 *   readableInEnglish:                      25,449
 *   languageCount (source languages):          136
 *     (the outage fallback in site-stats.ts held 159: the count falls when
 *     language values are merged, so this floor keeps a margin)
 */
export const BOOK_CORPUS_STATS = {
  /** Readable books (visible, with pages). */
  books: '70,000+',
  /** The readable_in_english view (translation-state.md). */
  readableInEnglish: '25,000+',
  /** Distinct source languages across the readable books. */
  languages: '120+',
} as const;
